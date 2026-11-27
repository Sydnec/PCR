//! Tests de la conversion v1 → v2 sur la fixture synthétique (schéma v1 gelé + `fixture_*.sql`).

use std::path::Path;

use sqlx::SqlitePool;

use super::{
    MigrateError, Report,
    fixture::{Fixture, Tweak, check, notes, open, value},
};

#[tokio::test]
async fn the_fixture_converts_with_every_correction_reported() {
    let fixture = Fixture::new("ok", Tweak::None).await;
    let read = |path: &Path| std::fs::read(path).expect("v1 file");
    let before = (
        read(&fixture.sources.points),
        read(&fixture.sources.botdata),
    );
    let report = fixture.migrate().await.expect("conversion");
    // Les fichiers v1 ne sont que lus : la prod doit rester intacte, conversion réussie ou non.
    let after = (
        read(&fixture.sources.points),
        read(&fixture.sources.botdata),
    );
    assert!(before == after, "v1 files were modified");
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
    let fixture = Fixture::new(
        "schema",
        Tweak::Points("ALTER TABLE points ADD COLUMN streak INTEGER"),
    )
    .await;
    let error = fixture.migrate().await.expect_err("unknown column");
    assert!(
        matches!(&error, MigrateError::Schema { gaps, .. } if gaps == &["unknown column points.streak"]),
        "{error}"
    );
    assert!(fixture.nothing_written());
}

#[tokio::test]
async fn a_conversion_that_fails_midway_leaves_nothing_behind() {
    // Un type de moment notable que la v2 refuse, dans la base de stats : `pcr.db` est alors déjà
    // entièrement convertie, et ne doit pas rester non plus.
    let fixture = Fixture::new(
        "abort",
        Tweak::Botdata("UPDATE pokemon_highlights SET type = 'BOGUS'"),
    )
    .await;
    let error = fixture.migrate().await.expect_err("check constraint");
    assert!(
        matches!(
            error,
            MigrateError::Step {
                table: "pokemon_highlights",
                ..
            }
        ),
        "{error}"
    );
    assert!(fixture.nothing_written());
}
