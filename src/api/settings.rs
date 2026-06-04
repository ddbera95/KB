use tracing::info;
use axum::{extract::State, routing::get, Json, Router};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use crate::{error::{AppError, Result}, state::AppState};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Settings {
    pub manual_backup_dir: Option<String>,
    pub auto_backup_dir:   Option<String>,
    pub auto_backup_hour:  Option<u8>,
}

pub fn settings_path(data_dir: &PathBuf) -> PathBuf {
    data_dir.join("settings.json")
}

pub fn load_settings(data_dir: &PathBuf) -> Settings {
    let path = settings_path(data_dir);
    if let Ok(raw) = std::fs::read_to_string(&path) {
        serde_json::from_str(&raw).unwrap_or_default()
    } else {
        Settings::default()
    }
}

pub fn save_settings(data_dir: &PathBuf, s: &Settings) -> std::io::Result<()> {
    std::fs::write(settings_path(data_dir), serde_json::to_string_pretty(s).unwrap())
}

pub async fn run_auto_backup(auto_dir: &str, data_dir: &PathBuf) -> std::io::Result<()> {
    use crate::api::backup::{copy_dir_recursive, dir_size};
    let base      = PathBuf::from(auto_dir);
    let tmp_dir   = base.join("mimix-backup-tmp");
    let final_dir = base.join("mimix-backup");

    if tmp_dir.exists() { std::fs::remove_dir_all(&tmp_dir)?; }
    std::fs::create_dir_all(&tmp_dir)?;
    copy_dir_recursive(data_dir, &tmp_dir)?;
    if final_dir.exists() { std::fs::remove_dir_all(&final_dir)?; }
    std::fs::rename(&tmp_dir, &final_dir)?;

    let size_mb = dir_size(&final_dir).unwrap_or(0) as f64 / (1024.0 * 1024.0);
    info!(event = "backup.auto", path = %final_dir.display(), size_mb = format!("{:.2}", size_mb));
    Ok(())
}

async fn get_settings(State(st): State<AppState>) -> Result<Json<Settings>> {
    Ok(Json(load_settings(&st.data_dir)))
}

async fn put_settings(
    State(st): State<AppState>,
    Json(body): Json<Settings>,
) -> Result<Json<Settings>> {
    if let Some(h) = body.auto_backup_hour {
        if h > 23 {
            return Err(AppError::BadRequest("auto_backup_hour must be 0–23".into()));
        }
    }
    save_settings(&st.data_dir, &body).map_err(AppError::Io)?;
    Ok(Json(body))
}

pub fn router() -> Router<AppState> {
    Router::new().route("/", get(get_settings).put(put_settings))
}
