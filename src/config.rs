use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct Config {
    pub database_url: String,
    pub data_dir: PathBuf,
    pub port: u16,
}

impl Config {
    pub fn from_env() -> Self {
        let data_dir = std::env::var("DATA_DIR")
            .unwrap_or_else(|_| "./data".to_string());
        Self {
            database_url: std::env::var("DATABASE_URL")
                .unwrap_or_else(|_| "sqlite://./data/sqlite/knowledge.db".to_string()),
            data_dir: PathBuf::from(data_dir),
            port: std::env::var("PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(3000),
        }
    }

    pub fn attachments_dir(&self) -> PathBuf {
        self.data_dir.join("attachments")
    }

    pub fn tantivy_dir(&self) -> PathBuf {
        self.data_dir.join("tantivy")
    }
}
