use axum::{
    extract::{Query, State},
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};

use crate::{
    error::{AppError, Result},
    models::BreadcrumbItem,
    state::AppState,
};

// ---------------------------------------------------------------------------
// Query param struct
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct SearchParams {
    /// Full-text search query (required).
    pub q: String,
    /// Restrict results to a specific collection.
    pub collection_id: Option<String>,
    /// Only return results that are descendants of this document id.
    pub parent_id: Option<String>,
    /// Maximum number of results to return (default: 20).
    pub limit: Option<usize>,
    /// Restrict results to a specific project (default: "default").
    pub project_id: Option<String>,
}

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct SearchResultItem {
    pub id: String,
    pub title: String,
    pub brief: Option<String>,
    pub snippet: String,
    pub score: f32,
    pub breadcrumb: Vec<BreadcrumbItem>,
}

#[derive(Debug, Serialize)]
pub struct SearchResponse {
    pub results: Vec<SearchResultItem>,
    pub total: usize,
}

// ---------------------------------------------------------------------------
// Router builder
// ---------------------------------------------------------------------------

pub fn router() -> Router<AppState> {
    Router::new().route("/", get(search_handler))
}

// ---------------------------------------------------------------------------
// GET /api/search?q=&collection_id=&parent_id=&limit=20
// ---------------------------------------------------------------------------

async fn search_handler(
    State(state): State<AppState>,
    Query(params): Query<SearchParams>,
) -> Result<Json<SearchResponse>> {
    let query = params.q.trim().to_string();
    if query.is_empty() {
        return Err(AppError::BadRequest("query parameter 'q' must not be empty".into()));
    }

    let limit = params.limit.unwrap_or(20).clamp(1, 200);
    let project_id = params.project_id.clone().unwrap_or_else(|| "default".to_string());

    // Run Tantivy full-text search, optionally filtered by collection.
    let tantivy_results = state
        .search
        .search(&query, limit, params.collection_id.as_deref())
        .map_err(|e| AppError::Search(e.to_string()))?;

    // If parent_id filter is requested, resolve the set of descendant ids once
    // using a recursive CTE and then discard results that are not in that set.
    let descendant_ids: Option<std::collections::HashSet<String>> =
        if let Some(ref pid) = params.parent_id {
            // Verify the anchor document exists (scoped to the project).
            let exists = sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM documents WHERE id = ? AND project_id = ?",
            )
            .bind(pid)
            .bind(&project_id)
            .fetch_one(&state.db)
            .await?;
            if exists == 0 {
                return Err(AppError::NotFound(format!(
                    "parent document '{}' not found",
                    pid
                )));
            }

            // Walk the whole subtree (excluding the anchor itself so the
            // breadcrumb trail is meaningful).
            let ids = sqlx::query_scalar::<_, String>(
                r#"
                WITH RECURSIVE descendants(id) AS (
                    SELECT id FROM documents WHERE parent_id = ? AND project_id = ?
                    UNION ALL
                    SELECT d.id FROM documents d
                    INNER JOIN descendants c ON d.parent_id = c.id
                    WHERE d.project_id = ?
                )
                SELECT id FROM descendants
                "#,
            )
            .bind(pid)
            .bind(&project_id)
            .bind(&project_id)
            .fetch_all(&state.db)
            .await?;

            Some(ids.into_iter().collect::<std::collections::HashSet<String>>())
        } else {
            None
        };

    // Build final result list: attach breadcrumbs and apply parent filter.
    let mut items: Vec<SearchResultItem> = Vec::with_capacity(tantivy_results.len());

    for sr in tantivy_results {
        // Skip stale index entries and documents from other projects.
        let still_exists = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM documents WHERE id = ? AND project_id = ?",
        )
        .bind(&sr.id)
        .bind(&project_id)
        .fetch_one(&state.db)
        .await
        .unwrap_or(0);

        if still_exists == 0 {
            // Only clean from index if the doc is truly gone (not just in another project)
            let exists_anywhere = sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM documents WHERE id = ?",
            )
            .bind(&sr.id)
            .fetch_one(&state.db)
            .await
            .unwrap_or(0);
            if exists_anywhere == 0 {
                let _ = state.search.delete_document(&sr.id);
            }
            continue;
        }

        // Apply descendant filter if requested.
        if let Some(ref allowed) = descendant_ids {
            if !allowed.contains(&sr.id) {
                continue;
            }
        }

        let breadcrumb = build_breadcrumb(&state.db, &sr.id).await?;

        items.push(SearchResultItem {
            id: sr.id,
            title: sr.title,
            brief: sr.brief,
            snippet: sr.snippet,
            score: sr.score,
            breadcrumb,
        });
    }

    let total = items.len();
    Ok(Json(SearchResponse { results: items, total }))
}

// ---------------------------------------------------------------------------
// Helper: build ancestor breadcrumb for a document (root-first, excluding self)
// ---------------------------------------------------------------------------

async fn build_breadcrumb(
    db: &sqlx::Pool<sqlx::Sqlite>,
    doc_id: &str,
) -> Result<Vec<BreadcrumbItem>> {
    let rows = sqlx::query_as::<_, BreadcrumbItem>(
        r#"
        WITH RECURSIVE ancestors(id, title, slug, parent_id) AS (
            SELECT id, title, slug, parent_id FROM documents WHERE id = ?
            UNION ALL
            SELECT d.id, d.title, d.slug, d.parent_id
            FROM documents d INNER JOIN ancestors a ON d.id = a.parent_id
        )
        SELECT id, title, slug FROM ancestors
        "#,
    )
    .bind(doc_id)
    .fetch_all(db)
    .await?;

    // The CTE walks from the document upward; reverse for root-first order,
    // then drop the last element (the document itself).
    let mut crumbs: Vec<BreadcrumbItem> = rows.into_iter().rev().collect();
    crumbs.pop(); // remove the document itself — keep only ancestors
    Ok(crumbs)
}
