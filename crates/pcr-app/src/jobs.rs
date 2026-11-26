//! Les tâches de calendrier (saints du jour, anniversaires, calendrier de l'Avent, récap annuel…) :
//! une échéance par période, en heure de Paris (`pcr_core::schedule`), revendiquée dans `job_runs`.
//!
//! La boucle regarde régulièrement quelles échéances de la période en cours sont passées : au
//! démarrage, une échéance manquée pendant l'arrêt part donc tout de suite, et une seule fois. Les
//! balayages (fuites, rappels échus, réparation des messages) ne passent pas par ici : ils tournent
//! en continu et l'état en base suffit à les rendre idempotents.

use std::{future::Future, pin::Pin, time::Duration};

use pcr_core::schedule::Schedule;
use tokio::sync::watch;

use crate::App;

/// Cadence de vérification : une échéance part au plus cette durée après son heure.
const TICK: Duration = Duration::from_secs(30);
/// Un passage revendiqué mais jamais terminé (arrêt brutal, erreur) se reprend après ce délai,
/// multiplié par le nombre de tentatives.
const LEASE_MS: i64 = 10 * 60 * 1000;

pub type JobError = Box<dyn std::error::Error + Send + Sync>;
pub type JobFuture = Pin<Box<dyn Future<Output = Result<(), JobError>> + Send>>;

/// Une tâche de calendrier. `run` reçoit la clé de la période qu'elle traite.
#[derive(Debug, Clone, Copy)]
pub struct Job {
    pub name: &'static str,
    pub schedule: Schedule,
    pub run: fn(App, String) -> JobFuture,
}

/// Les tâches du bot ; chaque fonctionnalité y ajoute la sienne (P3 et suivantes).
pub fn all() -> Vec<Job> {
    Vec::new()
}

/// Exécute les échéances dues jusqu'à l'arrêt.
pub async fn run(app: App, jobs: Vec<Job>, mut shutdown: watch::Receiver<bool>) {
    for job in &jobs {
        // Une échéance invalide serait silencieusement sautée certaines nuits : la refuser ici.
        assert!(
            job.schedule.is_valid(),
            "invalid schedule for job {}",
            job.name
        );
    }
    loop {
        for job in &jobs {
            run_due(&app, job).await;
        }
        tokio::select! {
            () = tokio::time::sleep(TICK) => {}
            _ = shutdown.wait_for(|stop| *stop) => return,
        }
    }
}

async fn run_due(app: &App, job: &Job) {
    let now = app.clock.now();
    let Some((period, _)) = job.schedule.due(now) else {
        return;
    };
    match pcr_db::jobs::claim(&app.db, job.name, &period, now.as_millisecond(), LEASE_MS).await {
        Ok(true) => {}
        Ok(false) => return,
        Err(error) => {
            tracing::error!(?error, job = job.name, "claiming a job run failed");
            return;
        }
    }
    tracing::info!(job = job.name, %period, "job started");
    match (job.run)(app.clone(), period.clone()).await {
        Ok(()) => {
            let done = app.clock.now_ms();
            if let Err(error) = pcr_db::jobs::finish(&app.db, job.name, &period, done).await {
                // Le passage se rejouera après son bail : moins grave que de le croire fait.
                tracing::error!(?error, job = job.name, %period, "marking a job run done failed");
            }
        }
        // Laissé non terminé : repris après le bail, qui s'allonge à chaque tentative.
        Err(error) => tracing::error!(%error, job = job.name, %period, "job failed"),
    }
}
