use axum::Router;
use crate::state::AppState;

pub mod attachments;
pub mod backup;
pub mod collections;
pub mod documents;
pub mod graph;
pub mod projects;
pub mod search;

pub fn router() -> Router<AppState> {
    Router::new()
        .nest("/api/collections", collections::router())
        .nest("/api/documents", documents::router())
        .nest("/api/search", search::router())
        .nest("/api/graph", graph::router())
        .nest("/api/attachments", attachments::router())
        .nest("/api/projects", projects::router())
        .nest("/api/backup", backup::router())
}
