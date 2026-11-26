//! Tests de la conversion v1 → v2 sur la fixture synthétique (schéma v1 gelé + `fixture_*.sql`).

use std::path::{Path, PathBuf};

use sqlx::{Connection as _, SqliteConnection, SqlitePool, sqlite::SqliteConnectOptions};

use super::{MigrateError, Options, Report, Sources, Targets, migrate, schema};

const FIXTURE_POINTS: &str = include_str!("fixture_points.sql");
const FIXTURE_BOTDATA: &str = include_str!("fixture_botdata.sql");
const FIXTURE_CONFIG: &str = r#"{"pokemon": {"spawn": {"shinyOdds": 512, "pingRarities": ["RARE", "TRES_RARE"]}},
        "birthday": {"enabled": false}}"#;

struct Fixture {
    dir: PathBuf,
    sources: Sources,
    targets: Targets,
}

impl Fixture {
    /// Bases v1 de la fixture dans un dossier propre au test ; `tweak` les abîme au besoin.
    async fn new(name: &str, tweak: &'static str) -> Self {
        let dir = std::env::temp_dir().join(format!("pcr-migrate-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let v1 = dir.join("v1");
        std::fs::create_dir_all(&v1).expect("temp dir");
        let points = v1.join("points.db");
        let botdata = v1.join("botdata-2026.db");
        let config = v1.join("config.json");
        build(&points, schema::POINTS_DDL, FIXTURE_POINTS, tweak).await;
        build(&botdata, schema::BOTDATA_DDL, FIXTURE_BOTDATA, "").await;
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

    async fn migrate(&self) -> Result<Report, MigrateError> {
        let options = Options {
            now_ms: 1_764_200_000_000,
            neutralize: false,
        };
        migrate(&self.sources, &self.targets, options).await
    }

    fn nothing_written(&self) -> bool {
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

async fn build(path: &Path, ddl: &'static str, rows: &'static str, tweak: &'static str) {
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
    if !tweak.is_empty() {
        sqlx::raw_sql(tweak)
            .execute(&mut conn)
            .await
            .expect("tweak");
    }
    conn.close().await.expect("close");
}

async fn open(path: &Path) -> SqlitePool {
    SqlitePool::connect_with(SqliteConnectOptions::new().filename(path).read_only(true))
        .await
        .expect("open v2 base")
}

/// Une valeur scalaire, `None` pour NULL.
async fn value(pool: &SqlitePool, sql: &'static str) -> Option<i64> {
    sqlx::query_scalar(sql).fetch_one(pool).await.expect(sql)
}

fn notes<'a>(report: &'a Report, table: &str) -> Vec<&'a str> {
    report
        .tables
        .iter()
        .filter(|t| t.table == table)
        .flat_map(|t| t.notes.iter().map(String::as_str))
        .collect()
}

fn check<'a>(report: &'a Report, name: &str) -> &'a super::Check {
    report
        .checks
        .iter()
        .find(|c| c.name == name)
        .unwrap_or_else(|| panic!("check {name}"))
}

#[tokio::test]
async fn the_fixture_converts_with_every_correction_reported() {
    let fixture = Fixture::new("ok", "").await;
    let report = fixture.migrate().await.expect("conversion");
    let game = open(&fixture.targets.pcr_db).await;
    let stats = open(&fixture.targets.stats_db).await;

    expect_economy(&game, &report).await;
    expect_bets(&game).await;
    expect_reminders(&game).await;
    expect_pokemon(&game, &report).await;
    expect_public_messages(&game).await;
    expect_config(&game).await;
    expect_stats(&stats, &report).await;

    game.close().await;
    stats.close().await;
    assert!(!fixture.dir.join("migrate-v1.work").exists());
}

async fn expect_economy(game: &SqlitePool, report: &Report) {
    // Économie : « __bad » écarté et signalé, solde négatif gardé, jour vide → NULL.
    assert_eq!(value(game, "SELECT count(*) FROM points").await, Some(2));
    assert_eq!(
        value(
            game,
            "SELECT balance FROM points WHERE user_id = 222222222222222222"
        )
        .await,
        Some(-200)
    );
    assert_eq!(
        value(
            game,
            "SELECT count(*) FROM points WHERE messages_day IS NULL"
        )
        .await,
        Some(1)
    );
    assert_eq!(
        notes(report, "points"),
        ["1 écartée(s) : identifiant de membre invalide"]
    );
    let balances = check(report, "somme des soldes");
    assert!(!balances.ok);
    assert_eq!(balances.detail, "v1 4850, v2 4800");
    assert_eq!(
        value(game, "SELECT redistribution_since FROM economy_state").await,
        Some(0)
    );
    assert_eq!(
        value(
            game,
            "SELECT count(*) FROM points_redistributions WHERE triggered_by IS NULL"
        )
        .await,
        Some(1)
    );
}

async fn expect_bets(game: &SqlitePool) {
    // Paris : option gagnante et vraie valeur séparées, estimation sans option, option absente écartée.
    assert_eq!(
        value(game, "SELECT winning_option FROM bets WHERE id = 1").await,
        Some(2)
    );
    assert_eq!(
        value(game, "SELECT estimate_result FROM bets WHERE id = 2").await,
        Some(42)
    );
    assert_eq!(
        value(game, "SELECT winning_option FROM bets WHERE id = 2").await,
        None
    );
    assert_eq!(
        value(
            game,
            "SELECT prediction FROM bet_participations WHERE bet_id = 2"
        )
        .await,
        Some(40)
    );
    assert_eq!(
        value(game, "SELECT count(*) FROM bet_options").await,
        Some(4)
    );
    assert_eq!(
        value(game, "SELECT count(*) FROM bet_participations").await,
        Some(4)
    );
}

async fn expect_reminders(game: &SqlitePool) {
    // Rappels venus de la base annuelle : un envoi sans date prend l'échéance.
    assert_eq!(value(game, "SELECT count(*) FROM reminders").await, Some(2));
    assert_eq!(
        value(game, "SELECT sent_at FROM reminders WHERE id = 2").await,
        Some(1_763_000_000_000)
    );
}

async fn expect_pokemon(game: &SqlitePool, report: &Report) {
    // Pokémon : orphelins et sentinelles.
    assert_eq!(
        value(game, "SELECT message_count FROM pokemon_state").await,
        Some(12)
    );
    assert_eq!(
        value(game, "SELECT count(*) FROM pokemon_throws").await,
        Some(3)
    );
    assert_eq!(
        value(game, "SELECT spawn_id FROM pokemon_drops WHERE id = 2").await,
        None
    );
    assert_eq!(
        value(game, "SELECT pc_pos FROM pokemon_owned WHERE id = 2").await,
        None
    );
    assert_eq!(
        value(
            game,
            "SELECT count(*) FROM pokemon_pc_boxes WHERE name IS NULL"
        )
        .await,
        Some(1)
    );
    assert_eq!(
        value(game, "SELECT to_user_id FROM pokemon_trades WHERE id = 2").await,
        None
    );
    assert_eq!(
        value(
            game,
            "SELECT offer_species_id FROM pokemon_trades WHERE id = 2"
        )
        .await,
        None
    );
    assert_eq!(
        value(
            game,
            "SELECT offer_item_qty FROM pokemon_trades WHERE id = 3"
        )
        .await,
        Some(1)
    );
    assert_eq!(
        value(game, "SELECT counter_of FROM pokemon_trades WHERE id = 4").await,
        Some(3)
    );
    assert_eq!(
        value(game, "SELECT counter_of FROM pokemon_trades WHERE id = 5").await,
        None
    );
    assert_eq!(
        value(game, "SELECT to_user_id FROM pokemon_trade_drafts").await,
        None
    );
    assert_eq!(
        value(
            game,
            "SELECT wins FROM pokemon_lottery WHERE user_id = 333333333333333333"
        )
        .await,
        Some(2)
    );
    assert_eq!(
        value(game, "SELECT count(*) FROM pokemon_starter_rewards").await,
        Some(1)
    );
    assert_eq!(
        value(game, "SELECT count(*) FROM pokemon_safari_catches").await,
        Some(1)
    );
    for name in [
        "Pokémon possédés",
        "objets dans les sacs",
        "échanges en attente",
    ] {
        assert!(check(report, name).ok, "{name}");
    }
}

async fn expect_public_messages(game: &SqlitePool) {
    // Messages publics : à jour si la fin est écrite ou l'entité ouverte, pas de ligne sans message.
    let synced: Vec<(String, i64, i64)> = sqlx::query_as(
        "SELECT kind, entity_id, synced_version FROM public_messages ORDER BY kind, entity_id",
    )
    .fetch_all(game)
    .await
    .expect("public messages");
    let synced: Vec<(&str, i64, i64)> = synced
        .iter()
        .map(|(k, e, s)| (k.as_str(), *e, *s))
        .collect();
    assert_eq!(
        synced,
        [
            ("drop", 1, 1),
            ("drop", 2, 1),
            ("safari_live", 1, 0),
            ("safari_park", 1, 1),
            ("season_recap", 1, 1),
            ("spawn", 1, 1),
            ("spawn", 2, 0),
            ("spawn", 3, 1),
            ("trade", 1, 1),
            ("trade", 2, 1),
            ("trade", 3, 1),
            ("trade", 4, 1),
            ("trade", 5, 0),
        ]
    );
}

async fn expect_config(game: &SqlitePool) {
    // config.json : une ligne par feuille, les tableaux entiers.
    let shiny: String = sqlx::query_scalar(
        "SELECT value FROM config_overrides WHERE key = 'pokemon.spawn.shinyOdds'",
    )
    .fetch_one(game)
    .await
    .expect("override");
    assert_eq!(shiny, "512");
    assert_eq!(
        value(game, "SELECT count(*) FROM config_overrides").await,
        Some(3)
    );
}

async fn expect_stats(stats: &SqlitePool, report: &Report) {
    // Stats : plus de ligne « __global__ », totaux identiques par agrégat.
    assert_eq!(
        value(stats, "SELECT count(*) FROM message_stats").await,
        Some(2)
    );
    assert_eq!(
        value(stats, "SELECT count(*) FROM emoji_stats").await,
        Some(1)
    );
    assert_eq!(value(stats, "SELECT joined_at FROM voice_time").await, None);
    assert_eq!(
        value(stats, "SELECT evolution_points FROM pokemon_stats").await,
        Some(500)
    );
    for name in [
        "messages du serveur",
        "réactions du serveur",
        "lancers du serveur",
    ] {
        assert!(check(report, name).ok, "{name}");
    }
}

#[tokio::test]
async fn a_v1_schema_that_drifted_from_the_frozen_one_is_refused() {
    let fixture = Fixture::new("schema", "ALTER TABLE points ADD COLUMN streak INTEGER").await;
    let error = fixture.migrate().await.expect_err("unknown column");
    assert!(
        matches!(&error, MigrateError::Schema { gaps, .. } if gaps == &["unknown column points.streak"]),
        "{error}"
    );
    assert!(fixture.nothing_written());
}

#[tokio::test]
async fn a_conversion_that_fails_midway_leaves_nothing_behind() {
    // Un statut que la v2 refuse, sur une table convertie après bien d'autres.
    let fixture = Fixture::new("abort", "UPDATE pokemon_safari_parks SET status = 'PAUSED'").await;
    let error = fixture.migrate().await.expect_err("check constraint");
    assert!(
        matches!(
            error,
            MigrateError::Step {
                table: "pokemon_safari_parks",
                ..
            }
        ),
        "{error}"
    );
    assert!(fixture.nothing_written());
}
