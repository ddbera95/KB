use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use chrono::Utc;
use regex::Regex;
use serde::{Deserialize, Serialize};
use tracing::info;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    models::{
        Attachment, AppendDocument, BreadcrumbItem, CreateDocument, Document, DocumentDetail,
        DocumentVersion, UpdateDocument,
    },
    state::AppState,
};

// ─── Query param structs ──────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct ListDocsParams {
    pub collection_id: Option<String>,
    pub standalone: Option<bool>,
    pub page: Option<i64>,
    pub per_page: Option<i64>,
    pub project_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct PaginatedDocs {
    pub data: Vec<Document>,
    pub page: i64,
    pub per_page: i64,
    pub total: i64,
}

// ─── Router ───────────────────────────────────────────────────────────────────

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_documents).post(create_document))
        .route("/:id", get(get_document).put(update_document).delete(delete_document))
        .route("/:id/append", post(append_document))
        .route("/:id/children", get(list_children))
        .route("/:id/breadcrumb", get(get_breadcrumb))
        .route("/:id/backlinks", get(get_backlinks))
        .route("/:id/versions", get(list_versions))
        .route("/:id/versions/:ver", get(get_version))
        .route("/:id/attachments", get(list_attachments))
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

fn extract_wiki_links(content: &str) -> Vec<String> {
    let re = Regex::new(r"\[\[([^\]]+)\]\]").expect("static regex is valid");
    re.captures_iter(content)
        .map(|cap| cap[1].trim().to_string())
        .collect()
}

async fn insert_wiki_relations(
    db: &sqlx::Pool<sqlx::Sqlite>,
    source_id: &str,
    content: &str,
    now: i64,
) -> Result<()> {
    let titles = extract_wiki_links(content);
    if titles.is_empty() {
        return Ok(());
    }

    sqlx::query("DELETE FROM relations WHERE source_id = ? AND relation_type = 'wiki_link'")
        .bind(source_id)
        .execute(db)
        .await?;

    for title in titles {
        let target: Option<String> =
            sqlx::query_scalar::<_, String>("SELECT id FROM documents WHERE LOWER(title) = LOWER(?)")
                .bind(&title)
                .fetch_optional(db)
                .await?;

        if let Some(target_id) = target {
            if target_id == source_id {
                continue;
            }
            sqlx::query(
                "INSERT OR IGNORE INTO relations (source_id, target_id, relation_type, created_at)
                 VALUES (?, ?, 'wiki_link', ?)",
            )
            .bind(source_id)
            .bind(&target_id)
            .bind(now)
            .execute(db)
            .await?;
        }
    }

    Ok(())
}

async fn fetch_tags(db: &sqlx::Pool<sqlx::Sqlite>, doc_id: &str) -> Result<Vec<String>> {
    let tags = sqlx::query_scalar::<_, String>("SELECT tag FROM tags WHERE doc_id = ?")
        .bind(doc_id)
        .fetch_all(db)
        .await?;
    Ok(tags)
}

async fn sync_tags(db: &sqlx::Pool<sqlx::Sqlite>, doc_id: &str, tags: &[String]) -> Result<()> {
    sqlx::query("DELETE FROM tags WHERE doc_id = ?")
        .bind(doc_id)
        .execute(db)
        .await?;
    for tag in tags {
        sqlx::query("INSERT INTO tags (doc_id, tag) VALUES (?, ?)")
            .bind(doc_id)
            .bind(tag)
            .execute(db)
            .await?;
    }
    Ok(())
}

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

    let mut crumbs: Vec<BreadcrumbItem> = rows.into_iter().rev().collect();
    crumbs.pop(); // remove the document itself; keep only ancestors
    Ok(crumbs)
}

fn select_doc(extra_where: &str) -> String {
    format!(
        "SELECT id, project_id, collection_id, parent_id, title, slug, brief, content, \
                depth, sort_order, created_at, updated_at \
         FROM documents {extra_where}"
    )
}

// ─── GET / ────────────────────────────────────────────────────────────────────

async fn list_documents(
    State(state): State<AppState>,
    Query(params): Query<ListDocsParams>,
) -> Result<Json<PaginatedDocs>> {
    let page = params.page.unwrap_or(1).max(1);
    let per_page = params.per_page.unwrap_or(20).clamp(1, 200);
    let offset = (page - 1) * per_page;
    let standalone = params.standalone.unwrap_or(false);
    let project_id = params.project_id.as_deref().unwrap_or("default").to_string();

    let (docs, total): (Vec<Document>, i64) = match (&params.collection_id, standalone) {
        (Some(cid), _) => {
            let total = sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM documents WHERE collection_id = ? AND project_id = ?",
            )
            .bind(cid)
            .bind(&project_id)
            .fetch_one(&state.db)
            .await?;

            let docs = sqlx::query_as::<_, Document>(
                &select_doc("WHERE collection_id = ? AND project_id = ? ORDER BY sort_order ASC, created_at ASC LIMIT ? OFFSET ?"),
            )
            .bind(cid)
            .bind(&project_id)
            .bind(per_page)
            .bind(offset)
            .fetch_all(&state.db)
            .await?;

            (docs, total)
        }
        (None, true) => {
            let total = sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM documents WHERE collection_id IS NULL AND parent_id IS NULL AND project_id = ?",
            )
            .bind(&project_id)
            .fetch_one(&state.db)
            .await?;

            let docs = sqlx::query_as::<_, Document>(
                &select_doc("WHERE collection_id IS NULL AND parent_id IS NULL AND project_id = ? ORDER BY sort_order ASC, created_at ASC LIMIT ? OFFSET ?"),
            )
            .bind(&project_id)
            .bind(per_page)
            .bind(offset)
            .fetch_all(&state.db)
            .await?;

            (docs, total)
        }
        (None, false) => {
            let total = sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM documents WHERE project_id = ?",
            )
            .bind(&project_id)
            .fetch_one(&state.db)
            .await?;

            let docs = sqlx::query_as::<_, Document>(
                &select_doc("WHERE project_id = ? ORDER BY sort_order ASC, created_at ASC LIMIT ? OFFSET ?"),
            )
            .bind(&project_id)
            .bind(per_page)
            .bind(offset)
            .fetch_all(&state.db)
            .await?;

            (docs, total)
        }
    };

    Ok(Json(PaginatedDocs { data: docs, page, per_page, total }))
}

// ─── POST / ───────────────────────────────────────────────────────────────────

async fn create_document(
    State(state): State<AppState>,
    Json(payload): Json<CreateDocument>,
) -> Result<(StatusCode, Json<Document>)> {
    if payload.title.trim().is_empty() {
        return Err(AppError::BadRequest("title must not be empty".into()));
    }

    let id = Uuid::new_v4().to_string();
    let now = Utc::now().timestamp();
    let content = payload.content.unwrap_or_default();
    let tags = payload.tags.unwrap_or_default();

    // Resolve project_id: explicit payload value > derived from collection > default
    let project_id: String = if let Some(ref pid) = payload.project_id {
        pid.clone()
    } else if let Some(ref cid) = payload.collection_id {
        sqlx::query_scalar::<_, String>("SELECT project_id FROM collections WHERE id = ?")
            .bind(cid)
            .fetch_optional(&state.db)
            .await?
            .unwrap_or_else(|| "default".to_string())
    } else {
        "default".to_string()
    };

    let depth: i64 = if let Some(ref pid) = payload.parent_id {
        let parent = sqlx::query_scalar::<_, i64>("SELECT depth FROM documents WHERE id = ?")
            .bind(pid)
            .fetch_optional(&state.db)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("parent document '{}' not found", pid)))?;
        parent + 1
    } else {
        0
    };

    let base_slug = slug::slugify(&payload.title);
    let existing_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM documents WHERE slug LIKE ?",
    )
    .bind(format!("{}%", base_slug))
    .fetch_one(&state.db)
    .await?;
    let doc_slug = if existing_count == 0 {
        base_slug
    } else {
        format!("{}-{}", base_slug, existing_count)
    };

    sqlx::query(
        "INSERT INTO documents \
         (id, project_id, collection_id, parent_id, title, slug, brief, content, depth, sort_order, created_at, updated_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)",
    )
    .bind(&id)
    .bind(&project_id)
    .bind(&payload.collection_id)
    .bind(&payload.parent_id)
    .bind(&payload.title)
    .bind(&doc_slug)
    .bind(&payload.brief)
    .bind(&content)
    .bind(depth)
    .bind(now)
    .bind(now)
    .execute(&state.db)
    .await?;

    if !tags.is_empty() {
        sync_tags(&state.db, &id, &tags).await?;
    }

    insert_wiki_relations(&state.db, &id, &content, now).await?;

    state
        .search
        .index_document(&id, &payload.title, &content, &tags, payload.collection_id.as_deref(), payload.brief.as_deref(), &project_id)
        .map_err(|e| AppError::Search(e.to_string()))?;

    let doc = sqlx::query_as::<_, Document>(&select_doc("WHERE id = ?"))
        .bind(&id)
        .fetch_one(&state.db)
        .await?;

    info!(event = "doc.created", id = %id, title = %payload.title);

    Ok((StatusCode::CREATED, Json(doc)))
}

// ─── GET /:id ─────────────────────────────────────────────────────────────────

async fn get_document(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<DocumentDetail>> {
    let doc = sqlx::query_as::<_, Document>(&select_doc("WHERE id = ?"))
        .bind(&id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("document '{}' not found", id)))?;

    let tags = fetch_tags(&state.db, &id).await?;

    let children = sqlx::query_as::<_, Document>(
        &select_doc("WHERE parent_id = ? ORDER BY sort_order ASC, created_at ASC"),
    )
    .bind(&id)
    .fetch_all(&state.db)
    .await?;

    let breadcrumb = build_breadcrumb(&state.db, &id).await?;

    Ok(Json(DocumentDetail { document: doc, tags, children, breadcrumb }))
}

// ─── PUT /:id ─────────────────────────────────────────────────────────────────

async fn update_document(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<UpdateDocument>,
) -> Result<Json<Document>> {
    let doc = sqlx::query_as::<_, Document>(&select_doc("WHERE id = ?"))
        .bind(&id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("document '{}' not found", id)))?;

    let now = Utc::now().timestamp();

    // Save old version before overwriting.
    let version_id = Uuid::new_v4().to_string();
    let next_version = sqlx::query_scalar::<_, i64>(
        "SELECT COALESCE(MAX(version_number), 0) + 1 FROM document_versions WHERE doc_id = ?",
    )
    .bind(&id)
    .fetch_one(&state.db)
    .await?;

    sqlx::query(
        "INSERT INTO document_versions (id, doc_id, version_number, title, content, created_at) \
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&version_id)
    .bind(&id)
    .bind(next_version)
    .bind(&doc.title)
    .bind(&doc.content)
    .bind(now)
    .execute(&state.db)
    .await?;

    let new_title = payload.title.as_deref().unwrap_or(&doc.title).to_string();
    let new_brief: Option<String> = payload.brief.or(doc.brief);
    let new_content = payload.content.as_deref().unwrap_or(&doc.content).to_string();
    let new_sort_order = payload.sort_order.unwrap_or(doc.sort_order);
    let new_collection_id: Option<String> = payload.collection_id.or(doc.collection_id);

    let new_slug = if payload.title.is_some() && new_title != doc.title {
        let base = slug::slugify(&new_title);
        let count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM documents WHERE slug LIKE ? AND id != ?",
        )
        .bind(format!("{}%", base))
        .bind(&id)
        .fetch_one(&state.db)
        .await?;
        if count == 0 { base } else { format!("{}-{}", base, count) }
    } else {
        doc.slug.clone()
    };

    sqlx::query(
        "UPDATE documents \
         SET title = ?, slug = ?, brief = ?, content = ?, sort_order = ?, collection_id = ?, updated_at = ? \
         WHERE id = ?",
    )
    .bind(&new_title)
    .bind(&new_slug)
    .bind(&new_brief)
    .bind(&new_content)
    .bind(new_sort_order)
    .bind(&new_collection_id)
    .bind(now)
    .bind(&id)
    .execute(&state.db)
    .await?;

    if let Some(ref tags) = payload.tags {
        sync_tags(&state.db, &id, tags).await?;
    }

    if payload.content.is_some() {
        insert_wiki_relations(&state.db, &id, &new_content, now).await?;
    }

    let tags = fetch_tags(&state.db, &id).await?;
    let updated_doc = sqlx::query_as::<_, Document>(&select_doc("WHERE id = ?"))
        .bind(&id)
        .fetch_one(&state.db)
        .await?;

    state
        .search
        .index_document(&id, &updated_doc.title, &updated_doc.content, &tags, updated_doc.collection_id.as_deref(), updated_doc.brief.as_deref(), &updated_doc.project_id)
        .map_err(|e| AppError::Search(e.to_string()))?;

    info!(event = "doc.updated", id = %id);

    Ok(Json(updated_doc))
}

// ─── DELETE /:id ──────────────────────────────────────────────────────────────

async fn delete_document(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode> {
    let rows = sqlx::query("DELETE FROM documents WHERE id = ?")
        .bind(&id)
        .execute(&state.db)
        .await?
        .rows_affected();

    if rows == 0 {
        return Err(AppError::NotFound(format!("document '{}' not found", id)));
    }

    sqlx::query("DELETE FROM tags WHERE doc_id = ?").bind(&id).execute(&state.db).await?;
    sqlx::query("DELETE FROM relations WHERE source_id = ? OR target_id = ?")
        .bind(&id).bind(&id).execute(&state.db).await?;
    sqlx::query("DELETE FROM document_versions WHERE doc_id = ?").bind(&id).execute(&state.db).await?;

    state.search.delete_document(&id).map_err(|e| AppError::Search(e.to_string()))?;

    info!(event = "doc.deleted", id = %id);

    Ok(StatusCode::NO_CONTENT)
}

// ─── POST /:id/append ────────────────────────────────────────────────────────

async fn append_document(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<AppendDocument>,
) -> Result<Json<Document>> {
    let now = Utc::now().timestamp();

    let rows = sqlx::query("UPDATE documents SET content = content || ?, updated_at = ? WHERE id = ?")
        .bind(&payload.content)
        .bind(now)
        .bind(&id)
        .execute(&state.db)
        .await?
        .rows_affected();

    if rows == 0 {
        return Err(AppError::NotFound(format!("document '{}' not found", id)));
    }

    let doc = sqlx::query_as::<_, Document>(&select_doc("WHERE id = ?"))
        .bind(&id)
        .fetch_one(&state.db)
        .await?;

    insert_wiki_relations(&state.db, &id, &doc.content, now).await?;

    let tags = fetch_tags(&state.db, &id).await?;
    state
        .search
        .index_document(&id, &doc.title, &doc.content, &tags, doc.collection_id.as_deref(), doc.brief.as_deref(), &doc.project_id)
        .map_err(|e| AppError::Search(e.to_string()))?;

    Ok(Json(doc))
}

// ─── GET /:id/children ───────────────────────────────────────────────────────

async fn list_children(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Vec<Document>>> {
    let exists = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM documents WHERE id = ?")
        .bind(&id).fetch_one(&state.db).await?;
    if exists == 0 {
        return Err(AppError::NotFound(format!("document '{}' not found", id)));
    }

    let children = sqlx::query_as::<_, Document>(
        &select_doc("WHERE parent_id = ? ORDER BY sort_order ASC, created_at ASC"),
    )
    .bind(&id)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(children))
}

// ─── GET /:id/breadcrumb ─────────────────────────────────────────────────────

async fn get_breadcrumb(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Vec<BreadcrumbItem>>> {
    let exists = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM documents WHERE id = ?")
        .bind(&id).fetch_one(&state.db).await?;
    if exists == 0 {
        return Err(AppError::NotFound(format!("document '{}' not found", id)));
    }

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
    .bind(&id)
    .fetch_all(&state.db)
    .await?;

    let crumbs: Vec<BreadcrumbItem> = rows.into_iter().rev().collect();
    Ok(Json(crumbs))
}

// ─── GET /:id/backlinks ──────────────────────────────────────────────────────

async fn get_backlinks(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Vec<Document>>> {
    let exists = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM documents WHERE id = ?")
        .bind(&id).fetch_one(&state.db).await?;
    if exists == 0 {
        return Err(AppError::NotFound(format!("document '{}' not found", id)));
    }

    let backlinks = sqlx::query_as::<_, Document>(
        "SELECT d.id, d.project_id, d.collection_id, d.parent_id, d.title, d.slug, d.brief, \
                d.content, d.depth, d.sort_order, d.created_at, d.updated_at \
         FROM documents d \
         JOIN relations r ON d.id = r.source_id \
         WHERE r.target_id = ? \
         ORDER BY d.created_at DESC",
    )
    .bind(&id)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(backlinks))
}

// ─── GET /:id/versions ───────────────────────────────────────────────────────

async fn list_versions(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Vec<DocumentVersion>>> {
    let exists = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM documents WHERE id = ?")
        .bind(&id).fetch_one(&state.db).await?;
    if exists == 0 {
        return Err(AppError::NotFound(format!("document '{}' not found", id)));
    }

    let versions = sqlx::query_as::<_, DocumentVersion>(
        "SELECT id, doc_id, version_number, title, content, created_at \
         FROM document_versions WHERE doc_id = ? ORDER BY version_number DESC",
    )
    .bind(&id)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(versions))
}

// ─── GET /:id/versions/:ver ──────────────────────────────────────────────────

async fn get_version(
    State(state): State<AppState>,
    Path((id, ver)): Path<(String, i64)>,
) -> Result<Json<DocumentVersion>> {
    let exists = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM documents WHERE id = ?")
        .bind(&id).fetch_one(&state.db).await?;
    if exists == 0 {
        return Err(AppError::NotFound(format!("document '{}' not found", id)));
    }

    let version = sqlx::query_as::<_, DocumentVersion>(
        "SELECT id, doc_id, version_number, title, content, created_at \
         FROM document_versions WHERE doc_id = ? AND version_number = ?",
    )
    .bind(&id)
    .bind(ver)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("version {} of document '{}' not found", ver, id)))?;

    Ok(Json(version))
}

// ─── GET /:id/attachments ────────────────────────────────────────────────────

async fn list_attachments(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Vec<Attachment>>> {
    let exists = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM documents WHERE id = ?")
        .bind(&id).fetch_one(&state.db).await?;
    if exists == 0 {
        return Err(AppError::NotFound(format!("document '{}' not found", id)));
    }

    let attachments = sqlx::query_as::<_, Attachment>(
        "SELECT id, doc_id, filename, path, mime_type, size, created_at \
         FROM attachments WHERE doc_id = ? ORDER BY created_at DESC",
    )
    .bind(&id)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(attachments))
}
