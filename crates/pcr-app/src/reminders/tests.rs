//! Les rappels sur une base jetable : un test par refus, l'envoi et ses pannes, la purge.

use std::sync::atomic::Ordering;

use super::*;
use crate::testing::{FakeOutbox, TestApp};

const ME: i64 = 333_333_333_333_333_333;
const OTHER: i64 = 42;
const CHANNEL: i64 = 900;

fn refusal<T: std::fmt::Debug>(result: Result<T, UseCaseError>) -> String {
    match result {
        Err(UseCaseError::Refused(refusal)) => refusal.text().to_owned(),
        other => panic!("expected a refusal, got {other:?}"),
    }
}

async fn count(t: &TestApp, sql: &str) -> i64 {
    t.scalar(sql.to_owned()).await
}

#[tokio::test]
async fn a_reminder_is_set_in_paris_time_and_its_button_copies_it() {
    let t = TestApp::new("reminders-create", "2026-11-27T12:00:00Z").await;
    let created = create(&t.app, ME, CHANNEL, "25/12 15:30", Some("  Apéro !  "))
        .await
        .expect("create");
    assert_eq!(
        created.trigger_at,
        crate::testing::at("2026-12-25T14:30:00Z")
    );
    assert_eq!(created.message, "Apéro !");
    assert_eq!(created.button, "rappel|1798209000000|Ap%C3%A9ro%20!");
    let copied = copy(&t.app, OTHER, CHANNEL, &created.button)
        .await
        .expect("copy");
    assert_eq!(
        (copied.trigger_at, copied.message.as_str()),
        (created.trigger_at, "Apéro !")
    );

    // Un message trop long pour le bouton : le bouton renvoie au rappel d'origine.
    let long = "é".repeat(40);
    let source = create(&t.app, ME, CHANNEL, "25/12 15:30", Some(&long))
        .await
        .expect("create");
    assert_eq!(
        source.button,
        format!("rappel|1798209000000|#{}", source.id)
    );
    assert_eq!(
        copy(&t.app, OTHER, CHANNEL, &source.button)
            .await
            .expect("copy")
            .message,
        long
    );
    let default = create(&t.app, ME, CHANNEL, "25/12 15:30", None)
        .await
        .expect("create");
    assert_eq!(default.message, "Rappel !");
    assert_eq!(pending(&t.app, ME).await.expect("pending").len(), 3);
    t.close().await;
}

#[tokio::test]
async fn refused_reminders_write_nothing() {
    let t = TestApp::new("reminders-refused", "2026-11-27T12:00:00Z").await;
    assert_eq!(
        refusal(create(&t.app, ME, CHANNEL, "demain 10h", None).await),
        pcr_core::reminders::BAD_DATE
    );
    assert_eq!(
        refusal(create(&t.app, ME, CHANNEL, "27/11 12:00", None).await),
        pcr_core::reminders::IN_THE_PAST
    );
    assert_eq!(
        refusal(create(&t.app, ME, CHANNEL, "28/11/2027 10:00", None).await),
        "❌ La date ne peut pas être à plus d'un an dans le futur !"
    );
    // Le bouton d'un rappel passé (format v1) ; celui d'un rappel supprimé avant son heure.
    assert_eq!(
        refusal(copy(&t.app, OTHER, CHANNEL, "rappel|1700000000000|Vieux").await),
        pcr_core::reminders::ALREADY_PAST
    );
    assert_eq!(
        refusal(copy(&t.app, OTHER, CHANNEL, "rappel|1798209000000|#99").await),
        pcr_core::reminders::SOURCE_GONE
    );
    assert_eq!(count(&t, "SELECT count(*) FROM reminders").await, 0);
    let mine = create(&t.app, ME, CHANNEL, "25/12 15:30", None)
        .await
        .expect("create");
    assert_eq!(
        refusal(delete(&t.app, OTHER, mine.id).await),
        pcr_core::reminders::NOT_YOURS
    );
    assert_eq!(
        delete(&t.app, ME, mine.id).await.expect("delete").id,
        mine.id
    );
    assert_eq!(count(&t, "SELECT count(*) FROM reminders").await, 0);
    t.close().await;
}

#[tokio::test]
async fn due_reminders_are_sent_once_and_a_failure_is_retried() {
    let t = TestApp::new("reminders-sweep", "2026-11-27T12:00:00Z").await;
    // Pas de liste blanche : tout le monde reçoit ses MP.
    let app = t.with_instance(|instance| instance.discord.dm_allowlist.clear());
    let soon = create(&app, ME, CHANNEL, "27/11 13:01", None)
        .await
        .expect("create");
    create(&app, OTHER, CHANNEL, "27/11 13:01", None)
        .await
        .expect("create");
    create(&app, ME, CHANNEL, "28/11 13:01", None)
        .await
        .expect("create");
    let outbox = FakeOutbox {
        unreachable: vec![OTHER],
        ..FakeOutbox::default()
    };
    let later = App {
        clock: t.at("2026-11-27T12:05:00Z").clock,
        ..app.clone()
    };

    // Discord en panne : rien n'est marqué, tout repart au passage suivant.
    outbox.down.store(true, Ordering::Relaxed);
    assert_eq!(sweep(&later, &outbox).await.expect("sweep"), 0);
    outbox.down.store(false, Ordering::Relaxed);
    // Le membre injoignable est marqué aussi : il ne se retenterait que pour rien.
    assert_eq!(sweep(&later, &outbox).await.expect("sweep"), 2);
    assert_eq!(sweep(&later, &outbox).await.expect("sweep"), 0);
    assert_eq!(*outbox.reminded.lock().expect("lock"), [soon.id]);
    assert_eq!(
        count(&t, "SELECT count(*) FROM reminders WHERE sent_at IS NULL").await,
        1
    );

    // Sept jours après l'envoi, les rappels partis sont effacés.
    let week = App {
        clock: t.at("2026-12-04T12:06:00Z").clock,
        ..app.clone()
    };
    sweep(&week, &outbox).await.expect("sweep");
    assert_eq!(count(&t, "SELECT count(*) FROM reminders").await, 1);
    t.close().await;
}

#[tokio::test]
async fn outside_the_dev_allowlist_nobody_gets_a_dm() {
    let t = TestApp::new("reminders-allowlist", "2026-11-27T12:00:00Z").await;
    create(&t.app, OTHER, CHANNEL, "27/11 13:01", None)
        .await
        .expect("create");
    let outbox = FakeOutbox::default();
    let later = t.at("2026-11-27T12:05:00Z");
    assert_eq!(sweep(&later, &outbox).await.expect("sweep"), 1);
    assert!(outbox.reminded.lock().expect("lock").is_empty());
    assert_eq!(
        count(&t, "SELECT count(*) FROM reminders WHERE sent_at IS NULL").await,
        0
    );
    t.close().await;
}
