use axum::{middleware, routing::{get, post, put}, Router};
use crate::state::AppState;

pub mod attachments;
pub mod auth;
pub mod apikeys;
pub mod backup;
pub mod collections;
pub mod documents;
pub mod graph;
pub mod projects;
pub mod search;
pub mod settings;
pub mod users;

pub fn router(state: AppState) -> Router<AppState> {
    // Public routes — no auth required
    let public = Router::new()
        .route("/api/auth/login", post(auth::login))
        .route("/api/auth/logout", post(auth::logout));

    // Protected routes — require_auth middleware applied
    let protected = Router::new()
        .route("/api/auth/me", get(auth::me))
        .route("/api/auth/password", put(auth::change_password))
        .nest("/api/users", users::router())
        .nest("/api/api-keys", apikeys::router())
        .nest("/api/collections", collections::router())
        .nest("/api/documents", documents::router())
        .nest("/api/search", search::router())
        .nest("/api/graph", graph::router())
        .nest("/api/attachments", attachments::router())
        .nest("/api/projects", projects::router())
        .nest("/api/backup", backup::router())
        .nest("/api/settings", settings::router())
        .layer(middleware::from_fn_with_state(
            state,
            crate::auth::require_auth,
        ));

    public.merge(protected)
}
