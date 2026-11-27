//! Calendrier de l'Avent : du 1er au 24 décembre, à `advent.hour` (heure de Paris), un fil par jour
//! dans le salon de l'Avent, avec sa question épinglée.

use jiff::civil::Date;
use pcr_core::advent;

use crate::{
    App,
    jobs::{Job, JobFuture, daily_at},
    outbox::Ports,
};

/// La case du jour ; la tâche est quotidienne et vérifie sa date. Coupée sans salon de l'Avent.
pub const JOB: Job = Job {
    name: "advent",
    schedule: |app| {
        app.instance
            .discord
            .advent_channel_id
            .and_then(|_| daily_at(app.game_config().advent.hour))
    },
    run: |app, ports, period| open_door(app, ports, period),
};

fn open_door(app: App, ports: Ports, period: String) -> JobFuture {
    Box::pin(async move {
        let (Some(channel), Some(door)) = (
            app.instance.discord.advent_channel_id,
            advent::door(period.parse::<Date>()?),
        ) else {
            return Ok(());
        };
        ports
            .outbox
            .open_thread(i64::try_from(channel)?, door.thread_name, door.message)
            .await?;
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;
    use crate::testing::{FakeOutbox, FakeWeb, TestApp};

    #[tokio::test]
    async fn a_door_opens_only_in_advent() {
        let t = TestApp::new("advent", "2026-12-01T08:00:00Z").await;
        let outbox = Arc::new(FakeOutbox::default());
        let ports = Ports {
            outbox: Arc::clone(&outbox) as _,
            web: Arc::new(FakeWeb::default()),
        };
        for day in ["2026-11-30", "2026-12-01", "2026-12-25"] {
            (JOB.run)(t.app.clone(), ports.clone(), day.to_owned())
                .await
                .expect("advent");
        }
        let threads = outbox.threads.lock().expect("lock").clone();
        assert_eq!(threads.len(), 1);
        assert_eq!(threads[0].1, "Jour 1 - 3 films que tu as vus cette année");
        t.close().await;
    }
}
