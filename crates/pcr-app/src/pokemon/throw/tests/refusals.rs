//! Un test par refus de lancer : chacun dit ses chiffres et ne prend rien.

use super::*;

#[tokio::test]
async fn every_refusal_takes_nothing() {
    let t = TestApp::new("throw-refusals", NOW).await;
    grant(&t, ASH, 50).await;
    let spawn = active(&t, 16, "").await;
    assert_eq!(
        outcome(&t.app, &request(ASH, spawn, "poke"), &mut caught()).await,
        Outcome::Insufficient {
            ball: "Poké Ball".to_owned(),
            price: 100,
            balance: 50,
        }
    );
    assert_eq!(balance(&t, ASH).await, 50);
    assert_eq!(
        outcome(&t.app, &request(MISTY, spawn, "fantome"), &mut caught()).await,
        Outcome::UnknownBall
    );
    // Avant l'ouverture de la 2ᵉ génération, l'Appât Ball n'existe pas.
    let spring = t.at("2026-01-01T12:00:00Z");
    assert_eq!(
        outcome(&spring, &request(MISTY, spawn, "appat"), &mut caught()).await,
        Outcome::UnknownBall
    );
    // Promise offerte, la Master Ball n'est pas dans le sac ; payée, son prix a monté.
    let offered = Request {
        promise: Promise::Offered,
        ..request(MISTY, spawn, "master")
    };
    assert_eq!(
        outcome(&t.app, &offered, &mut caught()).await,
        Outcome::NoItem {
            ball: "Master Ball".to_owned()
        }
    );
    let stale = Request {
        promise: Promise::Price(9_000),
        ..request(BROCK, spawn, "master")
    };
    assert_eq!(
        outcome(&t.app, &stale, &mut caught()).await,
        Outcome::PriceChanged {
            ball: "Master Ball".to_owned(),
            price: 10_000
        }
    );
    // Une Appât Ball achetée après l'apparition ne sert pas.
    t.sql(format!(
        "INSERT INTO pokemon_ball_units (user_id, ball, bought_at) VALUES (4, 'appat', {NOW_MS})"
    ))
    .await;
    assert_eq!(
        outcome(&t.app, &request(4, spawn, "appat"), &mut caught()).await,
        Outcome::NoUnit {
            ball: "Appât Ball".to_owned(),
            held: 1
        }
    );
    // Une touche de pêche n'est qu'à son pêcheur ; un Pokémon parti ne coûte rien.
    t.sql(format!(
        "INSERT INTO pokemon_spawns (id, species_id, catch_rate, rarity, status, fished, reserved_for,
                                     spawned_at, flees_at)
         VALUES (90, 129, 255, 'COMMUN', 'FISHING', 1, 7, 1, {})",
        NOW_MS + 60_000
    ))
    .await;
    assert_eq!(
        outcome(&t.app, &request(5, 90, "poke"), &mut caught()).await,
        Outcome::NotYours
    );
    t.sql(format!(
        "UPDATE pokemon_spawns SET status = 'FLED', ended_at = 1 WHERE id = {spawn}"
    ))
    .await;
    assert_eq!(
        outcome(&t.app, &request(6, spawn, "poke"), &mut caught()).await,
        Outcome::Gone
    );
    assert_eq!(t.scalar("SELECT count(*) FROM pokemon_throws").await, 0);
    assert_eq!(
        t.scalar("SELECT count(*) FROM pokemon_ball_units").await,
        1,
        "la ball de la boutique reste en poche"
    );
    t.close().await;
}
