use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// Mirrors the `collections` table exactly.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Collection {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub slug: String,
    pub description: Option<String>,
    pub icon: Option<String>,
    /// Unix timestamp (seconds).
    pub created_at: i64,
    /// Unix timestamp (seconds).
    pub updated_at: i64,
}

/// Payload accepted when creating a new collection.
#[derive(Debug, Deserialize)]
pub struct CreateCollection {
    pub name: String,
    /// Optional – server generates one from `name` when omitted.
    pub slug: Option<String>,
    pub description: Option<String>,
    pub icon: Option<String>,
}

/// Payload accepted when updating a collection.
/// Every field is optional; only supplied fields are updated.
#[derive(Debug, Deserialize)]
pub struct UpdateCollection {
    pub name: Option<String>,
    pub slug: Option<String>,
    pub description: Option<String>,
    pub icon: Option<String>,
}

/// Response type returned by `GET /collections/:id` – includes the
/// collection metadata plus the root-level documents that belong to it.
#[derive(Debug, Serialize, Deserialize)]
pub struct CollectionWithDocs {
    pub collection: Collection,
    pub root_docs: Vec<super::document::Document>,
}
