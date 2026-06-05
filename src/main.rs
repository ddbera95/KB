mod api;
mod auth;
mod config;
mod db;
mod error;
mod models;
mod search;
mod state;

use std::collections::HashMap;
use std::sync::Arc;

use axum::http::{HeaderValue, Method};
use tokio::sync::Mutex;
use tokio_cron_scheduler::{Job, JobScheduler};
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
    let _ = dotenvy::dotenv();

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

    let config = Config::from_env();
    info!("Starting KB server on port {}", config.port);
    info!("Data directory: {}", config.data_dir.display());

    std::fs::create_dir_all(&config.data_dir)?;
    std::fs::create_dir_all(config.attachments_dir())?;
    std::fs::create_dir_all(config.tantivy_dir())?;
    if let Some(db_parent) = std::path::Path::new(&config.database_url)
        .strip_prefix("sqlite://")
        .ok()
        .and_then(|p| std::path::Path::new(p).parent())
    {
        std::fs::create_dir_all(db_parent)?;
    }

    let pool = db::connect(&config.database_url).await?;
    info!("Database connection established");

    // Backup DB before running migrations (stored outside data/ to avoid recursive copies)
    let db_path = std::path::Path::new(&config.database_url)
        .strip_prefix("sqlite://")
        .unwrap_or(std::path::Path::new(&config.database_url));
    if db_path.exists() {
        let backup_dir = std::path::PathBuf::from("db-backups");
        std::fs::create_dir_all(&backup_dir)?;
        let timestamp = chrono::Local::now().format("%Y-%m-%d-%H%M%S");
        let backup_path = backup_dir.join(format!("knowledge-{}.db", timestamp));
        std::fs::copy(db_path, &backup_path)?;
        info!("DB backed up to {}", backup_path.display());
    }

    sqlx::migrate!("./migrations").run(&pool).await?;
    info!("Migrations applied");

    // ── Ensure default admin user exists ──────────────────────────────────────
    let admin_exists: Option<String> =
        sqlx::query_scalar("SELECT id FROM users WHERE username = 'admin'")
            .fetch_optional(&pool)
            .await?;

    if admin_exists.is_none() {
        let admin_id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().timestamp();
        let hash = tokio::task::spawn_blocking(|| bcrypt::hash("admin", 12))
            .await??;
        sqlx::query(
            "INSERT INTO users (id, username, password_hash, is_admin, created_at) VALUES (?, 'admin', ?, 1, ?)",
        )
        .bind(&admin_id)
        .bind(&hash)
        .bind(now)
        .execute(&pool)
        .await?;
        info!("Default admin user created");
    }

    let search_index = SearchIndex::new(&config.tantivy_dir())?;
    info!("Tantivy index ready at {}", config.tantivy_dir().display());

    // Init cron scheduler
    let scheduler = Arc::new(JobScheduler::new().await?);
    let backup_job_id: Arc<Mutex<Option<uuid::Uuid>>> = Arc::new(Mutex::new(None));

    // Schedule auto backup from saved settings (if configured)
    let init_settings = crate::api::settings::load_settings(&config.data_dir);
    if let (Some(dir), Some(hour)) = (init_settings.auto_backup_dir, init_settings.auto_backup_hour) {
        if !dir.trim().is_empty() && hour <= 23 {
            let cron = format!("0 0 {} * * *", hour);
            let data_dir = config.data_dir.clone();
            let job = Job::new_async(cron.as_str(), move |_, _| {
                let d = data_dir.clone();
                let p = dir.clone();
                Box::pin(async move {
                    if let Err(e) = crate::api::settings::run_auto_backup(&p, &d).await {
                        tracing::warn!("Auto backup failed: {}", e);
                    }
                })
            })?;
            let id = scheduler.add(job).await?;
            *backup_job_id.lock().await = Some(id);
            info!("Auto backup scheduled at {:02}:00 daily", hour);
        }
    }

    scheduler.start().await?;

    // ── Session store ─────────────────────────────────────────────────────────
    let sessions: auth::SessionStore = Arc::new(Mutex::new(HashMap::new()));

    let state = AppState {
        db: pool,
        search: Arc::new(search_index),
        data_dir: config.data_dir.clone(),
        attachments_dir: config.attachments_dir(),
        scheduler,
        backup_job_id,
        sessions,
    };

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

    let app = api::router(state.clone())
        .with_state(state)
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .fallback_service(ServeDir::new("frontend/build").append_index_html_on_directories(true));

    let addr = format!("0.0.0.0:{}", config.port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    info!("Listening on {}", addr);

    axum::serve(listener, app).await?;

    Ok(())
}
