use std::{path::Path, time::Duration};

use sqlx::{
    SqlitePool,
    migrate::Migrator,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous},
};

static GAME_MIGRATIONS: Migrator = sqlx::migrate!("./migrations/game");

/// How many concurrent readers the bot and the website may use.
const READERS: u32 = 4;

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error(transparent)]
    Sqlx(#[from] sqlx::Error),
    #[error(transparent)]
    Migrate(#[from] sqlx::migrate::MigrateError),
}

/// The persistent database.
///
/// A single writer connection serialises every write: SQLite allows one writer anyway, and a
/// pool of writers would turn read-then-write transactions into `SQLITE_BUSY` errors that a busy
/// timeout cannot resolve. Readers stay concurrent thanks to WAL.
#[derive(Debug, Clone)]
pub struct Db {
    writer: SqlitePool,
    reader: SqlitePool,
}

impl Db {
    /// Opens (or creates) the database and applies pending migrations.
    pub async fn open(path: &Path) -> Result<Self, DbError> {
        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal)
            .synchronous(SqliteSynchronous::Normal)
            .foreign_keys(true)
            .busy_timeout(Duration::from_secs(5));

        let writer = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options.clone())
            .await?;
        GAME_MIGRATIONS.run(&writer).await?;

        let reader = SqlitePoolOptions::new()
            .max_connections(READERS)
            .connect_with(options.read_only(true))
            .await?;

        Ok(Self { writer, reader })
    }

    pub fn writer(&self) -> &SqlitePool {
        &self.writer
    }

    pub fn reader(&self) -> &SqlitePool {
        &self.reader
    }

    /// Cheap liveness probe used by `/healthz`.
    pub async fn ping(&self) -> Result<(), DbError> {
        sqlx::query("SELECT 1").execute(&self.reader).await?;
        Ok(())
    }

    /// Waits for in-flight queries, then closes every connection (graceful shutdown).
    pub async fn close(&self) {
        self.writer.close().await;
        self.reader.close().await;
    }
}
