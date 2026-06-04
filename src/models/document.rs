use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// Mirrors the `documents` table exactly.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Document {
    pub id: String,
    pub project_id: String,
    pub collection_id: Option<String>,
    pub parent_id: Option<String>,
    pub title: String,
    pub slug: String,
    pub brief: Option<String>,
    pub content: String,
    pub depth: i64,
    pub sort_order: i64,
    /// Unix timestamp (seconds).
    pub created_at: i64,
    /// Unix timestamp (seconds).
    pub updated_at: i64,
}

/// Mirrors the `document_versions` table exactly.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct DocumentVersion {
    pub id: String,
    pub doc_id: String,
    pub version_number: i64,
    pub title: String,
    pub content: String,
    /// Unix timestamp (seconds).
    pub created_at: i64,
}

/// Payload accepted when creating a new document.
#[derive(Debug, Deserialize)]
pub struct CreateDocument {
    pub title: String,
    pub project_id: Option<String>,
    pub collection_id: Option<String>,
    pub parent_id: Option<String>,
    pub brief: Option<String>,
    /// Defaults to an empty string when omitted.
    pub content: Option<String>,
    pub tags: Option<Vec<String>>,
}

/// Payload accepted when updating a document.
/// Every field is optional; only supplied fields are updated.
#[derive(Debug, Deserialize)]
pub struct UpdateDocument {
    pub title: Option<String>,
    pub brief: Option<String>,
    pub content: Option<String>,
    pub tags: Option<Vec<String>>,
    pub sort_order: Option<i64>,
    pub collection_id: Option<String>,
}

/// Payload accepted when appending text to an existing document.
#[derive(Debug, Deserialize)]
pub struct AppendDocument {
    pub content: String,
}

/// A single entry in the ancestor chain of a document.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct BreadcrumbItem {
    pub id: String,
    pub title: String,
    pub slug: String,
}

/// Rich response type returned by `GET /documents/:id` – includes tags,
/// immediate children, and the full ancestor breadcrumb trail.
#[derive(Debug, Serialize)]
pub struct DocumentDetail {
    pub document: Document,
    pub tags: Vec<String>,
    pub children: Vec<Document>,
    pub breadcrumb: Vec<BreadcrumbItem>,
}
