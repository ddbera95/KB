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
        .route("/", get(list_api_keys).post(create_api_key))
        .route("/:id", axum::routing::delete(delete_api_key))
}

// ── Response types ─────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct ApiKeyResponse {
    pub id: String,
    pub name: String,
    pub key_value: String,
    pub project_id: String,
    pub created_by: String,
    pub created_at: i64,
    pub last_used_at: Option<i64>,
}

#[derive(Deserialize)]
pub struct CreateApiKeyRequest {
    pub name: String,
    pub project_id: String,
}

// ── GET / ─────────────────────────────────────────────────────────────────────

async fn list_api_keys(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> Result<Response, AppError> {
    if let Err(e) = require_admin(&auth) {
        return Ok(e);
    }

    let rows = sqlx::query_as::<_, (String, String, String, String, String, i64, Option<i64>)>(
        "SELECT id, name, key_value, project_id, created_by, created_at, last_used_at \
         FROM api_keys ORDER BY created_at DESC",
    )
    .fetch_all(&state.db)
    .await?;

    let keys: Vec<ApiKeyResponse> = rows
        .into_iter()
        .map(
            |(id, name, key_value, project_id, created_by, created_at, last_used_at)| {
                ApiKeyResponse {
                    id,
                    name,
                    key_value,
                    project_id,
                    created_by,
                    created_at,
                    last_used_at,
                }
            },
        )
        .collect();

    Ok(Json(keys).into_response())
}

// ── POST / ────────────────────────────────────────────────────────────────────

async fn create_api_key(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(payload): Json<CreateApiKeyRequest>,
) -> Result<Response, AppError> {
    if let Err(e) = require_admin(&auth) {
        return Ok(e);
    }

    if payload.name.trim().is_empty() {
        return Err(AppError::BadRequest("name must not be empty".into()));
    }
    if payload.project_id.trim().is_empty() {
        return Err(AppError::BadRequest("project_id must not be empty".into()));
    }

    // Verify project exists
    let project_exists: Option<String> =
        sqlx::query_scalar("SELECT id FROM projects WHERE id = ?")
            .bind(&payload.project_id)
            .fetch_optional(&state.db)
            .await?;
    if project_exists.is_none() {
        return Err(AppError::NotFound(format!(
            "project '{}' not found",
            payload.project_id
        )));
    }

    let created_by = match &auth {
        AuthUser::Session { user_id, .. } => user_id.clone(),
        AuthUser::ApiKey { .. } => "api".to_string(),
    };

    let id = Uuid::new_v4().to_string();
    let now = Utc::now().timestamp();

    // Generate key: mmx_<32 hex chars from uuid>
    let key_value = format!("mmx_{}", Uuid::new_v4().simple());

    sqlx::query(
        "INSERT INTO api_keys (id, name, key_value, project_id, created_by, created_at) \
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&payload.name)
    .bind(&key_value)
    .bind(&payload.project_id)
    .bind(&created_by)
    .bind(now)
    .execute(&state.db)
    .await?;

    let key = ApiKeyResponse {
        id,
        name: payload.name,
        key_value,
        project_id: payload.project_id,
        created_by,
        created_at: now,
        last_used_at: None,
    };

    Ok((StatusCode::CREATED, Json(key)).into_response())
}

// ── DELETE /:id ───────────────────────────────────────────────────────────────

async fn delete_api_key(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<String>,
) -> Result<Response, AppError> {
    if let Err(e) = require_admin(&auth) {
        return Ok(e);
    }

    let existing: Option<String> =
        sqlx::query_scalar("SELECT id FROM api_keys WHERE id = ?")
            .bind(&id)
            .fetch_optional(&state.db)
            .await?;

    if existing.is_none() {
        return Err(AppError::NotFound(format!("api key '{}' not found", id)));
    }

    sqlx::query("DELETE FROM api_keys WHERE id = ?")
        .bind(&id)
        .execute(&state.db)
        .await?;

    Ok(StatusCode::NO_CONTENT.into_response())
}
