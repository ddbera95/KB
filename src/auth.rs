use std::{collections::HashMap, sync::Arc};

use axum::{
    body::Body,
    extract::{Request, State},
    http::{HeaderMap, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use chrono::Utc;
use serde::Serialize;
use tokio::sync::Mutex;

use crate::state::AppState;

// ── Session store ─────────────────────────────────────────────────────────────

#[derive(Clone, Debug)]
pub struct SessionData {
    pub user_id: String,
    pub username: String,
    pub is_admin: bool,
    pub expires_at: i64,
}

pub type SessionStore = Arc<Mutex<HashMap<String, SessionData>>>;

// ── Auth identity (extension inserted by middleware) ──────────────────────────

#[derive(Clone, Debug)]
pub enum AuthUser {
    Session {
        user_id: String,
        username: String,
        is_admin: bool,
    },
    ApiKey {
        project_id: String,
    },
}

// ── Helper: parse cookies from header ────────────────────────────────────────

pub fn parse_cookie(headers: &HeaderMap, name: &str) -> Option<String> {
    let cookie_header = headers.get("cookie")?.to_str().ok()?;
    for part in cookie_header.split(';') {
        let part = part.trim();
        if let Some(val) = part.strip_prefix(name) {
            if let Some(val) = val.strip_prefix('=') {
                return Some(val.to_string());
            }
        }
    }
    None
}

// ── Middleware ────────────────────────────────────────────────────────────────

pub async fn require_auth(
    State(state): State<AppState>,
    mut request: Request<Body>,
    next: Next,
) -> Response {
    let headers = request.headers().clone();

    // 1. Try API key auth (X-Api-Key header or Authorization: Bearer)
    let api_key_val = headers
        .get("x-api-key")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
        .or_else(|| {
            headers
                .get("authorization")
                .and_then(|v| v.to_str().ok())
                .and_then(|s| s.strip_prefix("Bearer "))
                .map(|s| s.to_string())
        });

    if let Some(key) = api_key_val {
        // Look up the key in DB
        let result = sqlx::query_as::<_, (String, String, String)>(
            "SELECT id, project_id, key_value FROM api_keys WHERE key_value = ?",
        )
        .bind(&key)
        .fetch_optional(&state.db)
        .await;

        match result {
            Ok(Some((key_id, project_id, _))) => {
                // Update last_used_at
                let now = Utc::now().timestamp();
                let _ = sqlx::query("UPDATE api_keys SET last_used_at = ? WHERE id = ?")
                    .bind(now)
                    .bind(&key_id)
                    .execute(&state.db)
                    .await;

                // Check project_id in query param matches key's project
                let query = request.uri().query().unwrap_or("");
                let requested_project = query
                    .split('&')
                    .find_map(|pair| {
                        let mut parts = pair.splitn(2, '=');
                        let k = parts.next()?;
                        let v = parts.next()?;
                        if k == "project_id" { Some(v.to_string()) } else { None }
                    });

                if let Some(req_proj) = requested_project {
                    if req_proj != project_id {
                        return unauthorized("API key not valid for this project");
                    }
                }

                request.extensions_mut().insert(AuthUser::ApiKey { project_id });
                return next.run(request).await;
            }
            Ok(None) => {
                return unauthorized("Invalid API key");
            }
            Err(_) => {
                return unauthorized("Authentication error");
            }
        }
    }

    // 2. Try session cookie auth
    if let Some(token) = parse_cookie(&headers, "mimix_session") {
        let sessions = state.sessions.lock().await;
        if let Some(session) = sessions.get(&token) {
            let now = Utc::now().timestamp();
            if session.expires_at > now {
                let auth_user = AuthUser::Session {
                    user_id: session.user_id.clone(),
                    username: session.username.clone(),
                    is_admin: session.is_admin,
                };
                drop(sessions);
                request.extensions_mut().insert(auth_user);
                return next.run(request).await;
            }
        }
    }

    unauthorized("Authentication required")
}

fn unauthorized(msg: &str) -> Response {
    (
        StatusCode::UNAUTHORIZED,
        [("content-type", "application/json")],
        format!("{{\"error\":\"{}\"}}", msg),
    )
        .into_response()
}

// ── Helper: require admin from AuthUser ──────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct AuthError {
    pub error: String,
}

pub fn require_admin(user: &AuthUser) -> Result<(), Response> {
    match user {
        AuthUser::Session { is_admin: true, .. } => Ok(()),
        AuthUser::Session { is_admin: false, .. } => Err((
            StatusCode::FORBIDDEN,
            Json(AuthError { error: "Admin access required".into() }),
        )
            .into_response()),
        AuthUser::ApiKey { .. } => Err((
            StatusCode::FORBIDDEN,
            Json(AuthError { error: "Admin operations require session auth".into() }),
        )
            .into_response()),
    }
}
