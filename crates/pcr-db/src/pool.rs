//! Ouverture des deux bases : un écrivain unique, un pool de lecteurs, les migrations appliquées.

use std::{path::Path, time::Duration};

use sqlx::{
    SqlitePool,
    migrate::Migrator,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous},
};

static GAME_MIGRATIONS: Migrator = sqlx::migrate!("./migrations/game");
static STATS_MIGRATIONS: Migrator = sqlx::migrate!("./migrations/stats");

/// Nombre de lecteurs simultanés pour le bot et le site.
const READERS: u32 = 4;

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error(transparent)]
    Sqlx(#[from] sqlx::Error),
    #[error(transparent)]
    Migrate(#[from] sqlx::migrate::MigrateError),
}

/// Les deux pools d'une base.
///
/// Une seule connexion d'écriture sérialise toutes les écritures : SQLite n'accepte de toute façon
/// qu'un écrivain, et plusieurs connexions d'écriture changeraient les transactions lecture→écriture
/// en erreurs `SQLITE_BUSY` qu'aucun délai d'attente ne résout. Les lecteurs restent simultanés
/// grâce au WAL.
#[derive(Debug, Clone)]
struct Pools {
    writer: SqlitePool,
    reader: SqlitePool,
}

impl Pools {
    async fn open(path: &Path, migrations: &Migrator) -> Result<Self, DbError> {
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
        migrations.run(&writer).await?;

        let reader = SqlitePoolOptions::new()
            .max_connections(READERS)
            .connect_with(options.read_only(true))
            .await?;

        Ok(Self { writer, reader })
    }

    /// Les lecteurs d'abord : la dernière connexion fermée est celle d'écriture, la seule qui puisse
    /// reverser le WAL dans le fichier et le supprimer. La base reste alors un fichier unique, ce que
    /// demandent la restauration et l'import.
    async fn close(&self) {
        self.reader.close().await;
        self.writer.close().await;
    }
}

/// La base permanente (`pcr.db`).
#[derive(Debug, Clone)]
pub struct Db(Pools);

impl Db {
    /// Ouvre (ou crée) la base et applique les migrations en attente.
    pub async fn open(path: &Path) -> Result<Self, DbError> {
        Pools::open(path, &GAME_MIGRATIONS).await.map(Self)
    }

    pub fn writer(&self) -> &SqlitePool {
        &self.0.writer
    }

    pub fn reader(&self) -> &SqlitePool {
        &self.0.reader
    }

    /// Sonde de vie peu coûteuse, utilisée par `/healthz`.
    pub async fn ping(&self) -> Result<(), DbError> {
        sqlx::query("SELECT 1").execute(&self.0.reader).await?;
        Ok(())
    }

    /// Attend les requêtes en cours puis ferme toutes les connexions (arrêt propre).
    pub async fn close(&self) {
        self.0.close().await;
    }
}

/// La base des statistiques d'une année (`stats-<ANNÉE>.db`).
///
/// Un type à part plutôt qu'un second `Db` : une fonction de stats appelée avec la base permanente
/// (ou l'inverse) ne compile pas, alors qu'elle échouerait seulement à l'exécution, faute de table.
#[derive(Debug, Clone)]
pub struct StatsDb(Pools);

impl StatsDb {
    /// Ouvre (ou crée) la base de l'année et applique les migrations en attente.
    pub async fn open(path: &Path) -> Result<Self, DbError> {
        Pools::open(path, &STATS_MIGRATIONS).await.map(Self)
    }

    pub fn writer(&self) -> &SqlitePool {
        &self.0.writer
    }

    pub fn reader(&self) -> &SqlitePool {
        &self.0.reader
    }

    /// Attend les requêtes en cours puis ferme toutes les connexions (arrêt propre).
    pub async fn close(&self) {
        self.0.close().await;
    }
}
