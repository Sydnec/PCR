//! Les apparitions de bout en bout, sur une base jetable : revendication au fil des messages, course
//! entre messages simultanés, spawn forcé et ses refus, balayage des fuites, panne provoquée.

use super::*;
use crate::testing::TestApp;

/// Le salon des apparitions de `deploy/instance.example.toml`.
const CHANNEL: i64 = 700_000_000_000_000_012;
/// Après l'ouverture de la 2ᵉ génération.
const NOW: &str = "2026-11-27T12:00:00Z";
const NOW_MS: i64 = 1_795_780_800_000;
const MINUTE: i64 = 60_000;

/// Le Pokémon du salon, posé à la main, avec son message déjà posté.
async fn active(t: &TestApp, species: u16, rarity: &str, flees_at: &str) -> i64 {
    t.sql(format!(
        "INSERT INTO pokemon_spawns (species_id, catch_rate, rarity, status, spawned_at, flees_at)
         VALUES ({species}, 45, '{rarity}', 'ACTIVE', {}, {flees_at})",
        NOW_MS - 60 * MINUTE
    ))
    .await;
    let id = t.scalar("SELECT max(id) FROM pokemon_spawns").await;
    t.sql(format!(
        "INSERT INTO public_messages
                (kind, entity_id, channel_id, message_id, synced_version, changed_at)
         VALUES ('spawn', {id}, {CHANNEL}, 1, 1, {NOW_MS})"
    ))
    .await;
    id
}

/// Seuil de messages et délai atteints.
async fn ready(t: &TestApp, count: i64) {
    t.sql(format!(
        "UPDATE pokemon_state SET message_count = {count}, last_spawn_at = {}",
        NOW_MS - 60 * MINUTE
    ))
    .await;
}

async fn count(t: &TestApp, status: &str) -> i64 {
    t.scalar(format!(
        "SELECT count(*) FROM pokemon_spawns WHERE status = '{status}'"
    ))
    .await
}

fn refusal<T: std::fmt::Debug>(result: Result<T, UseCaseError>) -> String {
    match result {
        Err(UseCaseError::Refused(refusal)) => refusal.text().to_owned(),
        other => panic!("expected a refusal, got {other:?}"),
    }
}

#[tokio::test]
async fn a_message_fills_the_empty_channel_and_declares_its_message() {
    let t = TestApp::new("spawn-first", NOW).await;
    let born = on_message(&t.app).await.expect("message").expect("born");
    let id = born.id;
    assert_eq!(
        t.scalar(format!(
            "SELECT count(*) FROM pokemon_spawns WHERE id = {id} AND status = 'ACTIVE'
                AND catch_rate = {} AND spawned_at = {NOW_MS}
                AND flees_at BETWEEN {} AND {}",
            born.encounter.species.catch_rate,
            NOW_MS + 45 * MINUTE,
            NOW_MS + 180 * MINUTE
        ))
        .await,
        1
    );
    assert_eq!(
        t.scalar(format!(
            "SELECT count(*) FROM public_messages
              WHERE kind = 'spawn' AND entity_id = {id} AND channel_id = {CHANNEL}
                AND message_id IS NULL"
        ))
        .await,
        1,
        "le worker postera l'annonce"
    );
    assert_eq!(
        t.scalar("SELECT message_count * 10 + total_spawns FROM pokemon_state")
            .await,
        1,
        "compteur remis à zéro, une apparition de plus"
    );
    // Le suivant attend son seuil.
    assert!(on_message(&t.app).await.expect("message").is_none());
    t.close().await;
}

#[tokio::test]
async fn ten_simultaneous_messages_make_a_single_pokemon() {
    let t = TestApp::new("spawn-race", NOW).await;
    let previous = active(&t, 16, "COMMUN", &(NOW_MS + 30 * MINUTE).to_string()).await;
    ready(&t, 1000).await;
    let results = futures_util::future::join_all((0..10).map(|_| on_message(&t.app))).await;
    let born = results
        .into_iter()
        .filter_map(|result| result.expect("message"))
        .count();
    assert_eq!(born, 1);
    assert_eq!((count(&t, "FLED").await, count(&t, "ACTIVE").await), (1, 1));
    // Le Pokémon chassé voit son message réécrit (sa fuite).
    assert_eq!(
        t.scalar(format!(
            "SELECT version FROM public_messages WHERE kind = 'spawn' AND entity_id = {previous}"
        ))
        .await,
        2
    );
    t.close().await;
}

#[tokio::test]
async fn messages_never_chase_a_legendary() {
    let t = TestApp::new("spawn-legendary", NOW).await;
    active(&t, 150, "LEGENDAIRE", &(NOW_MS + 30 * MINUTE).to_string()).await;
    ready(&t, 50_000).await;
    assert!(on_message(&t.app).await.expect("message").is_none());
    assert_eq!(
        t.scalar("SELECT message_count FROM pokemon_state").await,
        50_001,
        "le compteur continue de monter"
    );
    t.close().await;
}

#[tokio::test]
async fn a_failure_midway_leaves_the_channel_as_it_was() {
    let t = TestApp::new("spawn-atomic", NOW).await;
    let previous = active(&t, 16, "COMMUN", &(NOW_MS + 30 * MINUTE).to_string()).await;
    ready(&t, 1000).await;
    // L'apparition est insérée, l'ancienne a fui ; c'est la déclaration du message qui échoue.
    t.sql(
        "CREATE TRIGGER panne BEFORE INSERT ON public_messages
         BEGIN SELECT RAISE(ABORT, 'panne'); END",
    )
    .await;
    assert!(on_message(&t.app).await.is_err());
    assert_eq!(
        t.scalar(format!(
            "SELECT count(*) FROM pokemon_spawns WHERE id = {previous} AND status = 'ACTIVE'"
        ))
        .await,
        1,
        "l'ancien est toujours là"
    );
    assert_eq!(t.scalar("SELECT count(*) FROM pokemon_spawns").await, 1);
    assert_eq!(
        t.scalar("SELECT message_count + total_spawns FROM pokemon_state")
            .await,
        1000,
        "ni compteur remis à zéro, ni apparition comptée"
    );
    assert_eq!(
        t.scalar("SELECT version FROM public_messages").await,
        1,
        "son message n'a pas à changer"
    );
    t.close().await;
}

#[tokio::test]
async fn an_administrator_spawns_anything_open_anytime() {
    let t = TestApp::new("spawn-forced", NOW).await;
    active(&t, 150, "LEGENDAIRE", &(NOW_MS + 30 * MINUTE).to_string()).await;
    t.sql(format!(
        "UPDATE pokemon_state SET message_count = 77, spawn_paused_until = {}",
        NOW_MS + 60 * MINUTE
    ))
    .await;
    let request = Request {
        species: Some(144),
        shiny: Some(true),
        announcement: Some("🎃 Événement d'Halloween !".to_owned()),
        ping: Some(false),
    };
    let born = force(&t.app, &request).await.expect("forced");
    assert_eq!(born.encounter.species.id, 144);
    assert_eq!(
        t.scalar(format!(
            "SELECT count(*) FROM pokemon_spawns WHERE id = {} AND status = 'ACTIVE'
                AND is_shiny = 1 AND charm_shiny = 0 AND pings_role = 0
                AND announcement = '🎃 Événement d''Halloween !'",
            born.id
        ))
        .await,
        1
    );
    assert_eq!(
        count(&t, "FLED").await,
        1,
        "même un légendaire cède sa place"
    );
    assert_eq!(t.scalar("SELECT message_count FROM pokemon_state").await, 0);
    t.close().await;
}

#[tokio::test]
async fn a_forced_spawn_refuses_what_it_cannot_show() {
    let t = TestApp::new("spawn-forced-refusals", NOW).await;
    let unknown = Request {
        species: Some(999),
        ..Request::default()
    };
    assert_eq!(
        refusal(force(&t.app, &unknown).await),
        rules::UNKNOWN_SPECIES
    );
    // Avant l'ouverture de la 2ᵉ génération, Germignon n'existe pas encore pour les joueurs.
    let before = t.at("2026-01-01T12:00:00Z");
    let closed = Request {
        species: Some(152),
        ..Request::default()
    };
    assert_eq!(
        refusal(force(&before, &closed).await),
        "❌ **Germignon** est de génération 2, et le jeu s'arrête pour l'instant à la génération 1."
    );
    for path in [
        "pokemon.spawn.weightsByStage.1",
        "pokemon.spawn.weightsByStage.2",
        "pokemon.spawn.weightsByStage.3",
        "pokemon.spawn.veryRareWeight",
        "pokemon.spawn.legendaryWeight",
    ] {
        crate::config::set(&t.app, path, "0", 1).await.expect("set");
    }
    assert_eq!(
        refusal(force(&t.app, &Request::default()).await),
        rules::EMPTY_POOL
    );
    assert_eq!(t.scalar("SELECT count(*) FROM pokemon_spawns").await, 0);
    let mut instance = (*t.app.instance).clone();
    instance.discord.pokemon_channel_id = None;
    let unconfigured = App {
        instance: std::sync::Arc::new(instance),
        ..t.app.clone()
    };
    assert_eq!(
        refusal(force(&unconfigured, &Request::default()).await),
        rules::NO_CHANNEL
    );
    // Sans salon, les messages ne comptent même pas.
    assert!(on_message(&unconfigured).await.expect("message").is_none());
    assert_eq!(t.scalar("SELECT message_count FROM pokemon_state").await, 0);
    t.close().await;
}

#[tokio::test]
async fn the_sweep_makes_due_and_unseen_pokemon_flee() {
    let t = TestApp::new("spawn-sweep", NOW).await;
    let later = active(&t, 16, "COMMUN", &(NOW_MS + 10 * MINUTE).to_string()).await;
    assert_eq!(flee_due(&t.app).await.expect("sweep"), 0, "pas encore");
    let soon = t.at("2026-11-27T12:11:00Z");
    assert_eq!(flee_due(&soon).await.expect("sweep"), 1);
    assert_eq!(
        t.scalar(format!(
            "SELECT count(*) FROM pokemon_spawns
              WHERE id = {later} AND status = 'FLED' AND ended_at = {}",
            NOW_MS + 11 * MINUTE
        ))
        .await,
        1
    );
    assert_eq!(
        t.scalar("SELECT version FROM public_messages").await,
        2,
        "sa fuite se lit sur son message"
    );
    assert_eq!(count(&t, "ACTIVE").await, 0, "le salon reste vide");

    // Un message disparu : plus personne ne le voit, il s'en va.
    let unseen = active(&t, 19, "COMMUN", &(NOW_MS + 60 * MINUTE).to_string()).await;
    t.sql(format!(
        "UPDATE public_messages SET gone_at = {NOW_MS} WHERE entity_id = {unseen}"
    ))
    .await;
    assert_eq!(flee_due(&t.app).await.expect("sweep"), 1);
    assert_eq!(count(&t, "ACTIVE").await, 0);
    t.close().await;
}

#[tokio::test]
async fn an_older_pokemon_without_deadline_gets_one_from_now() {
    let t = TestApp::new("spawn-deadline", NOW).await;
    let id = active(&t, 16, "COMMUN", "NULL").await;
    assert_eq!(flee_due(&t.app).await.expect("sweep"), 0);
    assert_eq!(
        t.scalar(format!(
            "SELECT count(*) FROM pokemon_spawns WHERE id = {id}
                AND flees_at BETWEEN {} AND {}",
            NOW_MS + 45 * MINUTE,
            NOW_MS + 90 * MINUTE
        ))
        .await,
        1
    );
    t.close().await;
}
