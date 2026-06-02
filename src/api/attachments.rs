use axum::{
    body::Body,
    extract::{Multipart, Path, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use tokio::fs;
use tokio_util::io::ReaderStream;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    models::attachment::Attachment,
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", post(upload_attachment))
        .route("/:id", get(get_attachment))
}

/// POST /attachments
///
/// Accepts a multipart body with two fields:
///   - `doc_id`  – plain text, the owning document's UUID string
///   - `file`    – the binary file upload (filename + content_type required)
async fn upload_attachment(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> Result<(StatusCode, Json<Attachment>)> {
    let mut doc_id: Option<String> = None;
    let mut project_id: Option<String> = None;
    let mut file_filename: Option<String> = None;
    let mut file_content_type: Option<String> = None;
    let mut file_bytes: Option<bytes::Bytes> = None;

    // Drain all multipart fields
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(format!("multipart error: {e}")))?
    {
        match field.name() {
            Some("doc_id") => {
                let text = field
                    .text()
                    .await
                    .map_err(|e| AppError::BadRequest(format!("failed to read doc_id: {e}")))?;
                doc_id = Some(text.trim().to_owned());
            }
            Some("project_id") => {
                let text = field
                    .text()
                    .await
                    .map_err(|e| AppError::BadRequest(format!("failed to read project_id: {e}")))?;
                project_id = Some(text.trim().to_owned());
            }
            Some("file") => {
                file_filename = field
                    .file_name()
                    .map(|s| s.to_owned());
                file_content_type = field
                    .content_type()
                    .map(|s| s.to_owned());
                let data = field
                    .bytes()
                    .await
                    .map_err(|e| AppError::BadRequest(format!("failed to read file bytes: {e}")))?;
                file_bytes = Some(data);
            }
            _ => {
                // Consume and discard unknown fields so the multipart reader stays healthy
                let _ = field.bytes().await;
            }
        }
    }

    // Validate that both required fields are present
    let doc_id = doc_id
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::BadRequest("missing or empty 'doc_id' field".into()))?;

    let project_id = project_id
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "default".to_string());

    let original_filename = file_filename
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::BadRequest("missing 'file' field or filename".into()))?;

    let data = file_bytes
        .ok_or_else(|| AppError::BadRequest("missing 'file' field".into()))?;

    // Resolve the MIME type: prefer the Content-Type reported by the browser,
    // fall back to guessing from the extension.
    let mime_type = file_content_type
        .filter(|s| !s.is_empty() && s != "application/octet-stream")
        .unwrap_or_else(|| {
            mime_guess::from_path(&original_filename)
                .first_or_octet_stream()
                .to_string()
        });

    // Determine sub-directory based on MIME type
    let subdir = if mime_type.starts_with("image/") {
        "images"
    } else if mime_type == "application/pdf" {
        "pdfs"
    } else {
        "files"
    };

    // Build the target directory under projects/<project_id>/attachments/<subdir>
    let target_dir = state
        .data_dir
        .join("projects")
        .join(&project_id)
        .join("attachments")
        .join(subdir);
    fs::create_dir_all(&target_dir).await?;

    // Derive the extension from the original filename (may be empty)
    let ext = std::path::Path::new(&original_filename)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| format!(".{e}"))
        .unwrap_or_default();

    // Give the stored file a unique name to avoid collisions
    let stored_name = format!("{}{}", Uuid::new_v4(), ext);
    let file_path = target_dir.join(&stored_name);

    // Write the bytes to disk
    fs::write(&file_path, &data).await?;

    // Relative path stored in the DB — unique across projects
    let relative_path = format!("{}/attachments/{}/{}", project_id, subdir, stored_name);

    let id = Uuid::new_v4().to_string();
    let size = data.len() as i64;
    let created_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    // Persist the record
    sqlx::query(
        r#"
        INSERT INTO attachments (id, doc_id, filename, path, mime_type, size, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(&id)
    .bind(&doc_id)
    .bind(&original_filename)
    .bind(&relative_path)
    .bind(&mime_type)
    .bind(size)
    .bind(created_at)
    .execute(&state.db)
    .await?;

    let attachment = Attachment {
        id,
        doc_id,
        filename: original_filename,
        path: relative_path,
        mime_type,
        size,
        created_at,
    };

    Ok((StatusCode::CREATED, Json(attachment)))
}

/// GET /attachments/:id
///
/// Looks up the attachment record in the database, reads the file from disk,
/// and streams it back with the correct `Content-Type` header.
async fn get_attachment(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response> {
    let attachment: Attachment = sqlx::query_as(
        "SELECT id, doc_id, filename, path, mime_type, size, created_at FROM attachments WHERE id = ?",
    )
    .bind(&id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("attachment '{id}' not found")))?;

    // Primary path: relative to data_dir/projects (new layout)
    let new_abs_path = state.data_dir.join("projects").join(&attachment.path);
    // Fallback: relative to the legacy attachments_dir
    let legacy_abs_path = state.attachments_dir.join(&attachment.path);

    let abs_path = if new_abs_path.exists() {
        new_abs_path
    } else {
        legacy_abs_path
    };

    let file = fs::File::open(&abs_path).await.map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            AppError::NotFound(format!(
                "attachment file not found on disk: {}",
                abs_path.display()
            ))
        } else {
            AppError::Io(e)
        }
    })?;

    let stream = ReaderStream::new(file);
    let body = Body::from_stream(stream);

    // Resolve the Content-Type: trust what's in the DB first, then guess
    let content_type = if attachment.mime_type.is_empty()
        || attachment.mime_type == "application/octet-stream"
    {
        mime_guess::from_path(&attachment.filename)
            .first_or_octet_stream()
            .to_string()
    } else {
        attachment.mime_type.clone()
    };

    let response = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(
            header::CONTENT_DISPOSITION,
            format!(
                "inline; filename=\"{}\"",
                attachment.filename.replace('"', "\\\"")
            ),
        )
        .header(header::CONTENT_LENGTH, attachment.size.to_string())
        .body(body)
        .map_err(|e| AppError::BadRequest(format!("failed to build response: {e}")))?;

    Ok(response)
}
