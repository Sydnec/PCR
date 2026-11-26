//! Outillage des tests de conversion : bases v1 construites sur le schéma gelé et `fixture_*.sql`,
//! dans un dossier propre à chaque test.

use std::path::{Path, PathBuf};

use sqlx::{Connection as _, SqliteConnection, SqlitePool, sqlite::SqliteConnectOptions};

use super::{Check, MigrateError, Options, Report, Sources, Targets, migrate, schema};

const FIXTURE_POINTS: &str = include_str!("fixture_points.sql");
const FIXTURE_BOTDATA: &str = include_str!("fixture_botdata.sql");
const FIXTURE_CONFIG: &str = r#"{"pokemon": {"spawn": {"shinyOdds": 512, "pingRarities": ["RARE", "TRES_RARE"]}},
        "birthday": {"enabled": false}}"#;

/// Une base v1 abîmée pour un test.
pub(super) enum Tweak {
    None,
    Points(&'static str),
    Botdata(&'static str),
}

pub(super) struct Fixture {
    pub(super) dir: PathBuf,
    pub(super) sources: Sources,
    pub(super) targets: Targets,
}

impl Fixture {
    /// Bases v1 de la fixture dans un dossier propre au test ; `tweak` en abîme une au besoin.
    pub(super) async fn new(name: &str, tweak: Tweak) -> Self {
        let dir = std::env::temp_dir().join(format!("pcr-migrate-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let v1 = dir.join("v1");
        std::fs::create_dir_all(&v1).expect("temp dir");
        let points = v1.join("points.db");
        let botdata = v1.join("botdata-2026.db");
        let config = v1.join("config.json");
        let (points_tweak, botdata_tweak) = match tweak {
            Tweak::None => (None, None),
            Tweak::Points(sql) => (Some(sql), None),
            Tweak::Botdata(sql) => (None, Some(sql)),
        };
        build(&points, schema::POINTS_DDL, FIXTURE_POINTS, points_tweak).await;
        build(
            &botdata,
            schema::BOTDATA_DDL,
            FIXTURE_BOTDATA,
            botdata_tweak,
        )
        .await;
        std::fs::write(&config, FIXTURE_CONFIG).expect("config.json");
        Self {
            sources: Sources {
                points,
                botdata,
                config: Some(config),
            },
            targets: Targets {
                pcr_db: dir.join("pcr.db"),
                stats_db: dir.join("stats-2026.db"),
            },
            dir,
        }
    }

    pub(super) async fn migrate(&self) -> Result<Report, MigrateError> {
        let options = Options {
            now_ms: 1_764_200_000_000,
            neutralize: false,
        };
        migrate(&self.sources, &self.targets, options).await
    }

    pub(super) fn nothing_written(&self) -> bool {
        !self.targets.pcr_db.exists()
            && !self.targets.stats_db.exists()
            && !self.dir.join("migrate-v1.work").exists()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

async fn build(path: &Path, ddl: &'static str, rows: &'static str, tweak: Option<&'static str>) {
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true);
    let mut conn = SqliteConnection::connect_with(&options)
        .await
        .expect("create v1 base");
    sqlx::raw_sql(ddl)
        .execute(&mut conn)
        .await
        .expect("v1 schema");
    sqlx::raw_sql(rows)
        .execute(&mut conn)
        .await
        .expect("fixture rows");
    if let Some(tweak) = tweak {
        sqlx::raw_sql(tweak)
            .execute(&mut conn)
            .await
            .expect("tweak");
    }
    conn.close().await.expect("close");
}

pub(super) async fn open(path: &Path) -> SqlitePool {
    SqlitePool::connect_with(SqliteConnectOptions::new().filename(path).read_only(true))
        .await
        .expect("open v2 base")
}

/// Une valeur scalaire, `None` pour NULL.
pub(super) async fn value(pool: &SqlitePool, sql: &'static str) -> Option<i64> {
    sqlx::query_scalar(sql).fetch_one(pool).await.expect(sql)
}

pub(super) fn notes<'a>(report: &'a Report, table: &str) -> Vec<&'a str> {
    report
        .tables
        .iter()
        .filter(|t| t.table == table)
        .flat_map(|t| t.notes.iter().map(String::as_str))
        .collect()
}

pub(super) fn check<'a>(report: &'a Report, name: &str) -> &'a Check {
    report
        .checks
        .iter()
        .find(|c| c.name == name)
        .unwrap_or_else(|| panic!("check {name}"))
}
