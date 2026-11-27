//! Le pot commun de bout en bout, sur une base jetable : échéance, rattrapage, pannes.

use std::sync::Mutex;

use rand::{SeedableRng as _, rngs::StdRng};

use super::*;
use crate::{
    members::{Member, Roster},
    testing::{TestApp, at},
};

/// `default_role_id` de `deploy/instance.example.toml`.
const ROLE: i64 = 555_555_555_555_555_555;
const HOUR: i64 = 3_600_000;
const WEEK: i64 = 168 * HOUR;

/// Le serveur vu par le pot : une liste fixe, ou une panne de Discord.
#[derive(Debug)]
struct Port(Mutex<Result<Roster, String>>);

impl Port {
    fn with(ids: &[i64]) -> Self {
        Self(Mutex::new(Ok(Roster {
            role_name: Some("Dresseurs".to_owned()),
            members: ids
                .iter()
                .map(|&id| Member {
                    id,
                    bot: false,
                    roles: vec![ROLE],
                })
                .collect(),
        })))
    }
}

impl MembersPort for Port {
    fn roster(&self, _role: i64) -> members::PortFuture<'_, Roster> {
        let roster = self.0.lock().expect("lock").clone();
        Box::pin(async move { roster })
    }
}

fn rng() -> StdRng {
    StdRng::seed_from_u64(1)
}

async fn balances(t: &TestApp) -> (i64, i64) {
    (
        t.scalar("SELECT balance FROM points WHERE user_id = 1")
            .await,
        t.scalar("SELECT balance FROM points WHERE user_id = 2")
            .await,
    )
}

async fn deadline(t: &TestApp) -> i64 {
    t.scalar("SELECT next_redistribution_at FROM economy_state")
        .await
}

#[tokio::test]
async fn the_first_tick_schedules_then_the_due_pot_runs_once_without_drift() {
    let t = TestApp::new("pot-schedule", "2026-10-06T10:00:00Z").await;
    t.sql("INSERT INTO points (user_id, balance) VALUES (1, 10000), (2, 0)")
        .await;
    let port = Port::with(&[1, 2]);
    let start = at("2026-10-06T10:00:00Z").as_millisecond();

    // Base neuve : la première échéance se pose, personne n'est prélevé.
    assert_eq!(
        tick(&t.app, &port, &mut rng()).await.expect("tick"),
        Tick::Scheduled
    );
    assert_eq!(deadline(&t).await, start + WEEK);
    let early = t.at("2026-10-07T10:00:00Z");
    assert_eq!(
        tick(&early, &port, &mut rng()).await.expect("tick"),
        Tick::NotDue
    );

    // Deux heures après l'échéance : 5 % de 10 000, la moitié revient à son cotisant.
    let due = t.at("2026-10-13T12:00:00Z");
    let Tick::Ran(outcome) = tick(&due, &port, &mut rng()).await.expect("tick") else {
        panic!("the pot should run");
    };
    assert_eq!((outcome.plan.pot, outcome.plan.share), (500, 250));
    assert_eq!(balances(&t).await, (9750, 250));
    assert_eq!(
        deadline(&t).await,
        start + 2 * WEEK,
        "from the old deadline"
    );
    assert_eq!(
        t.scalar("SELECT count(*) FROM points_redistributions WHERE triggered_by IS NULL")
            .await,
        1
    );
    assert_eq!(
        tick(&due, &port, &mut rng()).await.expect("tick"),
        Tick::NotDue
    );
    t.close().await;
}

#[tokio::test]
async fn a_long_outage_gives_a_single_catch_up_pot() {
    let t = TestApp::new("pot-outage", "2026-10-06T10:00:00Z").await;
    t.sql("INSERT INTO points (user_id, balance) VALUES (1, 10000), (2, 0)")
        .await;
    let now = at("2026-10-06T10:00:00Z").as_millisecond();
    t.sql(format!(
        "UPDATE economy_state SET next_redistribution_at = {}",
        now - 3 * WEEK - HOUR
    ))
    .await;
    let port = Port::with(&[1, 2]);
    assert!(matches!(
        tick(&t.app, &port, &mut rng()).await,
        Ok(Tick::Ran(_))
    ));
    assert_eq!(
        tick(&t.app, &port, &mut rng()).await.expect("tick"),
        Tick::NotDue
    );
    assert_eq!(balances(&t).await, (9750, 250));
    assert!(deadline(&t).await > now);
    t.close().await;
}

#[tokio::test]
async fn discord_down_or_an_empty_pot() {
    let t = TestApp::new("pot-postponed", "2026-10-06T10:00:00Z").await;
    t.sql("INSERT INTO points (user_id, balance) VALUES (1, 0), (2, -20)")
        .await;
    let now = at("2026-10-06T10:00:00Z").as_millisecond();
    t.sql(format!(
        "UPDATE economy_state SET next_redistribution_at = {}",
        now - HOUR
    ))
    .await;
    // Discord indisponible : l'échéance reste, le tour suivant réessaiera.
    let down = Port(Mutex::new(Err("timeout".to_owned())));
    assert_eq!(
        tick(&t.app, &down, &mut rng()).await.expect("tick"),
        Tick::Postponed("timeout".to_owned())
    );
    assert_eq!(deadline(&t).await, now - HOUR);
    // Personne n'a de quoi cotiser : la semaine est consommée, rien ne bouge.
    let port = Port::with(&[1, 2]);
    let skipped = tick(&t.app, &port, &mut rng()).await.expect("tick");
    assert_eq!(skipped, Tick::Skipped(Refusal::new(EMPTY_POT)));
    assert!(deadline(&t).await > now);
    assert_eq!(balances(&t).await, (0, -20));
    t.close().await;
}

#[tokio::test]
async fn a_pot_that_fails_halfway_moves_nothing_and_keeps_its_deadline() {
    let t = TestApp::new("pot-failure", "2026-10-06T10:00:00Z").await;
    t.sql("INSERT INTO points (user_id, balance) VALUES (1, 10000), (2, 0)")
        .await;
    let now = at("2026-10-06T10:00:00Z").as_millisecond();
    t.sql(format!(
        "UPDATE economy_state SET next_redistribution_at = {}",
        now - HOUR
    ))
    .await;
    t.sql(
        "CREATE TRIGGER panne BEFORE INSERT ON points_redistributions
         BEGIN SELECT RAISE(ABORT, 'panne'); END",
    )
    .await;
    let port = Port::with(&[1, 2]);
    assert!(tick(&t.app, &port, &mut rng()).await.is_err());
    assert_eq!(balances(&t).await, (10000, 0));
    assert_eq!(deadline(&t).await, now - HOUR);
    assert_eq!(t.scalar("SELECT count(*) FROM points_log").await, 0);
    t.close().await;
}

#[tokio::test]
async fn a_forced_pot_keeps_the_deadline_and_a_simulation_writes_nothing() {
    let t = TestApp::new("pot-forced", "2026-10-06T10:00:00Z").await;
    t.sql("INSERT INTO points (user_id, balance) VALUES (1, 1000), (2, 500)")
        .await;
    t.sql("UPDATE economy_state SET next_redistribution_at = 123")
        .await;
    let members = RoleMembers {
        role_name: "Dresseurs".to_owned(),
        members: vec![1, 2, 3],
    };
    let simulated = simulate(&t.app, &members, &mut rng())
        .await
        .expect("simulate");
    assert_eq!(simulated.plan.pot, 75);
    assert_eq!(balances(&t).await, (1000, 500));
    assert_eq!(
        t.scalar("SELECT count(*) FROM points_redistributions")
            .await,
        0
    );

    let forced = force(&t.app, &members, 42, &mut rng())
        .await
        .expect("force");
    assert_eq!(forced.plan.share, 25);
    assert_eq!(t.scalar("SELECT sum(balance) FROM points").await, 1500);
    assert_eq!(
        t.scalar("SELECT balance FROM points WHERE user_id = 3")
            .await,
        25
    );
    assert_eq!(deadline(&t).await, 123);
    assert_eq!(
        t.scalar("SELECT triggered_by FROM points_redistributions")
            .await,
        42
    );
    t.close().await;
}
