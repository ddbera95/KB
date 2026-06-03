use axum::{extract::State, routing::post, Json, Router};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use crate::{error::{AppError, Result}, state::AppState};

#[derive(Debug, Deserialize)]
pub struct BackupRequest {
    /// Destination directory — the backup folder will be created inside this path.
    pub destination: String,
}

#[derive(Debug, Serialize)]
pub struct BackupResponse {
    pub backup_path: String,
    pub size_mb: f64,
}

pub fn router() -> Router<AppState> {
    Router::new().route("/", post(create_backup))
}

async fn create_backup(
    State(state): State<AppState>,
    Json(payload): Json<BackupRequest>,
) -> Result<Json<BackupResponse>> {
    let dest_root = PathBuf::from(&payload.destination);

    if !dest_root.exists() {
        return Err(AppError::BadRequest(format!(
            "Destination directory does not exist: {}",
            dest_root.display()
        )));
    }

    // Create timestamped backup folder: kb-backup-YYYY-MM-DD_HH-MM-SS
    let ts = Utc::now().format("%Y-%m-%d_%H-%M-%S").to_string();
    let backup_dir = dest_root.join(format!("kb-backup-{}", ts));
    std::fs::create_dir_all(&backup_dir)?;

    // Copy the entire data directory
    copy_dir_recursive(&state.data_dir, &backup_dir)?;

    // Calculate size
    let size_bytes = dir_size(&backup_dir).unwrap_or(0);
    let size_mb = size_bytes as f64 / (1024.0 * 1024.0);

    Ok(Json(BackupResponse {
        backup_path: backup_dir.to_string_lossy().to_string(),
        size_mb,
    }))
}

fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let dst_path = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_recursive(&entry.path(), &dst_path)?;
        } else {
            std::fs::copy(entry.path(), &dst_path)?;
        }
    }
    Ok(())
}

fn dir_size(path: &std::path::Path) -> std::io::Result<u64> {
    let mut size = 0u64;
    for entry in std::fs::read_dir(path)? {
        let entry = entry?;
        let meta = entry.metadata()?;
        if meta.is_dir() {
            size += dir_size(&entry.path()).unwrap_or(0);
        } else {
            size += meta.len();
        }
    }
    Ok(size)
}
