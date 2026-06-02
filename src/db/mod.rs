use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode},
    SqlitePool,
};
use std::str::FromStr;

/// Connect to a SQLite database, creating the file if it does not yet exist.
///
/// Connection options applied:
/// - WAL journal mode — better concurrent read/write performance.
/// - Foreign key enforcement — ensures referential integrity.
pub async fn connect(database_url: &str) -> anyhow::Result<SqlitePool> {
    // Strip the "sqlite://" scheme prefix if present so FromStr can handle it
    let path = database_url
        .strip_prefix("sqlite://")
        .unwrap_or(database_url);

    let opts = SqliteConnectOptions::from_str(path)?
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .foreign_keys(true);

    Ok(SqlitePool::connect_with(opts).await?)
}
