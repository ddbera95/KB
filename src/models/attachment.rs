use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// Mirrors the `attachments` table exactly.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Attachment {
    pub id: String,
    pub doc_id: String,
    pub filename: String,
    /// Filesystem or object-store path to the stored file.
    pub path: String,
    pub mime_type: String,
    /// File size in bytes.
    pub size: i64,
    /// Unix timestamp (seconds).
    pub created_at: i64,
}

/// Payload used internally when recording a newly uploaded attachment.
/// The `id`, `path`, and `created_at` fields are populated by the handler,
/// so they are not part of the inbound request.
#[derive(Debug, Deserialize)]
pub struct CreateAttachment {
    pub doc_id: String,
    pub filename: String,
    pub mime_type: String,
    /// File size in bytes.
    pub size: i64,
}
