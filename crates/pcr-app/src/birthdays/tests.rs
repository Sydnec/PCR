//! Les anniversaires sur une base jetable : saisie refusée, liste, vœux une fois par an, envoi raté
//! rendu au passage suivant.

use std::sync::{Arc, atomic::Ordering};

use super::*;
use crate::{
    outbox::Ports,
    testing::{FakeOutbox, FakeWeb, TestApp},
};

/// `birthday_channel_id` de `deploy/instance.example.toml`.
const CHANNEL: i64 = 700_000_000_000_000_003;

fn ports(outbox: &Arc<FakeOutbox>) -> Ports {
    Ports {
        outbox: Arc::clone(outbox) as _,
        web: Arc::new(FakeWeb::default()),
    }
}

#[tokio::test]
async fn a_birthday_is_saved_listed_and_removed() {
    let t = TestApp::new("birthdays-list", "2026-11-09T12:00:00Z").await;
    assert!(matches!(
        set(&t.app, 1, "31/04").await,
        Err(UseCaseError::Refused(refusal)) if refusal.text() == rules::bad_date("31/04")
    ));
    assert_eq!(t.scalar("SELECT count(*) FROM birthdays").await, 0);
    set(&t.app, 1, "24/07/1998").await.expect("set");
    set(&t.app, 2, "9/11").await.expect("set");
    set(&t.app, 3, "10/11/2000").await.expect("set");
    let list = upcoming(&t.app).await.expect("list");
    let summary: Vec<(i64, i32, Option<i16>)> =
        list.iter().map(|u| (u.user, u.days, u.age)).collect();
    assert_eq!(
        summary,
        [(2, 0, None), (3, 1, Some(26)), (1, 257, Some(29))]
    );
    assert!(remove(&t.app, 1).await.expect("remove"));
    assert!(!remove(&t.app, 1).await.expect("remove"));
    t.close().await;
}

#[tokio::test]
async fn a_birthday_is_wished_once_a_year_and_a_failed_wish_is_retried() {
    let t = TestApp::new("birthdays-wish", "2026-11-09T08:00:00Z").await;
    set(&t.app, 1, "09/11").await.expect("set");
    set(&t.app, 2, "10/11").await.expect("set");
    let outbox = Arc::new(FakeOutbox::default());
    let run = |period: &str| (JOB.run)(t.app.clone(), ports(&outbox), period.to_owned());

    // Discord en panne : la fête est rendue, la tâche reste à refaire.
    outbox.down.store(true, Ordering::Relaxed);
    assert!(run("2026-11-09").await.is_err());
    assert_eq!(
        t.scalar("SELECT count(*) FROM birthdays WHERE last_wished_year IS NOT NULL")
            .await,
        0
    );
    outbox.down.store(false, Ordering::Relaxed);
    run("2026-11-09").await.expect("wish");
    // Rejouée (après un arrêt, par exemple), elle ne félicite pas deux fois.
    run("2026-11-09").await.expect("again");
    let posts = outbox.posts.lock().expect("lock").clone();
    assert_eq!(
        posts,
        [(
            CHANNEL,
            "🎂 JOAAAAAAAAAAAAAAAAAAAAA <@1> ! Passe une excellente journée !!!".to_owned(),
            vec![1]
        )]
    );
    // L'heure réglée fait l'échéance ; sans salon, la tâche est coupée.
    assert_eq!(
        (JOB.schedule)(&t.app),
        Some(pcr_core::schedule::Schedule::Daily { hour: 9, minute: 0 })
    );
    let silent = t.with_instance(|instance| instance.discord.birthday_channel_id = None);
    assert_eq!((JOB.schedule)(&silent), None);
    t.close().await;
}
