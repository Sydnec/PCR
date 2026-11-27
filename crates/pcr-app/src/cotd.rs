//! Saints et fêtes du jour : `/cotd`, et le message quotidien dans le salon des saints, à `cotd.hour`
//! (heure de Paris). Les saints viennent de nominis, les fêtes de journee-mondiale.com : une page
//! des fêtes illisible n'empêche pas les saints de partir.

use pcr_core::cotd::{self as rules};

use crate::{
    jobs::{Job, JobFuture, daily_at},
    outbox::{Ports, Web},
};

/// Le message du jour ; `None` si nominis ne répond pas ce qu'on attend (la v1 se taisait alors).
pub async fn today(web: &dyn Web) -> Result<Option<String>, String> {
    let json = web.get(rules::SAINTS_URL, rules::USER_AGENT).await?;
    let Some(saints) = rules::parse_saints(&json) else {
        tracing::warn!("unexpected nominis answer");
        return Ok(None);
    };
    let feasts = match web
        .get(
            &rules::feasts_url(saints.day, saints.month),
            rules::USER_AGENT,
        )
        .await
    {
        Ok(page) => rules::parse_feasts(&page),
        Err(error) => {
            tracing::warn!(%error, "feasts page unavailable");
            Vec::new()
        }
    };
    Ok(Some(rules::message(&saints, &feasts)))
}

/// Le message quotidien ; coupé sans salon des saints.
pub const JOB: Job = Job {
    name: "cotd",
    schedule: |app| {
        app.instance
            .discord
            .cotd_channel_id
            .and_then(|_| daily_at(app.game_config().cotd.hour))
    },
    run: |app, ports, _period| post_today(app, ports),
};

fn post_today(app: crate::App, ports: Ports) -> JobFuture {
    Box::pin(async move {
        let Some(channel) = app.instance.discord.cotd_channel_id else {
            return Ok(());
        };
        // Une panne du site laisse la tâche à refaire : le passage suivant réessaie.
        if let Some(text) = today(&*ports.web).await? {
            ports
                .outbox
                .post(i64::try_from(channel)?, text, Vec::new())
                .await?;
        }
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use std::{collections::HashMap, sync::Arc};

    use super::*;
    use crate::testing::{FakeOutbox, FakeWeb, TestApp};

    #[tokio::test]
    async fn the_saints_are_posted_and_a_missing_feasts_page_is_skipped() {
        let t = TestApp::new("cotd", "2026-09-03T08:00:00Z").await;
        let outbox = Arc::new(FakeOutbox::default());
        let saints = r#"{"response":{"query":{"jour":3,"mois":9},"prenoms":{"majeurs":{"Grégoire":{"sexe":"masculin"}}}}}"#;
        let web = FakeWeb(HashMap::from([(
            rules::SAINTS_URL.to_owned(),
            saints.to_owned(),
        )]));
        let ports = Ports {
            outbox: Arc::clone(&outbox) as _,
            web: Arc::new(web),
        };
        (JOB.run)(t.app.clone(), ports.clone(), "2026-09-03".to_owned())
            .await
            .expect("cotd");
        assert_eq!(
            outbox.posts.lock().expect("lock")[0].1,
            "Nous sommes le 03/09 et nous célébrons les :\n- Grégoire\nPour fêter ça, apéro !"
        );
        // nominis injoignable : la tâche échoue, et sera refaite.
        let down = Ports {
            web: Arc::new(FakeWeb::default()),
            ..ports
        };
        assert!(
            (JOB.run)(t.app.clone(), down, "2026-09-03".to_owned())
                .await
                .is_err()
        );
        t.close().await;
    }
}
