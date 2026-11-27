//! Les tâches de calendrier (saints du jour, anniversaires, calendrier de l'Avent, récap annuel…) :
//! une échéance par période, en heure de Paris (`pcr_core::schedule`), revendiquée dans `job_runs`.
//! L'échéance se relit à chaque tour dans la config et l'instance : changer l'heure des vœux par
//! `/admin config` vaut dès le tour suivant, et une tâche sans salon configuré ne part pas. La
//! boucle vit avec la connexion Discord (`pcr-discord` la lance), où partent ses messages.
//!
//! La boucle regarde régulièrement quelles échéances de la période en cours sont passées : au
//! démarrage, une échéance manquée pendant l'arrêt part donc tout de suite, et une seule fois. Les
//! balayages (fuites, rappels échus, réparation des messages) ne passent pas par ici : ils tournent
//! en continu et l'état en base suffit à les rendre idempotents.

use std::{future::Future, pin::Pin, time::Duration};

use pcr_core::schedule::Schedule;
use tokio::sync::watch;

use crate::{App, outbox::Ports};

/// Cadence de vérification : une échéance part au plus cette durée après son heure.
const TICK: Duration = Duration::from_secs(30);
/// Un passage revendiqué mais jamais terminé (arrêt brutal, erreur) se reprend après ce délai,
/// multiplié par le nombre de tentatives.
const LEASE_MS: i64 = 10 * 60 * 1000;

pub type JobError = Box<dyn std::error::Error + Send + Sync>;
pub type JobFuture = Pin<Box<dyn Future<Output = Result<(), JobError>> + Send>>;

/// Une tâche de calendrier. `schedule` : son échéance selon la config du moment, `None` si elle est
/// coupée ; `run` reçoit la clé de la période qu'elle traite.
#[derive(Debug, Clone, Copy)]
pub struct Job {
    pub name: &'static str,
    pub schedule: fn(&App) -> Option<Schedule>,
    pub run: fn(App, Ports, String) -> JobFuture,
}

/// Les tâches du bot ; chaque fonctionnalité y ajoute la sienne.
pub fn all() -> Vec<Job> {
    vec![crate::birthdays::JOB, crate::cotd::JOB, crate::advent::JOB]
}

/// Chaque jour à `hour` heures (heure de Paris, réglage de jeu). 2 h, qui manque ou double la nuit
/// du changement d'heure, devient 3 h ; une heure hors du jour n'est pas une échéance.
pub fn daily_at(hour: u32) -> Option<Schedule> {
    let hour = if hour == 2 { 3 } else { hour };
    let schedule = Schedule::Daily {
        hour: i8::try_from(hour).ok()?,
        minute: 0,
    };
    schedule.is_valid().then_some(schedule)
}

/// Exécute les échéances dues jusqu'à l'arrêt.
pub async fn run(app: App, jobs: Vec<Job>, ports: Ports, mut shutdown: watch::Receiver<bool>) {
    loop {
        for job in &jobs {
            run_due(&app, &ports, job).await;
        }
        tokio::select! {
            () = tokio::time::sleep(TICK) => {}
            _ = shutdown.wait_for(|stop| *stop) => return,
        }
    }
}

async fn run_due(app: &App, ports: &Ports, job: &Job) {
    let now = app.clock.now();
    let Some((period, _)) = (job.schedule)(app)
        .filter(|schedule| schedule.is_valid())
        .and_then(|schedule| schedule.due(now))
    else {
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
    // Une tâche par passage : un panic ne fait tomber que ce passage, pas la boucle de toutes les
    // tâches.
    let outcome = tokio::spawn((job.run)(app.clone(), ports.clone(), period.clone()))
        .await
        .unwrap_or_else(|panic| Err(format!("job panicked: {panic}").into()));
    match outcome {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_daily_hour_from_the_config_becomes_a_deadline() {
        assert_eq!(daily_at(9), Some(Schedule::Daily { hour: 9, minute: 0 }));
        assert_eq!(daily_at(2), Some(Schedule::Daily { hour: 3, minute: 0 }));
        assert_eq!(daily_at(0), Some(Schedule::Daily { hour: 0, minute: 0 }));
        assert_eq!(daily_at(24), None);
    }
}
