use std::{path::PathBuf, sync::Arc};
use crate::search::SearchIndex;

#[derive(Clone)]
pub struct AppState {
    pub db: sqlx::Pool<sqlx::Sqlite>,
    pub search: Arc<SearchIndex>,
    pub data_dir: PathBuf,
    pub attachments_dir: PathBuf,
}
