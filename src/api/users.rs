use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
    Extension, Json, Router,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    auth::{require_admin, AuthUser},
    error::AppError,
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_users).post(create_user))
        .route("/:id", axum::routing::delete(delete_user))
}

// ── Response types ─────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct UserResponse {
    pub id: String,
    pub username: String,
    pub is_admin: bool,
    pub created_at: i64,
}

#[derive(Deserialize)]
pub struct CreateUserRequest {
    pub username: String,
    pub password: String,
}

// ── GET / ─────────────────────────────────────────────────────────────────────

async fn list_users(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> Result<Response, AppError> {
    if let Err(e) = require_admin(&auth) {
        return Ok(e);
    }

    let rows = sqlx::query_as::<_, (String, String, bool, i64)>(
        "SELECT id, username, is_admin, created_at FROM users ORDER BY created_at ASC",
    )
    .fetch_all(&state.db)
    .await?;

    let users: Vec<UserResponse> = rows
        .into_iter()
        .map(|(id, username, is_admin, created_at)| UserResponse {
            id,
            username,
            is_admin,
            created_at,
        })
        .collect();

    Ok(Json(users).into_response())
}

// ── POST / ────────────────────────────────────────────────────────────────────

async fn create_user(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(payload): Json<CreateUserRequest>,
) -> Result<Response, AppError> {
    if let Err(e) = require_admin(&auth) {
        return Ok(e);
    }

    if payload.username.trim().is_empty() {
        return Err(AppError::BadRequest("username must not be empty".into()));
    }
    if payload.password.len() < 4 {
        return Err(AppError::BadRequest(
            "password must be at least 4 characters".into(),
        ));
    }

    // Check for existing username
    let existing: Option<String> =
        sqlx::query_scalar("SELECT id FROM users WHERE username = ?")
            .bind(&payload.username)
            .fetch_optional(&state.db)
            .await?;
    if existing.is_some() {
        return Err(AppError::Conflict(format!(
            "username '{}' already exists",
            payload.username
        )));
    }

    let id = Uuid::new_v4().to_string();
    let now = Utc::now().timestamp();
    let pw = payload.password.clone();
    let hash = tokio::task::spawn_blocking(move || bcrypt::hash(&pw, 12))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
        .map_err(|e| AppError::Internal(e.to_string()))?;

    sqlx::query(
        "INSERT INTO users (id, username, password_hash, is_admin, created_at) VALUES (?, ?, ?, 0, ?)",
    )
    .bind(&id)
    .bind(&payload.username)
    .bind(&hash)
    .bind(now)
    .execute(&state.db)
    .await?;

    let user = UserResponse {
        id,
        username: payload.username,
        is_admin: false,
        created_at: now,
    };

    Ok((StatusCode::CREATED, Json(user)).into_response())
}

// ── DELETE /:id ───────────────────────────────────────────────────────────────

async fn delete_user(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<String>,
) -> Result<Response, AppError> {
    if let Err(e) = require_admin(&auth) {
        return Ok(e);
    }

    // Cannot delete self
    if let AuthUser::Session { user_id, .. } = &auth {
        if *user_id == id {
            return Err(AppError::BadRequest("Cannot delete your own account".into()));
        }
    }

    // Check target user exists and is not the only admin
    let row = sqlx::query_as::<_, (String, bool)>(
        "SELECT id, is_admin FROM users WHERE id = ?",
    )
    .bind(&id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("user '{}' not found", id)))?;

    let (_, target_is_admin) = row;

    if target_is_admin {
        let admin_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE is_admin = 1")
                .fetch_one(&state.db)
                .await?;
        if admin_count <= 1 {
            return Err(AppError::BadRequest(
                "Cannot delete the only admin account".into(),
            ));
        }
    }

    sqlx::query("DELETE FROM users WHERE id = ?")
        .bind(&id)
        .execute(&state.db)
        .await?;

    Ok(StatusCode::NO_CONTENT.into_response())
}
