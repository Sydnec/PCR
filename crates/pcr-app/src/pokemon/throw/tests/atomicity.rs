//! Les pannes provoquées au milieu d'un lancer : rien n'est pris, rien n'est écrit.

use super::*;

#[tokio::test]
async fn a_failure_midway_leaves_everything_as_it_was() {
    let t = TestApp::new("throw-atomic", NOW).await;
    grant(&t, ASH, 1000).await;
    let spawn = active(&t, 16, "").await;
    // Payé, tiré, capturé : c'est l'arrivée dans la boîte qui échoue.
    t.sql(
        "CREATE TRIGGER panne BEFORE INSERT ON pokemon_owned
         BEGIN SELECT RAISE(ABORT, 'panne'); END",
    )
    .await;
    assert!(
        throw(&t.app, &request(ASH, spawn, "poke"), &mut caught())
            .await
            .is_err()
    );
    assert_eq!(balance(&t, ASH).await, 1000);
    assert_eq!(
        t.scalar(format!(
            "SELECT count(*) FROM pokemon_spawns WHERE id = {spawn} AND status = 'ACTIVE'
                AND throw_count = 0"
        ))
        .await,
        1
    );
    assert_eq!(t.scalar("SELECT count(*) FROM pokemon_throws").await, 0);
    assert_eq!(t.scalar("SELECT count(*) FROM pokemon_spawns").await, 1);
    t.close().await;
}

#[tokio::test]
async fn a_throw_refused_by_the_last_guard_takes_nothing() {
    let t = TestApp::new("throw-guard", NOW).await;
    grant(&t, ASH, 1000).await;
    let spawn = active(&t, 16, "").await;
    t.sql(format!(
        "INSERT INTO pokemon_inventory (user_id, item_key, count) VALUES ({MISTY}, 'ball_poke', 1)"
    ))
    .await;
    // Payé, tiré : l'écriture gardée sur le statut ne trouve plus l'apparition en jeu.
    t.sql(
        "CREATE TRIGGER rempart BEFORE UPDATE ON pokemon_spawns
         BEGIN SELECT RAISE(IGNORE); END",
    )
    .await;
    // Une capture et un raté payés en points, une capture payée d'une ball en poche.
    let caught_with_points = outcome(&t.app, &request(ASH, spawn, "poke"), &mut caught()).await;
    let later = t.at("2026-11-27T12:00:05Z");
    let missed_with_points = outcome(&later, &request(ASH, spawn, "poke"), &mut missed()).await;
    let caught_offered = outcome(&t.app, &request(MISTY, spawn, "poke"), &mut caught()).await;
    for result in [caught_with_points, missed_with_points, caught_offered] {
        assert_eq!(result, Outcome::Gone);
    }
    assert_eq!(
        balance(&t, ASH).await,
        1000,
        "les points sont rendus à la base"
    );
    assert_eq!(
        t.scalar(format!(
            "SELECT count FROM pokemon_inventory WHERE user_id = {MISTY} AND item_key = 'ball_poke'"
        ))
        .await,
        1,
        "la ball en poche aussi"
    );
    assert_eq!(t.scalar("SELECT count(*) FROM pokemon_throws").await, 0);
    assert_eq!(
        t.scalar("SELECT count(*) FROM points_log WHERE source = 'throw'")
            .await,
        0
    );
    t.close().await;
}
