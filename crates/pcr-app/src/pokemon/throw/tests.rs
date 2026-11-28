//! Les lancers de bout en bout, sur une base jetable : paiement, tirage figé, capture et ses suites,
//! course entre deux dresseurs, Charme Chroma. Les refus sont dans `refusals`, les pannes provoquées
//! dans `atomicity`.

use std::convert::Infallible;

use futures_util::future::join_all;

use super::*;
use crate::testing::TestApp;

mod atomicity;
mod refusals;

pub(super) const NOW: &str = "2026-11-27T12:00:00Z";
pub(super) const NOW_MS: i64 = 1_795_780_800_000;
pub(super) const ASH: i64 = 1;
pub(super) const MISTY: i64 = 2;
pub(super) const BROCK: i64 = 3;

/// Un hasard figé : `0` attrape à tous les coups, `u64::MAX` rate à tous les coups (sauf la Master
/// Ball, garantie).
pub(super) struct Fixed(u64);

impl rand::TryRng for Fixed {
    type Error = Infallible;

    fn try_next_u32(&mut self) -> Result<u32, Infallible> {
        Ok(u32::try_from(self.0 >> 32).unwrap_or(u32::MAX))
    }

    fn try_next_u64(&mut self) -> Result<u64, Infallible> {
        Ok(self.0)
    }

    fn try_fill_bytes(&mut self, dst: &mut [u8]) -> Result<(), Infallible> {
        dst.fill(self.0.to_le_bytes()[0]);
        Ok(())
    }
}

pub(super) fn caught() -> Fixed {
    Fixed(0)
}

pub(super) fn missed() -> Fixed {
    Fixed(u64::MAX)
}

/// Un Pokémon dans le salon, son message déjà posté ; rend son numéro.
pub(super) async fn active(t: &TestApp, species: u16, extra: &str) -> i64 {
    t.sql(format!(
        "INSERT INTO pokemon_spawns (species_id, catch_rate, rarity, sex, status, spawned_at, flees_at{})
         VALUES ({species}, 45, 'COMMUN', 'F', 'ACTIVE', {}, {}{})",
        if extra.is_empty() { "" } else { ", charm_shiny" },
        NOW_MS - 60_000,
        NOW_MS + 3_600_000,
        if extra.is_empty() { "" } else { ", 1" },
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

pub(super) async fn grant(t: &TestApp, user: i64, points: i64) {
    crate::points::grant_user(&t.app, user, points)
        .await
        .expect("grant");
}

pub(super) async fn balance(t: &TestApp, user: i64) -> i64 {
    t.scalar(format!(
        "SELECT coalesce((SELECT balance FROM points WHERE user_id = {user}), 0)"
    ))
    .await
}

pub(super) fn request(user: i64, spawn: i64, ball: &str) -> Request<'_> {
    Request {
        user,
        spawn,
        ball,
        promise: Promise::Unspecified,
    }
}

pub(super) async fn outcome(app: &App, request: &Request<'_>, rng: &mut Fixed) -> Outcome {
    throw(app, request, rng).await.expect("throw").outcome
}

#[tokio::test]
async fn a_catch_pays_fills_the_box_and_calls_the_next_pokemon() {
    let t = TestApp::new("throw-catch", NOW).await;
    grant(&t, ASH, 1000).await;
    let spawn = active(&t, 25, "").await;
    let result = outcome(&t.app, &request(ASH, spawn, "poke"), &mut caught()).await;
    assert_eq!(
        result,
        Outcome::Catch {
            paid: Paid::Points(100),
            name: "Pikachu ♀".to_owned(),
            charm: None,
            held: None,
        }
    );
    assert_eq!(balance(&t, ASH).await, 900);
    assert_eq!(
        t.scalar(format!(
            "SELECT count(*) FROM pokemon_owned WHERE user_id = {ASH} AND species_id = 25
                AND sex = 'F' AND ball = 'poke' AND origin = 'capture' AND locked = 0
                AND obtained_at = {NOW_MS}"
        ))
        .await,
        1,
        "l'individu que l'annonce montrait, avec sa ball"
    );
    assert_eq!(
        t.scalar(format!(
            "SELECT count(*) FROM pokemon_spawns WHERE id = {spawn} AND status = 'CAUGHT'
                AND caught_by = {ASH} AND caught_ball = 'poke' AND throw_count = 1"
        ))
        .await,
        1
    );
    assert_eq!(
        t.scalar("SELECT count(*) FROM pokemon_throws WHERE result = 'CATCH' AND cost = 100")
            .await,
        1
    );
    assert_eq!(
        t.scalar("SELECT count(*) FROM pokemon_spawns WHERE status = 'ACTIVE'")
            .await,
        1,
        "le suivant apparaît aussitôt"
    );
    assert_eq!(
        t.scalar(format!(
            "SELECT version FROM public_messages WHERE entity_id = {spawn}"
        ))
        .await,
        2
    );
    t.close().await;
}

#[tokio::test]
async fn a_miss_burns_the_price_and_the_pokemon_stays() {
    let t = TestApp::new("throw-miss", NOW).await;
    grant(&t, ASH, 1000).await;
    let spawn = active(&t, 16, "").await;
    let result = outcome(&t.app, &request(ASH, spawn, "super"), &mut missed()).await;
    assert!(
        matches!(&result, Outcome::Miss { paid: Paid::Points(200), name, .. } if name == "Roucool ♀"),
        "{result:?}"
    );
    assert_eq!(balance(&t, ASH).await, 800);
    assert_eq!(
        t.scalar(format!(
            "SELECT throw_count FROM pokemon_spawns WHERE id = {spawn} AND status = 'ACTIVE'"
        ))
        .await,
        1
    );
    assert_eq!(
        t.scalar("SELECT count(*) FROM pokemon_throws WHERE result = 'MISS' AND cost = 200")
            .await,
        1
    );
    // Le délai entre deux lancers : même dresseur, aussitôt.
    assert_eq!(
        outcome(&t.app, &request(ASH, spawn, "super"), &mut missed()).await,
        Outcome::Cooldown { remaining: 3 }
    );
    t.close().await;
}

#[tokio::test]
async fn pocket_balls_go_first_and_shop_balls_must_predate_the_spawn() {
    let t = TestApp::new("throw-pocket", NOW).await;
    grant(&t, ASH, 1000).await;
    let spawn = active(&t, 16, "").await;
    t.sql(format!(
        "INSERT INTO pokemon_inventory (user_id, item_key, count) VALUES ({ASH}, 'ball_poke', 1);
         INSERT INTO pokemon_ball_units (user_id, ball, bought_at) VALUES ({MISTY}, 'appat', 5)"
    ))
    .await;
    let first = outcome(&t.app, &request(ASH, spawn, "poke"), &mut missed()).await;
    assert!(
        matches!(&first, Outcome::Miss { paid: Paid::Offered { label }, .. } if label == "Poké Ball"),
        "{first:?}"
    );
    assert_eq!(balance(&t, ASH).await, 1000, "offerte : aucun point pris");
    assert_eq!(
        t.scalar(
            "SELECT count(*) FROM pokemon_item_log WHERE item_key = 'ball_poke'
                AND delta = -1 AND source = 'lancer'"
        )
        .await,
        1
    );
    let shop = outcome(&t.app, &request(MISTY, spawn, "appat"), &mut missed()).await;
    assert!(
        matches!(&shop, Outcome::Miss { paid: Paid::Used { label }, .. } if label == "Appât Ball"),
        "{shop:?}"
    );
    assert_eq!(t.scalar("SELECT count(*) FROM pokemon_ball_units").await, 0);
    t.close().await;
}

#[tokio::test]
async fn the_master_ball_price_grows_with_each_one_paid() {
    let t = TestApp::new("throw-master", NOW).await;
    grant(&t, ASH, 100_000).await;
    let first = active(&t, 150, "").await;
    let paid = |result: &Outcome| match result {
        Outcome::Catch { paid, .. } => paid.points(),
        other => panic!("expected a catch, got {other:?}"),
    };
    let result = outcome(&t.app, &request(ASH, first, "master"), &mut missed()).await;
    assert_eq!(paid(&result), 10_000, "garantie, même sur le pire tirage");
    let next = t
        .scalar("SELECT id FROM pokemon_spawns WHERE status = 'ACTIVE'")
        .await;
    let later = t.at("2026-11-27T12:00:05Z");
    let confirmed = Request {
        promise: Promise::Price(12_000),
        ..request(ASH, next, "master")
    };
    let result = outcome(&later, &confirmed, &mut missed()).await;
    assert_eq!(paid(&result), 12_000);
    assert_eq!(balance(&t, ASH).await, 78_000);
    t.close().await;
}

#[tokio::test]
async fn two_trainers_racing_one_wins_and_the_other_pays_nothing() {
    let t = TestApp::new("throw-race", NOW).await;
    let spawn = active(&t, 16, "").await;
    t.sql(format!(
        "INSERT INTO pokemon_inventory (user_id, item_key, count)
         VALUES ({ASH}, 'ball_master', 1), ({MISTY}, 'ball_master', 1)"
    ))
    .await;
    let requests = [
        request(ASH, spawn, "master"),
        request(MISTY, spawn, "master"),
    ];
    let results = join_all(requests.iter().map(|request| {
        let app = t.app.clone();
        async move { throw(&app, request, &mut caught()).await }
    }))
    .await;
    let outcomes: Vec<Outcome> = results
        .into_iter()
        .map(|result| result.expect("throw").outcome)
        .collect();
    assert_eq!(
        outcomes
            .iter()
            .filter(|o| matches!(o, Outcome::Catch { .. }))
            .count(),
        1
    );
    assert!(outcomes.contains(&Outcome::Gone));
    assert_eq!(
        t.scalar("SELECT sum(count) FROM pokemon_inventory WHERE item_key = 'ball_master'")
            .await,
        1,
        "le perdant garde sa Master Ball"
    );
    assert_eq!(t.scalar("SELECT count(*) FROM pokemon_owned").await, 1);
    t.close().await;
}

#[tokio::test]
async fn the_shiny_charm_makes_it_shine_for_its_holder_only() {
    let t = TestApp::new("throw-charm", NOW).await;
    grant(&t, ASH, 1000).await;
    grant(&t, MISTY, 1000).await;
    t.sql(format!(
        "INSERT INTO pokemon_inventory (user_id, item_key, count) VALUES ({ASH}, 'charme_chroma_1', 1)"
    ))
    .await;
    let holder = active(&t, 16, "charm").await;
    let result = outcome(&t.app, &request(ASH, holder, "poke"), &mut caught()).await;
    assert!(
        matches!(&result, Outcome::Catch { name, charm: Some(_), .. } if name == "✨ Roucool ♀"),
        "{result:?}"
    );
    assert_eq!(
        t.scalar(format!(
            "SELECT is_shiny FROM pokemon_owned WHERE user_id = {ASH} AND species_id = 16"
        ))
        .await,
        1
    );
    assert_eq!(
        t.scalar(format!(
            "SELECT is_shiny FROM pokemon_spawns WHERE id = {holder}"
        ))
        .await,
        1
    );
    t.sql("UPDATE pokemon_spawns SET status = 'FLED', ended_at = 1 WHERE status = 'ACTIVE'")
        .await;
    let other = active(&t, 19, "charm").await;
    let result = outcome(&t.app, &request(MISTY, other, "poke"), &mut caught()).await;
    assert!(
        matches!(&result, Outcome::Catch { charm: None, .. }),
        "{result:?}"
    );
    t.close().await;
}

#[tokio::test]
async fn completing_a_pokedex_grants_the_charm_once() {
    let t = TestApp::new("throw-pokedex", NOW).await;
    grant(&t, ASH, 10_000).await;
    let values: Vec<String> = pcr_core::pokemon::charms::required(1)
        .filter(|species| species.id != 16)
        .map(|species| format!("({ASH}, {}, 'capture', 1)", species.id))
        .collect();
    t.sql(format!(
        "INSERT INTO pokemon_owned (user_id, species_id, origin, obtained_at) VALUES {}",
        values.join(", ")
    ))
    .await;
    let spawn = active(&t, 16, "").await;
    let thrown = throw(&t.app, &request(ASH, spawn, "poke"), &mut caught())
        .await
        .expect("throw");
    assert_eq!(thrown.charms, [1]);
    assert_eq!(
        t.scalar(
            "SELECT count(*) FROM pokemon_item_log
              WHERE item_key = 'charme_chroma_1' AND delta = 1 AND source = 'pokedex:1'"
        )
        .await,
        1
    );
    let next = t
        .scalar("SELECT id FROM pokemon_spawns WHERE status = 'ACTIVE'")
        .await;
    let later = t.at("2026-11-27T12:00:05Z");
    let again = throw(&later, &request(ASH, next, "poke"), &mut caught())
        .await
        .expect("throw");
    assert!(again.charms.is_empty(), "donné une fois pour toutes");
    t.close().await;
}
