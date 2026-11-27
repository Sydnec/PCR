//! Les paris de bout en bout, sur une base jetable : parcours complets, pannes provoquées au milieu
//! d'un cas d'usage, résolutions croisées. Les refus sont dans `refusals`.

use super::*;
use crate::testing::TestApp;

mod refusals;

const CREATOR: i64 = 10;
const ALICE: i64 = 1;
const BOB: i64 = 2;
const CAROL: i64 = 3;
const CHANNEL: i64 = 900;

async fn setup(name: &str) -> TestApp {
    let t = TestApp::new(name, "2026-11-27T12:00:00Z").await;
    for user in [ALICE, BOB, CAROL] {
        crate::points::grant_user(&t.app, user, 1000)
            .await
            .expect("grant");
    }
    t
}

async fn classic(t: &TestApp) -> i64 {
    let options = ["Oui".to_owned(), "Non".to_owned(), "Peut-être".to_owned()];
    create(&t.app, CREATOR, "Il pleut demain ?", &options)
        .await
        .expect("create")
}

async fn estimation(t: &TestApp) -> i64 {
    create_estimate(&t.app, CREATOR, "Combien de messages ?")
        .await
        .expect("create")
}

async fn balance(t: &TestApp, user: i64) -> i64 {
    t.scalar(format!(
        "SELECT coalesce((SELECT balance FROM points WHERE user_id = {user}), 0)"
    ))
    .await
}

/// Le texte d'un refus ; tout autre résultat fait échouer le test.
fn refusal<T: std::fmt::Debug>(result: Result<T, BetsError>) -> String {
    match result {
        Err(BetsError::Refused(refusal)) => refusal.text().to_owned(),
        other => panic!("expected a refusal, got {other:?}"),
    }
}

#[tokio::test]
async fn a_classic_bet_pays_its_winners_and_publishes_the_result() {
    let t = setup("bets-classic").await;
    let bet = classic(&t).await;
    posted(&t.app, bet, CHANNEL, Some(555))
        .await
        .expect("posted");

    let first = stake(&t.app, bet, ALICE, 1, "100").await.expect("stake");
    assert_eq!((first.amount, first.total, first.added), (100, 100, false));
    let more = stake(&t.app, bet, ALICE, 1, "1 00").await.expect("stake");
    assert_eq!((more.amount, more.total, more.added), (100, 200, true));
    stake(&t.app, bet, BOB, 1, "600").await.expect("stake");
    stake(&t.app, bet, CAROL, 2, "200").await.expect("stake");
    assert_eq!(balance(&t, ALICE).await, 800);

    resolve(&t.app, bet, CREATOR, 1, CHANNEL)
        .await
        .expect("resolve");
    // Cagnotte de 1 000 : 200/800 et 600/800.
    assert_eq!(balance(&t, ALICE).await, 800 + 250);
    assert_eq!(balance(&t, BOB).await, 400 + 750);
    assert_eq!(balance(&t, CAROL).await, 800);
    assert_eq!(
        t.scalar("SELECT count(*) FROM points_log WHERE source = 'bet'")
            .await,
        6
    );
    let view = view(&t.app, bet).await.expect("view").expect("bet");
    assert_eq!(view.bet.status, Status::Closed);
    assert_eq!(view.bet.winning_option, Some(1));
    assert_eq!(
        view.gains(),
        [
            Gain {
                user: ALICE,
                staked: 200,
                prediction: None,
                gain: 250
            },
            Gain {
                user: BOB,
                staked: 600,
                prediction: None,
                gain: 750
            },
        ]
    );
    // Le message du pari est à réécrire, celui du résultat à poster dans le salon du pari.
    assert_eq!(
        t.scalar(
            "SELECT count(*) FROM public_messages
              WHERE kind = 'bet' AND message_id = 555 AND synced_version < version"
        )
        .await,
        1
    );
    assert_eq!(
        t.scalar(
            "SELECT count(*) FROM public_messages
              WHERE kind = 'bet_result' AND channel_id = 900 AND message_id IS NULL"
        )
        .await,
        1
    );
    let alice = stats(&t.app, ALICE).await.expect("stats");
    assert_eq!((alice.total_wagered, alice.max_win), (200, 250));
    assert_eq!((alice.server_wagered, alice.server_max_win), (1000, 750));
    assert_eq!(alice.record_holder, Some(BOB));
    t.app.stats.close().await;
    t.close().await;
}

#[tokio::test]
async fn an_estimate_pays_the_closest_ties_included() {
    let t = setup("bets-estimate").await;
    let bet = estimation(&t).await;
    estimate(&t.app, bet, ALICE, "100", "50").await.expect("a");
    estimate(&t.app, bet, BOB, "120", "150").await.expect("b");
    estimate(&t.app, bet, CAROL, "-80", "50").await.expect("c");
    assert_eq!(
        resolve_estimate(&t.app, bet, CREATOR, "110", CHANNEL)
            .await
            .expect("resolve"),
        Resolved::Paid
    );
    // Cagnotte de 250 : 50/200 et 150/200, arrondis vers le bas (la banque garde 1 point).
    assert_eq!(balance(&t, ALICE).await, 950 + 62);
    assert_eq!(balance(&t, BOB).await, 850 + 187);
    assert_eq!(balance(&t, CAROL).await, 950);
    let view = view(&t.app, bet).await.expect("view").expect("bet");
    assert_eq!(view.bet.estimate_result, Some(110));
    assert_eq!(view.gains()[0].prediction, Some(100));

    let empty = estimation(&t).await;
    assert_eq!(
        resolve_estimate(&t.app, empty, CREATOR, "7", CHANNEL)
            .await
            .expect("resolve"),
        Resolved::Empty
    );
    t.app.stats.close().await;
    t.close().await;
}

#[tokio::test]
async fn changing_an_estimate_moves_only_the_difference() {
    let t = setup("bets-estimate-change").await;
    let bet = estimation(&t).await;
    estimate(&t.app, bet, ALICE, "10", "300")
        .await
        .expect("first");
    let raised = estimate(&t.app, bet, ALICE, "12", "500")
        .await
        .expect("raise");
    assert!(raised.updated);
    assert_eq!(balance(&t, ALICE).await, 500);
    estimate(&t.app, bet, ALICE, "15", "100")
        .await
        .expect("lower");
    assert_eq!(balance(&t, ALICE).await, 900);
    let form = estimate_form(&t.app, bet, ALICE).await.expect("form");
    assert_eq!(
        form,
        EstimateForm {
            balance: 900,
            current: Some((15, 100))
        }
    );
    t.close().await;
}

#[tokio::test]
async fn cancelling_refunds_every_stake() {
    let t = setup("bets-cancel").await;
    let bet = classic(&t).await;
    stake(&t.app, bet, ALICE, 1, "300").await.expect("stake");
    stake(&t.app, bet, BOB, 2, "1000").await.expect("stake");
    assert_eq!(cancel(&t.app, bet, CREATOR).await.expect("cancel"), 2);
    assert_eq!(
        (balance(&t, ALICE).await, balance(&t, BOB).await),
        (1000, 1000)
    );
    assert_eq!(
        t.scalar("SELECT count(*) FROM public_messages WHERE kind = 'bet_result'")
            .await,
        0
    );
    t.close().await;
}

#[tokio::test]
async fn a_locked_bet_takes_no_more_stakes_but_can_still_be_resolved() {
    let t = setup("bets-lock").await;
    let bet = classic(&t).await;
    stake(&t.app, bet, ALICE, 1, "100").await.expect("stake");
    lock(&t.app, bet, CREATOR).await.expect("lock");
    lock(&t.app, bet, CREATOR).await.expect("lock again");
    assert_eq!(
        refusal(stake_form(&t.app, bet, BOB, 1).await),
        rules::CLOSED_TO_STAKES
    );
    assert_eq!(
        refusal(stake(&t.app, bet, BOB, 1, "100").await),
        rules::STAKE_CLOSED
    );
    let form = resolve_form(&t.app, bet, CREATOR).await.expect("form");
    assert!(matches!(form, ResolveForm::Classic { open: false, .. }));
    resolve(&t.app, bet, CREATOR, 1, CHANNEL)
        .await
        .expect("resolve");
    // Seule à miser, Alice récupère sa mise.
    assert_eq!(balance(&t, ALICE).await, 1000);
    assert_eq!(balance(&t, BOB).await, 1000);
    t.app.stats.close().await;
    t.close().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn simultaneous_resolutions_pay_once() {
    let t = setup("bets-race").await;
    let bet = classic(&t).await;
    stake(&t.app, bet, ALICE, 1, "100").await.expect("stake");
    stake(&t.app, bet, BOB, 2, "300").await.expect("stake");
    let tasks: Vec<_> = (0..6)
        .map(|i| {
            let app = t.app.clone();
            tokio::spawn(async move {
                if i % 3 == 0 {
                    cancel(&app, bet, CREATOR).await.map(|_| ())
                } else {
                    resolve(&app, bet, CREATOR, 1, CHANNEL).await
                }
            })
        })
        .collect();
    let mut done = 0;
    for task in tasks {
        if task.await.expect("task").is_ok() {
            done += 1;
        }
    }
    assert_eq!(done, 1);
    // Payé (1 000 + 300) ou remboursé (1 000 chacun) : jamais les deux, jamais deux fois.
    let total = balance(&t, ALICE).await + balance(&t, BOB).await;
    assert_eq!(total, 2000);
    assert!(
        t.scalar("SELECT count(*) FROM public_messages WHERE kind = 'bet_result'")
            .await
            <= 1
    );
    t.app.stats.close().await;
    t.close().await;
}

#[tokio::test]
async fn a_stake_that_fails_halfway_costs_nothing() {
    let t = setup("bets-stake-failure").await;
    let bet = classic(&t).await;
    t.sql(
        "CREATE TRIGGER panne BEFORE INSERT ON bet_participations
         BEGIN SELECT RAISE(ABORT, 'panne'); END",
    )
    .await;
    assert!(matches!(
        stake(&t.app, bet, ALICE, 1, "100").await,
        Err(BetsError::Db(_))
    ));
    assert_eq!(balance(&t, ALICE).await, 1000);
    assert_eq!(
        t.scalar("SELECT count(*) FROM points_log WHERE source = 'bet'")
            .await,
        0
    );
    t.close().await;
}

#[tokio::test]
async fn an_estimate_change_that_fails_halfway_refunds_nothing() {
    let t = setup("bets-estimate-failure").await;
    let bet = estimation(&t).await;
    estimate(&t.app, bet, ALICE, "10", "400")
        .await
        .expect("estimate");
    t.sql(
        "CREATE TRIGGER panne BEFORE UPDATE ON bet_participations
         BEGIN SELECT RAISE(ABORT, 'panne'); END",
    )
    .await;
    assert!(estimate(&t.app, bet, ALICE, "11", "100").await.is_err());
    assert_eq!(balance(&t, ALICE).await, 600);
    assert_eq!(t.scalar("SELECT amount FROM bet_participations").await, 400);
    t.close().await;
}

#[tokio::test]
async fn a_cancellation_that_fails_halfway_refunds_nobody() {
    let t = setup("bets-cancel-failure").await;
    let bet = classic(&t).await;
    stake(&t.app, bet, ALICE, 1, "100").await.expect("stake");
    stake(&t.app, bet, BOB, 2, "200").await.expect("stake");
    t.sql(format!(
        "CREATE TRIGGER panne BEFORE INSERT ON points_log WHEN NEW.user_id = {BOB} AND NEW.delta > 0
         BEGIN SELECT RAISE(ABORT, 'panne'); END"
    ))
    .await;
    assert!(cancel(&t.app, bet, CREATOR).await.is_err());
    assert_eq!(
        (balance(&t, ALICE).await, balance(&t, BOB).await),
        (900, 800)
    );
    assert_eq!(
        t.scalar("SELECT count(*) FROM bets WHERE status = 'OPEN'")
            .await,
        1
    );
    t.sql("DROP TRIGGER panne").await;
    cancel(&t.app, bet, CREATOR).await.expect("cancel");
    assert_eq!(
        (balance(&t, ALICE).await, balance(&t, BOB).await),
        (1000, 1000)
    );
    t.close().await;
}

#[tokio::test]
async fn a_resolution_that_fails_halfway_pays_nobody() {
    let t = setup("bets-resolve-failure").await;
    let bet = classic(&t).await;
    stake(&t.app, bet, ALICE, 1, "100").await.expect("stake");
    stake(&t.app, bet, BOB, 2, "200").await.expect("stake");
    // La dernière étape : le message du résultat.
    t.sql(
        "CREATE TRIGGER panne BEFORE INSERT ON public_messages WHEN NEW.kind = 'bet_result'
         BEGIN SELECT RAISE(ABORT, 'panne'); END",
    )
    .await;
    assert!(resolve(&t.app, bet, CREATOR, 1, CHANNEL).await.is_err());
    assert_eq!(balance(&t, ALICE).await, 900);
    assert_eq!(
        t.scalar("SELECT count(*) FROM bets WHERE status = 'OPEN'")
            .await,
        1
    );
    let untouched = stats(&t.app, ALICE).await.expect("stats");
    assert_eq!(untouched.total_wagered, 0);
    t.sql("DROP TRIGGER panne").await;
    resolve(&t.app, bet, CREATOR, 1, CHANNEL)
        .await
        .expect("resolve");
    assert_eq!(balance(&t, ALICE).await, 1200);
    t.app.stats.close().await;
    t.close().await;
}
