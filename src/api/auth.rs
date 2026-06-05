use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    Extension, Json,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    auth::{parse_cookie, AuthUser, SessionData},
    error::AppError,
    state::AppState,
};

// ── Request / response types ──────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Serialize)]
pub struct LoginResponse {
    pub user_id: String,
    pub username: String,
    pub is_admin: bool,
}

#[derive(Deserialize)]
pub struct ChangePasswordRequest {
    pub current_password: String,
    pub new_password: String,
}

// ── POST /api/auth/login ──────────────────────────────────────────────────────

pub async fn login(
    State(state): State<AppState>,
    Json(payload): Json<LoginRequest>,
) -> Result<Response, AppError> {
    // Find user by username
    let row = sqlx::query_as::<_, (String, String, String, bool)>(
        "SELECT id, username, password_hash, is_admin FROM users WHERE username = ?",
    )
    .bind(&payload.username)
    .fetch_optional(&state.db)
    .await?;

    let (user_id, username, password_hash, is_admin) = match row {
        Some(r) => r,
        None => {
            return Ok((
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({"error": "Invalid username or password"})),
            )
                .into_response())
        }
    };

    // Verify password (bcrypt is blocking)
    let hash_clone = password_hash.clone();
    let password_clone = payload.password.clone();
    let valid = tokio::task::spawn_blocking(move || {
        bcrypt::verify(&password_clone, &hash_clone).unwrap_or(false)
    })
    .await
    .unwrap_or(false);

    if !valid {
        return Ok((
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error": "Invalid username or password"})),
        )
            .into_response());
    }

    // Generate session token (32 hex chars from UUID)
    let token = Uuid::new_v4().simple().to_string();
    let expires_at = Utc::now().timestamp() + 86400; // 24h

    {
        let mut sessions = state.sessions.lock().await;
        sessions.insert(
            token.clone(),
            SessionData {
                user_id: user_id.clone(),
                username: username.clone(),
                is_admin,
                expires_at,
            },
        );
    }

    let cookie = format!(
        "mimix_session={}; HttpOnly; Path=/; Max-Age=86400; SameSite=Lax",
        token
    );

    let body = Json(LoginResponse {
        user_id,
        username,
        is_admin,
    });

    Ok((
        StatusCode::OK,
        [("set-cookie", cookie.as_str())],
        body,
    )
        .into_response())
}

// ── POST /api/auth/logout ─────────────────────────────────────────────────────

pub async fn logout(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Response {
    if let Some(token) = parse_cookie(&headers, "mimix_session") {
        let mut sessions = state.sessions.lock().await;
        sessions.remove(&token);
    }

    let clear_cookie = "mimix_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax";

    (
        StatusCode::OK,
        [("set-cookie", clear_cookie)],
        Json(serde_json::json!({"ok": true})),
    )
        .into_response()
}

// ── GET /api/auth/me ──────────────────────────────────────────────────────────

pub async fn me(Extension(auth): Extension<AuthUser>) -> Response {
    match auth {
        AuthUser::Session {
            user_id,
            username,
            is_admin,
        } => Json(serde_json::json!({
            "user_id": user_id,
            "username": username,
            "is_admin": is_admin,
        }))
        .into_response(),
        AuthUser::ApiKey { project_id } => Json(serde_json::json!({
            "user_id": null,
            "username": "api",
            "is_admin": false,
            "project_id": project_id,
        }))
        .into_response(),
    }
}

// ── PUT /api/auth/password ────────────────────────────────────────────────────

pub async fn change_password(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(payload): Json<ChangePasswordRequest>,
) -> Result<Response, AppError> {
    let user_id = match &auth {
        AuthUser::Session { user_id, .. } => user_id.clone(),
        AuthUser::ApiKey { .. } => {
            return Ok((
                StatusCode::FORBIDDEN,
                Json(serde_json::json!({"error": "API key auth cannot change password"})),
            )
                .into_response())
        }
    };

    // Fetch current hash
    let hash: Option<String> =
        sqlx::query_scalar("SELECT password_hash FROM users WHERE id = ?")
            .bind(&user_id)
            .fetch_optional(&state.db)
            .await?;

    let current_hash = match hash {
        Some(h) => h,
        None => {
            return Err(AppError::NotFound("User not found".into()));
        }
    };

    // Verify current password
    let current_pw = payload.current_password.clone();
    let hash_clone = current_hash.clone();
    let valid = tokio::task::spawn_blocking(move || {
        bcrypt::verify(&current_pw, &hash_clone).unwrap_or(false)
    })
    .await
    .unwrap_or(false);

    if !valid {
        return Ok((
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error": "Current password is incorrect"})),
        )
            .into_response());
    }

    if payload.new_password.len() < 4 {
        return Ok((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "New password must be at least 4 characters"})),
        )
            .into_response());
    }

    // Hash new password
    let new_pw = payload.new_password.clone();
    let new_hash = tokio::task::spawn_blocking(move || bcrypt::hash(&new_pw, 12))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
        .map_err(|e| AppError::Internal(e.to_string()))?;

    sqlx::query("UPDATE users SET password_hash = ? WHERE id = ?")
        .bind(&new_hash)
        .bind(&user_id)
        .execute(&state.db)
        .await?;

    Ok(Json(serde_json::json!({"ok": true})).into_response())
}
