//! Les objets de bout en bout : l'objet tenu remis à la capture (ou lâché), la limite de détention, ce
//! qu'un fuyard laisse tomber, le ramassage et ses refus. La chance de lâcher se règle à 0 ou à 1, et
//! les captures se font à la Hyper Ball sur un taux de 255 : rien ne dépend du hasard.

use pcr_core::pokemon::throw::{Held, Outcome, Promise};
use rand::{SeedableRng as _, rngs::StdRng};

use super::*;
use crate::{pokemon::throw, testing::TestApp};

const NOW: &str = "2026-11-27T12:00:00Z";
const NOW_MS: i64 = 1_795_780_800_000;
const ASH: i64 = 1;
const MISTY: i64 = 2;
const BROCK: i64 = 3;

async fn setup(name: &str, drop_chance: &str) -> TestApp {
    let t = TestApp::new(name, NOW).await;
    crate::config::set(&t.app, "pokemon.spawn.itemDropChance", drop_chance, 1)
        .await
        .expect("set");
    crate::points::grant_user(&t.app, ASH, 10_000)
        .await
        .expect("grant");
    t
}

/// Un Roucool facile qui tient `item`, son message posté ; rend son numéro.
async fn holding(t: &TestApp, item: &str) -> i64 {
    t.sql(format!(
        "INSERT INTO pokemon_spawns (species_id, catch_rate, rarity, held_item, status, spawned_at, flees_at)
         VALUES (16, 255, 'COMMUN', '{item}', 'ACTIVE', {}, {})",
        NOW_MS - 60_000,
        NOW_MS + 3_600_000
    ))
    .await;
    let id = t.scalar("SELECT max(id) FROM pokemon_spawns").await;
    t.sql(format!(
        "INSERT INTO public_messages (kind, entity_id, channel_id, message_id, synced_version, changed_at)
         VALUES ('spawn', {id}, 900, 1, 1, {NOW_MS})"
    ))
    .await;
    id
}

async fn catch(t: &TestApp, spawn: i64) -> Option<Held> {
    let request = throw::Request {
        user: ASH,
        spawn,
        ball: "hyper",
        promise: Promise::Unspecified,
    };
    match throw::throw(&t.app, &request, &mut StdRng::seed_from_u64(1))
        .await
        .expect("throw")
        .outcome
    {
        Outcome::Catch { held, .. } => held,
        other => panic!("expected a catch, got {other:?}"),
    }
}

async fn count(t: &TestApp, user: i64, item: &str) -> i64 {
    t.scalar(format!(
        "SELECT coalesce((SELECT count FROM pokemon_inventory WHERE user_id = {user} AND item_key = '{item}'), 0)"
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
async fn the_held_item_follows_its_captor_into_the_bag() {
    let t = setup("drops-held", "0").await;
    let spawn = holding(&t, "pepite").await;
    let held = catch(&t, spawn).await.expect("held");
    assert!(!held.dropped && held.notice.is_none() && held.label == "Pépite");
    assert_eq!(count(&t, ASH, "pepite").await, 1);
    assert_eq!(
        t.scalar(format!(
            "SELECT count(*) FROM pokemon_item_log WHERE user_id = {ASH} AND item_key = 'pepite'
                AND delta = 1 AND source = 'capture:{spawn}'"
        ))
        .await,
        1
    );
    assert_eq!(t.scalar("SELECT count(*) FROM pokemon_drops").await, 0);
    t.close().await;
}

#[tokio::test]
async fn a_capped_item_upgrades_or_sells_itself() {
    let t = setup("drops-cap", "0").await;
    t.sql(format!(
        "INSERT INTO pokemon_inventory (user_id, item_key, count)
         VALUES ({ASH}, 'ball_master', 1), ({ASH}, 'super_canne', 1)"
    ))
    .await;
    let master = holding(&t, "ball_master").await;
    let held = catch(&t, master).await.expect("held");
    assert_eq!(
        held.notice.as_deref(),
        Some(
            "Tu as déjà une Master Ball, le maximum : celle-ci est vendue **10\u{202f}000** points."
        )
    );
    assert_eq!(count(&t, ASH, "ball_master").await, 1);
    assert_eq!(
        t.scalar(format!(
            "SELECT count(*) FROM points_log WHERE user_id = {ASH} AND source = 'overflow' AND delta = 10000"
        ))
        .await,
        1
    );
    let rod = t
        .scalar("SELECT id FROM pokemon_spawns WHERE status = 'ACTIVE'")
        .await;
    t.sql(format!(
        "UPDATE pokemon_spawns SET held_item = 'super_canne', catch_rate = 255 WHERE id = {rod}"
    ))
    .await;
    let later = t.at("2026-11-27T12:00:05Z");
    let request = throw::Request {
        user: ASH,
        spawn: rod,
        ball: "hyper",
        promise: Promise::Unspecified,
    };
    throw::throw(&later, &request, &mut StdRng::seed_from_u64(1))
        .await
        .expect("throw");
    assert_eq!(
        (
            count(&t, ASH, "super_canne").await,
            count(&t, ASH, "mega_canne").await
        ),
        (1, 1),
        "la Super Canne de trop devient la Méga Canne qui manque"
    );
    t.close().await;
}

#[tokio::test]
async fn a_dropped_item_is_a_second_race_without_its_captor() {
    let t = setup("drops-race", "1").await;
    let spawn = holding(&t, "pepite").await;
    let held = catch(&t, spawn).await.expect("held");
    assert!(held.dropped);
    assert_eq!(count(&t, ASH, "pepite").await, 0);
    let drop = t
        .scalar(format!(
            "SELECT id FROM pokemon_drops WHERE spawn_id = {spawn} AND status = 'OPEN'"
        ))
        .await;
    assert_eq!(
        t.scalar(format!(
            "SELECT count(*) FROM public_messages WHERE kind = 'drop' AND entity_id = {drop}"
        ))
        .await,
        1,
        "le worker l'annoncera dans le salon"
    );
    assert_eq!(refusal(claim(&t.app, ASH, drop).await), rules::CAPTOR);
    let picked = claim(&t.app, MISTY, drop).await.expect("claim");
    assert_eq!((picked.label.as_str(), picked.notice), ("Pépite", None));
    assert_eq!(count(&t, MISTY, "pepite").await, 1);
    assert_eq!(refusal(claim(&t.app, BROCK, drop).await), rules::TOO_LATE);
    assert_eq!(
        t.scalar(format!(
            "SELECT version FROM public_messages WHERE kind = 'drop' AND entity_id = {drop}"
        ))
        .await,
        2
    );
    t.close().await;
}

#[tokio::test]
async fn a_fleeing_pokemon_drops_what_it_held_or_takes_it_away() {
    let t = setup("drops-flee", "1").await;
    let spawn = holding(&t, "pepite").await;
    t.sql(format!(
        "UPDATE pokemon_spawns SET flees_at = {NOW_MS} WHERE id = {spawn}"
    ))
    .await;
    assert_eq!(
        super::super::spawn::flee_due(&t.app).await.expect("flee"),
        1
    );
    assert_eq!(
        t.scalar(format!(
            "SELECT count(*) FROM pokemon_drops WHERE spawn_id = {spawn} AND status = 'OPEN'"
        ))
        .await,
        1
    );
    crate::config::set(&t.app, "pokemon.spawn.itemDropChance", "0", 1)
        .await
        .expect("set");
    let other = holding(&t, "pepite").await;
    t.sql(format!(
        "UPDATE pokemon_spawns SET flees_at = {NOW_MS} WHERE id = {other}"
    ))
    .await;
    super::super::spawn::flee_due(&t.app).await.expect("flee");
    assert_eq!(
        t.scalar(format!(
            "SELECT count(*) FROM pokemon_drops WHERE spawn_id = {other}"
        ))
        .await,
        0,
        "il l'emporte"
    );
    t.close().await;
}

#[tokio::test]
async fn a_failed_pickup_leaves_the_item_on_the_ground() {
    let t = setup("drops-atomic", "1").await;
    let spawn = holding(&t, "pepite").await;
    catch(&t, spawn).await;
    let drop = t.scalar("SELECT max(id) FROM pokemon_drops").await;
    t.sql(
        "CREATE TRIGGER panne BEFORE INSERT ON pokemon_item_log
         BEGIN SELECT RAISE(ABORT, 'panne'); END",
    )
    .await;
    assert!(claim(&t.app, MISTY, drop).await.is_err());
    assert_eq!(
        t.scalar(format!(
            "SELECT count(*) FROM pokemon_drops WHERE id = {drop} AND status = 'OPEN' AND claimed_by IS NULL"
        ))
        .await,
        1
    );
    assert_eq!(count(&t, MISTY, "pepite").await, 0);
    t.close().await;
}
