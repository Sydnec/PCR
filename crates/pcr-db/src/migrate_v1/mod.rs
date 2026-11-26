//! `pcr migrate-v1` : convertit les données de la v1 (`points.db`, `botdata-<ANNÉE>.db`,
//! `config.json`) en bases v2 (`pcr.db`, `stats-<ANNÉE>.db`).
//!
//! - Les fichiers v1 ne sont lus que par `VACUUM INTO` vers un dossier de travail : la conversion
//!   travaille sur ces copies, attachées à la base v2 neuve, et ne touche jamais aux originaux.
//! - Chaque base v2 se remplit en une transaction, après vérification de l'empreinte du schéma v1.
//!   Les bases ne prennent leur place qu'une fois les deux conversions réussies : un échec ne laisse
//!   rien derrière lui.
//! - Les requêtes sont construites à l'exécution (`sqlx::query`) : celles de `query!` se vérifient
//!   contre le schéma v2, et les tables v1 portent les mêmes noms. Leur texte ne vient que de
//!   constantes du code (tables, schémas, fragments SQL), jamais d'une donnée : d'où `AssertSqlSafe`.

mod config;
mod economy;
#[cfg(test)]
mod fixture;
mod items;
mod messages;
mod pokemon;
mod report;
mod safari;
mod schema;
mod seasons;
mod stats;
#[cfg(test)]
mod tests;

use std::path::{Path, PathBuf};

use sqlx::{AssertSqlSafe, Connection as _, SqliteConnection};

pub use report::{Check, Report, TableReport};

use crate::{Db, DbError, StatsDb, backup, import_prod};

/// Les fichiers de la v1. `config.json` manque quand personne n'a rien réglé à chaud.
#[derive(Debug, Clone)]
pub struct Sources {
    pub points: PathBuf,
    pub botdata: PathBuf,
    pub config: Option<PathBuf>,
}

/// Les bases v2 à créer ; aucune ne doit exister. Les deux dans le même dossier : le dossier de
/// travail est leur voisin, et un renommage ne traverse pas les systèmes de fichiers.
#[derive(Debug, Clone)]
pub struct Targets {
    pub pcr_db: PathBuf,
    pub stats_db: PathBuf,
}

#[derive(Debug, Clone, Copy)]
pub struct Options {
    /// Date de la conversion : celle des surcharges de config reprises.
    pub now_ms: i64,
    /// Neutraliser ce qui pointe vers la prod (instance de dev), avant la mise en place.
    pub neutralize: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum MigrateError {
    #[error("{} already exists: migrate-v1 never replaces a v2 database", .0.display())]
    TargetExists(PathBuf),
    #[error("unexpected v1 schema in {schema}: {}", .gaps.join(", "))]
    Schema { schema: String, gaps: Vec<String> },
    #[error("converting {table}: {source}")]
    Step {
        table: &'static str,
        #[source]
        source: sqlx::Error,
    },
    #[error("broken foreign keys after conversion: {0}")]
    ForeignKeys(String),
    #[error("unreadable config.json: {0}")]
    Config(String),
    #[error(transparent)]
    Db(#[from] DbError),
    #[error(transparent)]
    Sqlx(#[from] sqlx::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

/// Convertit `sources` vers `targets` et rend le rapport. Les contrôles en écart n'empêchent pas la
/// mise en place : ils sont à relire avant de démarrer le bot.
pub async fn migrate(
    sources: &Sources,
    targets: &Targets,
    options: Options,
) -> Result<Report, MigrateError> {
    for target in [&targets.pcr_db, &targets.stats_db] {
        if target.exists() {
            return Err(MigrateError::TargetExists(target.clone()));
        }
    }
    let work = targets.pcr_db.with_file_name("migrate-v1.work");
    let _ = std::fs::remove_dir_all(&work);
    std::fs::create_dir_all(&work)?;
    let result = run(sources, targets, &work, options).await;
    let _ = std::fs::remove_dir_all(&work);
    result
}

async fn run(
    sources: &Sources,
    targets: &Targets,
    work: &Path,
    options: Options,
) -> Result<Report, MigrateError> {
    let points = work.join("points-v1.db");
    let botdata = work.join("botdata-v1.db");
    backup::vacuum_into(&sources.points, &points).await?;
    backup::vacuum_into(&sources.botdata, &botdata).await?;
    let overrides = match &sources.config {
        Some(path) => config::read(path)?,
        None => Vec::new(),
    };

    let mut report = Report::default();

    let game = work.join("pcr.db");
    let db = Db::open(&game).await?;
    let converted = convert_game(&db, &points, &botdata, &overrides, options, &mut report).await;
    let converted = match converted {
        Ok(()) if options.neutralize => import_prod::neutralize(&db, options.now_ms)
            .await
            .map(drop)
            .map_err(MigrateError::from),
        other => other,
    };
    db.close().await;
    converted?;

    let stats_path = work.join("stats.db");
    let stats = StatsDb::open(&stats_path).await?;
    let converted = convert_stats(&stats, &botdata, &mut report).await;
    stats.close().await;
    converted?;

    // `pcr.db` en dernier : c'est sa présence qui dit qu'une conversion a eu lieu. S'il ne peut pas
    // prendre sa place, la base de stats repart aussi : une relance ne doit pas buter sur elle.
    std::fs::rename(&stats_path, &targets.stats_db)?;
    if let Err(error) = std::fs::rename(&game, &targets.pcr_db) {
        let _ = std::fs::remove_file(&targets.stats_db);
        return Err(error.into());
    }
    Ok(report)
}

async fn convert_game(
    db: &Db,
    points: &Path,
    botdata: &Path,
    overrides: &[(String, String)],
    options: Options,
    report: &mut Report,
) -> Result<(), MigrateError> {
    let mut conn = db.writer().acquire().await?;
    attach(&mut conn, points, "v1").await?;
    attach(&mut conn, botdata, "v1y").await?;
    let converted = async {
        schema::check(&mut conn, "v1", schema::POINTS_DDL).await?;
        schema::check(&mut conn, "v1y", schema::BOTDATA_DDL).await?;

        let mut tx = conn.begin().await?;
        // L'ordre des tables ne suit pas toujours les clés étrangères (une contre-offre peut citer
        // une offre plus récente) : elles se vérifient à la fin, et toutes ensemble.
        sqlx::query("PRAGMA defer_foreign_keys = ON")
            .execute(&mut *tx)
            .await?;
        economy::convert(&mut tx, report).await?;
        config::convert(&mut tx, report, overrides, options.now_ms).await?;
        pokemon::convert(&mut tx, report).await?;
        items::convert(&mut tx, report).await?;
        safari::convert(&mut tx, report).await?;
        seasons::convert(&mut tx, report).await?;
        messages::convert(&mut tx, report).await?;
        economy::check(&mut tx, report).await?;
        pokemon::check(&mut tx, report).await?;
        foreign_keys(&mut tx).await?;
        tx.commit().await?;
        Ok::<_, MigrateError>(())
    }
    .await;
    detach(&mut conn, &["v1", "v1y"]).await;
    converted
}

async fn convert_stats(
    stats: &StatsDb,
    botdata: &Path,
    report: &mut Report,
) -> Result<(), MigrateError> {
    let mut conn = stats.writer().acquire().await?;
    attach(&mut conn, botdata, "v1y").await?;
    let converted = async {
        let mut tx = conn.begin().await?;
        stats::convert(&mut tx, report).await?;
        stats::check(&mut tx, report).await?;
        tx.commit().await?;
        Ok::<_, MigrateError>(())
    }
    .await;
    detach(&mut conn, &["v1y"]).await;
    converted
}

async fn attach(
    conn: &mut SqliteConnection,
    path: &Path,
    schema: &str,
) -> Result<(), MigrateError> {
    let path = path.to_string_lossy();
    sqlx::query(AssertSqlSafe(format!("ATTACH DATABASE ? AS {schema}")))
        .bind(path.as_ref())
        .execute(&mut *conn)
        .await?;
    Ok(())
}

/// Une connexion rendue au pool avec ses bases attachées les garderait ouvertes : le dossier de
/// travail ne se supprimerait plus proprement.
async fn detach(conn: &mut SqliteConnection, schemas: &[&str]) {
    for schema in schemas {
        if let Err(error) = sqlx::query(AssertSqlSafe(format!("DETACH DATABASE {schema}")))
            .execute(&mut *conn)
            .await
        {
            tracing::warn!(%error, schema, "detaching a v1 copy failed");
        }
    }
}

async fn foreign_keys(conn: &mut SqliteConnection) -> Result<(), MigrateError> {
    let broken: Vec<(String, i64, String)> =
        sqlx::query_as("SELECT \"table\", rowid, parent FROM pragma_foreign_key_check")
            .fetch_all(&mut *conn)
            .await?;
    if broken.is_empty() {
        return Ok(());
    }
    let listed: Vec<String> = broken
        .iter()
        .take(20)
        .map(|(table, rowid, parent)| format!("{table}#{rowid} → {parent}"))
        .collect();
    Err(MigrateError::ForeignKeys(format!(
        "{} ({} in total)",
        listed.join(", "),
        broken.len()
    )))
}

/// Vrai si `col` est un identifiant Discord v1 utilisable : du texte de chiffres sans zéro de tête,
/// qui tient dans un i64. Écarte `''` (offre ouverte), `__global__` (totaux des stats) et NULL.
fn is_id(col: &str) -> String {
    format!("({col} GLOB '[1-9]*' AND {col} NOT GLOB '*[^0-9]*' AND length({col}) <= 19)")
}

/// L'identifiant en INTEGER, NULL s'il est absent ou inutilisable.
fn opt_id(col: &str) -> String {
    format!("CASE WHEN {} THEN CAST({col} AS INTEGER) END", is_id(col))
}

/// Un booléen v1 (0, 1 ou NULL) ramené à 0 ou 1.
fn flag(col: &str) -> String {
    format!("(COALESCE({col}, 0) <> 0)")
}
