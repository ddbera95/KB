mod api;
mod config;
mod db;
mod error;
mod models;
mod search;
mod state;

use std::sync::Arc;

use axum::http::{HeaderValue, Method};
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::ServeDir;
use tower_http::trace::TraceLayer;
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::config::Config;
use crate::search::SearchIndex;
use crate::state::AppState;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Load .env file if present (best-effort; ignore error if missing)
    let _ = dotenvy::dotenv();

    // Initialise tracing via RUST_LOG env var (default: info)
    std::fs::create_dir_all("logs")?;
    let file_appender = tracing_appender::rolling::daily("logs", "mimix.log");
    let (non_blocking, _guard) = tracing_appender::non_blocking(file_appender);

    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "mimix=info,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .with(tracing_subscriber::fmt::layer().with_writer(non_blocking))
        .init();

    // Load configuration from environment
    let config = Config::from_env();
    info!("Starting KB server on port {}", config.port);
    info!("Data directory: {}", config.data_dir.display());

    // Create required data directories
    std::fs::create_dir_all(&config.data_dir)?;
    std::fs::create_dir_all(config.attachments_dir())?;
    std::fs::create_dir_all(config.tantivy_dir())?;
    // Ensure the SQLite directory exists
    if let Some(db_parent) = std::path::Path::new(&config.database_url)
        .strip_prefix("sqlite://")
        .ok()
        .and_then(|p| std::path::Path::new(p).parent())
    {
        std::fs::create_dir_all(db_parent)?;
    }

    // Connect to SQLite with WAL mode and foreign keys enabled
    let pool = db::connect(&config.database_url).await?;
    info!("Database connection established");

    // Run pending migrations
    sqlx::migrate!("./migrations").run(&pool).await?;
    info!("Migrations applied");

    // Open (or create) the Tantivy full-text search index
    let search_index = SearchIndex::new(&config.tantivy_dir())?;
    info!("Tantivy index ready at {}", config.tantivy_dir().display());

    // Build shared application state
    let state = AppState {
        db: pool,
        search: Arc::new(search_index),
        data_dir: config.data_dir.clone(),
        attachments_dir: config.attachments_dir(),
    };

    // CORS: allow the Vite dev server and any origin for dev convenience
    let cors = CorsLayer::new()
        .allow_origin(
            "http://localhost:5173"
                .parse::<HeaderValue>()
                .expect("valid origin"),
        )
        .allow_origin(Any)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers(Any);

    // Build the Axum router
    let app = api::router()
        .with_state(state)
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        // Serve the compiled frontend at /; fall back to index.html for SPA routing
        .fallback_service(ServeDir::new("frontend/build").append_index_html_on_directories(true));

    let addr = format!("0.0.0.0:{}", config.port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    info!("Listening on {}", addr);

    // Auto-backup scheduler — checks every minute
    let sched_data_dir = config.data_dir.clone();
    tokio::spawn(async move {
        let mut last_backup_day: Option<(u32, u32, i32)> = None;
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(60)).await;
            let settings = crate::api::settings::load_settings(&sched_data_dir);
            if let (Some(dir), Some(hour)) = (settings.auto_backup_dir, settings.auto_backup_hour) {
                if dir.trim().is_empty() { continue; }
                let now = chrono::Local::now();
                use chrono::{Datelike, Timelike};
                let cur = (now.day(), hour as u32, now.year());
                if now.hour() == hour as u32 && last_backup_day != Some(cur) {
                    match crate::api::settings::run_auto_backup(&dir, &sched_data_dir).await {
                        Ok(_) => {
                            info!("Auto backup completed → {}", dir);
                            last_backup_day = Some(cur);
                        }
                        Err(e) => tracing::warn!("Auto backup failed: {}", e),
                    }
                }
            }
        }
    });

    axum::serve(listener, app).await?;

    Ok(())
}
