use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{delete, get, post, put},
    Json, Router,
};
use crate::{
    error::{AppError, Result},
    models::*,
    state::AppState,
};
use slug::slugify;
use uuid::Uuid;

#[derive(Debug, serde::Deserialize)]
pub struct ProjectParam {
    pub project_id: Option<String>,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_collections).post(create_collection))
        .route(
            "/:id",
            get(get_collection)
                .put(update_collection)
                .delete(delete_collection),
        )
}

// ---------------------------------------------------------------------------
// GET /api/collections
// ---------------------------------------------------------------------------

/// List all collections ordered by name, filtered by project_id.
async fn list_collections(
    State(state): State<AppState>,
    Query(params): Query<ProjectParam>,
) -> Result<Json<Vec<Collection>>> {
    let project_id = params.project_id.unwrap_or_else(|| "default".to_string());

    let collections = sqlx::query_as::<_, Collection>(
        "SELECT id, name, slug, description, icon, project_id, created_at, updated_at
         FROM collections
         WHERE project_id = ?
         ORDER BY name ASC",
    )
    .bind(&project_id)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(collections))
}

// ---------------------------------------------------------------------------
// POST /api/collections
// ---------------------------------------------------------------------------

/// Create a new collection.
/// - Generates a UUID v4 `id`.
/// - Derives the `slug` from `name` via `slug::slugify` unless the caller
///   supplies one explicitly.
/// - Sets both `created_at` and `updated_at` to the current Unix timestamp.
/// - Associates the collection with a project via `?project_id=` query param
///   (defaults to "default").
async fn create_collection(
    State(state): State<AppState>,
    Query(params): Query<ProjectParam>,
    Json(payload): Json<CreateCollection>,
) -> Result<(StatusCode, Json<Collection>)> {
    let project_id = params.project_id.unwrap_or_else(|| "default".to_string());
    if payload.name.trim().is_empty() {
        return Err(AppError::BadRequest("name must not be empty".into()));
    }

    let id = Uuid::new_v4().to_string();
    let slug = payload
        .slug
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| slugify(&payload.name));

    if slug.is_empty() {
        return Err(AppError::BadRequest(
            "could not derive a valid slug from the provided name".into(),
        ));
    }

    // Enforce slug uniqueness.
    let slug_taken: Option<String> =
        sqlx::query_scalar("SELECT id FROM collections WHERE slug = ?")
            .bind(&slug)
            .fetch_optional(&state.db)
            .await?;

    if slug_taken.is_some() {
        return Err(AppError::Conflict(format!(
            "a collection with slug '{}' already exists",
            slug
        )));
    }

    let now = chrono::Utc::now().timestamp();

    sqlx::query(
        "INSERT INTO collections (id, name, slug, description, icon, project_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&payload.name)
    .bind(&slug)
    .bind(&payload.description)
    .bind(&payload.icon)
    .bind(&project_id)
    .bind(now)
    .bind(now)
    .execute(&state.db)
    .await?;

    let collection = sqlx::query_as::<_, Collection>(
        "SELECT id, name, slug, description, icon, project_id, created_at, updated_at
         FROM collections
         WHERE id = ?",
    )
    .bind(&id)
    .fetch_one(&state.db)
    .await?;

    Ok((StatusCode::CREATED, Json(collection)))
}

// ---------------------------------------------------------------------------
// GET /api/collections/:id
// ---------------------------------------------------------------------------

/// Return a collection together with its root-level documents
/// (`parent_id IS NULL AND collection_id = :id`).
async fn get_collection(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<CollectionWithDocs>> {
    let collection = sqlx::query_as::<_, Collection>(
        "SELECT id, name, slug, description, icon, project_id, created_at, updated_at
         FROM collections
         WHERE id = ?",
    )
    .bind(&id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("collection '{}' not found", id)))?;

    let root_docs = sqlx::query_as::<_, Document>(
        "SELECT id, collection_id, parent_id, title, slug, brief, content,
                depth, sort_order, created_at, updated_at
         FROM documents
         WHERE collection_id = ? AND parent_id IS NULL
         ORDER BY sort_order ASC, title ASC",
    )
    .bind(&id)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(CollectionWithDocs {
        collection,
        root_docs,
    }))
}

// ---------------------------------------------------------------------------
// PUT /api/collections/:id
// ---------------------------------------------------------------------------

/// Update one or more fields of an existing collection.
/// Only the fields present in the payload are changed; omitted fields retain
/// their current values.  `updated_at` is always refreshed.
async fn update_collection(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<UpdateCollection>,
) -> Result<Json<Collection>> {
    // Fetch the current row so we can merge partial updates.
    let existing = sqlx::query_as::<_, Collection>(
        "SELECT id, name, slug, description, icon, project_id, created_at, updated_at
         FROM collections
         WHERE id = ?",
    )
    .bind(&id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("collection '{}' not found", id)))?;

    // Merge: use payload value when present, fall back to existing value.
    let new_name: String = payload
        .name
        .as_deref()
        .map(str::to_owned)
        .unwrap_or_else(|| existing.name.clone());

    let new_slug: String = if let Some(ref s) = payload.slug {
        s.clone()
    } else if payload.name.is_some() {
        // Regenerate slug when the name changed and the caller did not supply
        // an explicit new slug.
        slugify(&new_name)
    } else {
        existing.slug.clone()
    };

    if new_slug.is_empty() {
        return Err(AppError::BadRequest(
            "could not derive a valid slug from the provided name".into(),
        ));
    }

    // Check that the target slug is not already taken by a *different* row.
    let slug_owner: Option<String> =
        sqlx::query_scalar("SELECT id FROM collections WHERE slug = ?")
            .bind(&new_slug)
            .fetch_optional(&state.db)
            .await?;

    if let Some(owner_id) = slug_owner {
        if owner_id != id {
            return Err(AppError::Conflict(format!(
                "a collection with slug '{}' already exists",
                new_slug
            )));
        }
    }

    // For Option fields merge: payload overrides (including explicit null to
    // clear), otherwise keep existing value.
    let new_description: Option<String> = if payload.description.is_some() {
        payload.description
    } else {
        existing.description
    };

    let new_icon: Option<String> = if payload.icon.is_some() {
        payload.icon
    } else {
        existing.icon
    };

    let now = chrono::Utc::now().timestamp();

    sqlx::query(
        "UPDATE collections
         SET name = ?, slug = ?, description = ?, icon = ?, updated_at = ?
         WHERE id = ?",
    )
    .bind(&new_name)
    .bind(&new_slug)
    .bind(&new_description)
    .bind(&new_icon)
    .bind(now)
    .bind(&id)
    .execute(&state.db)
    .await?;

    let updated = sqlx::query_as::<_, Collection>(
        "SELECT id, name, slug, description, icon, project_id, created_at, updated_at
         FROM collections
         WHERE id = ?",
    )
    .bind(&id)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(updated))
}

// ---------------------------------------------------------------------------
// DELETE /api/collections/:id
// ---------------------------------------------------------------------------

/// Delete a collection.  Cascading deletes of child documents are expected to
/// be handled by `ON DELETE CASCADE` foreign-key constraints in the schema.
async fn delete_collection(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode> {
    let result = sqlx::query("DELETE FROM collections WHERE id = ?")
        .bind(&id)
        .execute(&state.db)
        .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound(format!(
            "collection '{}' not found",
            id
        )));
    }

    Ok(StatusCode::NO_CONTENT)
}
