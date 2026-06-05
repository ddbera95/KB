use std::{path::PathBuf, sync::Arc};
use tokio::sync::Mutex;
use tokio_cron_scheduler::JobScheduler;
use crate::auth::SessionStore;
use crate::search::SearchIndex;

#[derive(Clone)]
pub struct AppState {
    pub db: sqlx::Pool<sqlx::Sqlite>,
    pub search: Arc<SearchIndex>,
    pub data_dir: PathBuf,
    pub attachments_dir: PathBuf,
    pub scheduler: Arc<JobScheduler>,
    pub backup_job_id: Arc<Mutex<Option<uuid::Uuid>>>,
    pub sessions: SessionStore,
}
