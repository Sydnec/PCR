use std::{path::Path, time::Duration};

use sqlx::{
    SqlitePool,
    migrate::Migrator,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous},
};

static GAME_MIGRATIONS: Migrator = sqlx::migrate!("./migrations/game");

/// Nombre de lecteurs simultanés pour le bot et le site.
const READERS: u32 = 4;

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error(transparent)]
    Sqlx(#[from] sqlx::Error),
    #[error(transparent)]
    Migrate(#[from] sqlx::migrate::MigrateError),
}

/// La base permanente.
///
/// Une seule connexion d'écriture sérialise toutes les écritures : SQLite n'accepte de toute façon
/// qu'un écrivain, et plusieurs connexions d'écriture changeraient les transactions lecture→écriture
/// en erreurs `SQLITE_BUSY` qu'aucun délai d'attente ne résout. Les lecteurs restent simultanés
/// grâce au WAL.
#[derive(Debug, Clone)]
pub struct Db {
    writer: SqlitePool,
    reader: SqlitePool,
}

impl Db {
    /// Ouvre (ou crée) la base et applique les migrations en attente.
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

    /// Sonde de vie peu coûteuse, utilisée par `/healthz`.
    pub async fn ping(&self) -> Result<(), DbError> {
        sqlx::query("SELECT 1").execute(&self.reader).await?;
        Ok(())
    }

    /// Attend les requêtes en cours puis ferme toutes les connexions (arrêt propre).
    pub async fn close(&self) {
        self.writer.close().await;
        self.reader.close().await;
    }
}
