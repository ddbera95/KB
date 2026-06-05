use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::get,
    Json, Router,
};
use chrono::Utc;
use serde::Serialize;
use slug::slugify;
use tracing::info;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    models::{CreateProject, Project, UpdateProject},
    state::AppState,
};

// ─── Router ───────────────────────────────────────────────────────────────────

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_projects).post(create_project))
        .route("/:id", get(get_project).put(update_project).delete(delete_project))
}

// ─── Response types ───────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct ProjectDetail {
    #[serde(flatten)]
    pub project: Project,
    pub collections_count: i64,
    pub documents_count: i64,
}

// ─── GET / ────────────────────────────────────────────────────────────────────

async fn list_projects(
    State(state): State<AppState>,
) -> Result<Json<Vec<Project>>> {
    let projects = sqlx::query_as::<_, Project>(
        "SELECT id, name, slug, description, color, created_at, updated_at \
         FROM projects ORDER BY created_at ASC",
    )
    .fetch_all(&state.db)
    .await?;

    Ok(Json(projects))
}

// ─── POST / ───────────────────────────────────────────────────────────────────

async fn create_project(
    State(state): State<AppState>,
    Json(payload): Json<CreateProject>,
) -> Result<(StatusCode, Json<Project>)> {
    if payload.name.trim().is_empty() {
        return Err(AppError::BadRequest("name must not be empty".into()));
    }

    let id = Uuid::new_v4().to_string();
    let now = Utc::now().timestamp();
    let color = payload.color.unwrap_or_else(|| "#6366f1".to_string());

    let base_slug = slugify(&payload.name);
    let existing_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM projects WHERE slug LIKE ?",
    )
    .bind(format!("{}%", base_slug))
    .fetch_one(&state.db)
    .await?;
    let project_slug = if existing_count == 0 {
        base_slug
    } else {
        format!("{}-{}", base_slug, existing_count)
    };

    sqlx::query(
        "INSERT INTO projects (id, name, slug, description, color, created_at, updated_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&payload.name)
    .bind(&project_slug)
    .bind(&payload.description)
    .bind(&color)
    .bind(now)
    .bind(now)
    .execute(&state.db)
    .await?;

    // Create project data directory structure.
    let project_dir = state.data_dir.join("projects").join(&id);
    for sub in &["attachments/images", "attachments/pdfs", "attachments/files"] {
        std::fs::create_dir_all(project_dir.join(sub))?;
    }

    let project = sqlx::query_as::<_, Project>(
        "SELECT id, name, slug, description, color, created_at, updated_at \
         FROM projects WHERE id = ?",
    )
    .bind(&id)
    .fetch_one(&state.db)
    .await?;

    info!(event = "project.created", id = %id, name = %payload.name);

    Ok((StatusCode::CREATED, Json(project)))
}

// ─── GET /:id ─────────────────────────────────────────────────────────────────

async fn get_project(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<ProjectDetail>> {
    let project = sqlx::query_as::<_, Project>(
        "SELECT id, name, slug, description, color, created_at, updated_at \
         FROM projects WHERE id = ?",
    )
    .bind(&id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("project '{}' not found", id)))?;

    let collections_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM collections WHERE project_id = ?",
    )
    .bind(&id)
    .fetch_one(&state.db)
    .await?;

    // Documents are linked to projects through their collection.
    let documents_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM documents d \
         JOIN collections c ON d.collection_id = c.id \
         WHERE c.project_id = ?",
    )
    .bind(&id)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(ProjectDetail {
        project,
        collections_count,
        documents_count,
    }))
}

// ─── PUT /:id ─────────────────────────────────────────────────────────────────

async fn update_project(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<UpdateProject>,
) -> Result<Json<Project>> {
    let project = sqlx::query_as::<_, Project>(
        "SELECT id, name, slug, description, color, created_at, updated_at \
         FROM projects WHERE id = ?",
    )
    .bind(&id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("project '{}' not found", id)))?;

    let now = Utc::now().timestamp();

    let new_name = payload.name.as_deref().unwrap_or(&project.name).to_string();
    let new_description: Option<String> = payload.description.or(project.description);
    let new_color = payload.color.as_deref().unwrap_or(&project.color).to_string();

    // Recompute slug only when the name actually changes.
    let new_slug = if payload.name.is_some() && new_name != project.name {
        let base = slugify(&new_name);
        let count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM projects WHERE slug LIKE ? AND id != ?",
        )
        .bind(format!("{}%", base))
        .bind(&id)
        .fetch_one(&state.db)
        .await?;
        if count == 0 { base } else { format!("{}-{}", base, count) }
    } else {
        project.slug.clone()
    };

    sqlx::query(
        "UPDATE projects \
         SET name = ?, slug = ?, description = ?, color = ?, updated_at = ? \
         WHERE id = ?",
    )
    .bind(&new_name)
    .bind(&new_slug)
    .bind(&new_description)
    .bind(&new_color)
    .bind(now)
    .bind(&id)
    .execute(&state.db)
    .await?;

    let updated = sqlx::query_as::<_, Project>(
        "SELECT id, name, slug, description, color, created_at, updated_at \
         FROM projects WHERE id = ?",
    )
    .bind(&id)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(updated))
}

// ─── DELETE /:id ──────────────────────────────────────────────────────────────

async fn delete_project(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode> {
    // 1. Verify the project exists.
    let project = sqlx::query_as::<_, Project>(
        "SELECT id, name, slug, description, color, created_at, updated_at \
         FROM projects WHERE id = ?",
    )
    .bind(&id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("project '{}' not found", id)))?;

    // 2. Collect ALL document IDs for this project (both collection docs
    //    and standalone docs) so we can clean the search index afterwards.
    let doc_ids = sqlx::query_scalar::<_, String>(
        "SELECT id FROM documents WHERE project_id = ?",
    )
    .bind(&id)
    .fetch_all(&state.db)
    .await?;

    // 4. Delete child data in dependency order.

    // Tags for all documents in this project.
    sqlx::query(
        "DELETE FROM tags WHERE doc_id IN \
         (SELECT d.id FROM documents d \
          JOIN collections c ON d.collection_id = c.id \
          WHERE c.project_id = ?)",
    )
    .bind(&id)
    .execute(&state.db)
    .await?;

    // Relations (source or target) for all documents in this project.
    sqlx::query(
        "DELETE FROM relations \
         WHERE source_id IN \
             (SELECT d.id FROM documents d \
              JOIN collections c ON d.collection_id = c.id \
              WHERE c.project_id = ?) \
         OR target_id IN \
             (SELECT d.id FROM documents d \
              JOIN collections c ON d.collection_id = c.id \
              WHERE c.project_id = ?)",
    )
    .bind(&id)
    .bind(&id)
    .execute(&state.db)
    .await?;

    // Attachments for all documents in this project.
    sqlx::query(
        "DELETE FROM attachments WHERE doc_id IN \
         (SELECT d.id FROM documents d \
          JOIN collections c ON d.collection_id = c.id \
          WHERE c.project_id = ?)",
    )
    .bind(&id)
    .execute(&state.db)
    .await?;

    // Document versions for all documents in this project.
    sqlx::query(
        "DELETE FROM document_versions WHERE doc_id IN \
         (SELECT d.id FROM documents d \
          JOIN collections c ON d.collection_id = c.id \
          WHERE c.project_id = ?)",
    )
    .bind(&id)
    .execute(&state.db)
    .await?;

    // Documents in all collections belonging to this project.
    sqlx::query(
        "DELETE FROM documents WHERE collection_id IN \
         (SELECT id FROM collections WHERE project_id = ?)",
    )
    .bind(&id)
    .execute(&state.db)
    .await?;

    // Collections belonging to this project.
    sqlx::query("DELETE FROM collections WHERE project_id = ?")
        .bind(&id)
        .execute(&state.db)
        .await?;

    // The project row itself.
    sqlx::query("DELETE FROM projects WHERE id = ?")
        .bind(&id)
        .execute(&state.db)
        .await?;

    // 5. Delete filesystem directory for this project.
    let project_dir = state.data_dir.join("projects").join(&id);
    if project_dir.exists() {
        std::fs::remove_dir_all(&project_dir)?;
    }

    // 6. Remove all project documents from the Tantivy search index.
    for doc_id in &doc_ids {
        state
            .search
            .delete_document(doc_id)
            .map_err(|e| AppError::Search(e.to_string()))?;
    }

    info!(event = "project.deleted", id = %id);

    Ok(StatusCode::NO_CONTENT)
}
