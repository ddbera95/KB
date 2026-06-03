use axum::{
    extract::{Query, State},
    routing::{get, post},
    Json, Router,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use crate::{error::{AppError, Result}, state::AppState};

// ── Browse filesystem ─────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct BrowseParams {
    pub path: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

#[derive(Debug, Serialize)]
pub struct BrowseResponse {
    pub current: String,
    pub parent: Option<String>,
    pub entries: Vec<DirEntry>,
}

async fn browse(Query(params): Query<BrowseParams>) -> Result<Json<BrowseResponse>> {
    // Default to home directory, fall back to root
    let start = params.path.unwrap_or_else(|| {
        std::env::var("HOME").unwrap_or_else(|_| "/".to_string())
    });

    let path = PathBuf::from(&start);
    if !path.exists() || !path.is_dir() {
        return Err(AppError::BadRequest(format!("Not a directory: {}", start)));
    }

    let parent = path.parent().map(|p| p.to_string_lossy().to_string());

    let mut entries: Vec<DirEntry> = std::fs::read_dir(&path)
        .map_err(|e| AppError::Io(e))?
        .filter_map(|e| e.ok())
        .filter(|e| {
            // Only show directories, skip hidden dirs (starting with .)
            let name = e.file_name();
            let name_str = name.to_string_lossy();
            e.file_type().map(|t| t.is_dir()).unwrap_or(false)
                && !name_str.starts_with('.')
        })
        .map(|e| DirEntry {
            name: e.file_name().to_string_lossy().to_string(),
            path: e.path().to_string_lossy().to_string(),
            is_dir: true,
        })
        .collect();

    entries.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    Ok(Json(BrowseResponse {
        current: path.to_string_lossy().to_string(),
        parent,
        entries,
    }))
}

// ── Create backup ─────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct BackupRequest {
    pub destination: String,
}

#[derive(Debug, Serialize)]
pub struct BackupResponse {
    pub backup_path: String,
    pub size_mb: f64,
}

async fn create_backup(
    State(state): State<AppState>,
    Json(payload): Json<BackupRequest>,
) -> Result<Json<BackupResponse>> {
    let dest_root = PathBuf::from(&payload.destination);

    if !dest_root.exists() {
        return Err(AppError::BadRequest(format!(
            "Directory does not exist: {}",
            dest_root.display()
        )));
    }

    let ts = Utc::now().format("%Y-%m-%d_%H-%M-%S").to_string();
    let backup_dir = dest_root.join(format!("kb-backup-{}", ts));
    std::fs::create_dir_all(&backup_dir)?;

    copy_dir_recursive(&state.data_dir, &backup_dir)?;

    let size_bytes = dir_size(&backup_dir).unwrap_or(0);
    let size_mb = size_bytes as f64 / (1024.0 * 1024.0);

    Ok(Json(BackupResponse {
        backup_path: backup_dir.to_string_lossy().to_string(),
        size_mb,
    }))
}

// ── Router ────────────────────────────────────────────────────────────────────

// ── Create directory ──────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct MkdirRequest {
    pub parent: String,
    pub name: String,
}

#[derive(Debug, Serialize)]
pub struct MkdirResponse {
    pub path: String,
}

async fn mkdir(Json(payload): Json<MkdirRequest>) -> Result<Json<MkdirResponse>> {
    let name = payload.name.trim();
    if name.is_empty() || name.contains('/') || name.contains('\0') {
        return Err(AppError::BadRequest("Invalid folder name".into()));
    }
    let new_dir = PathBuf::from(&payload.parent).join(name);
    if new_dir.exists() {
        return Err(AppError::Conflict(format!("Folder '{}' already exists", name)));
    }
    std::fs::create_dir_all(&new_dir)?;
    Ok(Json(MkdirResponse {
        path: new_dir.to_string_lossy().to_string(),
    }))
}

// ── Router ────────────────────────────────────────────────────────────────────

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", post(create_backup))
        .route("/browse", get(browse))
        .route("/mkdir", post(mkdir))
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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
