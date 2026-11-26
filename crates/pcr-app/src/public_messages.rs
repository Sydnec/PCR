//! Le worker des messages publics : il écrit sur Discord ce que la base dit de chaque message en
//! retard (`pcr_db::public_messages`).
//!
//! Un seul worker, qui traite les messages un par un : deux réécritures d'un même message ne se
//! croisent jamais, et le contenu se construit au moment d'écrire, depuis la base. Deux chemins,
//! comme en v1 :
//! - réveillé après un commit (`App::public_messages_changed`), il écrit les changements récents ;
//! - au démarrage puis toutes les 5 minutes, il rattrape ceux qui ont échoué, passé le délai de grâce
//!   (`publicMessages.repairGraceSeconds`) et dans la fenêtre (`repairWindowHours`) : l'historique ne
//!   se retouche pas, et un message en échec permanent ne se retente pas à chaque réveil.

use std::{future::Future, pin::Pin, sync::Arc, time::Duration};

use tokio::time::Instant;

use pcr_db::public_messages;
pub use pcr_db::public_messages::PublicMessage;
use tokio::sync::watch;

use crate::App;

/// Cadence du rattrapage.
const REPAIR_EVERY: Duration = Duration::from_mins(5);
/// Messages traités par passage : un rattrapage après une longue panne s'étale sur plusieurs.
const BATCH: i64 = 100;

/// Ce que l'adaptateur Discord a fait d'un message.
#[derive(Debug)]
pub enum Written {
    /// Posté ou réécrit ; `message_id` est celui du message sur Discord.
    Done { message_id: i64 },
    /// Rien à écrire : ce type de message n'a pas (encore) de rendu.
    Skipped,
}

#[derive(Debug)]
pub enum WriteError {
    /// Le message ne se réécrira plus jamais (supprimé, salon perdu, droits retirés).
    Gone,
    /// Panne passagère (coupure, limite de débit, 5xx) : à réessayer.
    Transient(String),
    /// Refus que réessayer ne changera pas (un contenu que Discord juge invalide) : un bug à voir.
    Permanent(String),
}

pub type WriteFuture<'a> = Pin<Box<dyn Future<Output = Result<Written, WriteError>> + Send + 'a>>;

/// L'écriture sur Discord, implémentée par `pcr-discord` : construire le contenu depuis la base,
/// puis poster (pas encore de `message_id`) ou réécrire.
pub trait PublicMessagePort: Send + Sync + std::fmt::Debug {
    fn write<'a>(&'a self, message: &'a PublicMessage) -> WriteFuture<'a>;
}

/// Écrit les messages en retard jusqu'à l'arrêt. Le rattrapage a une échéance fixe : des réveils
/// rapprochés ne doivent pas le repousser indéfiniment.
pub async fn run(app: App, port: Arc<dyn PublicMessagePort>, mut shutdown: watch::Receiver<bool>) {
    let mut next_repair = Instant::now();
    loop {
        let repair = Instant::now() >= next_repair;
        if repair {
            next_repair = Instant::now() + REPAIR_EVERY;
        }
        sweep(&app, &*port, repair, &shutdown).await;
        if *shutdown.borrow() {
            return;
        }
        tokio::select! {
            () = app.public_messages.notified() => {}
            () = tokio::time::sleep_until(next_repair) => {}
            _ = shutdown.wait_for(|stop| *stop) => return,
        }
    }
}

/// Parcourt les messages en retard par pages, derrière un curseur : ceux qui restent en échec ne
/// cachent pas les suivants. S'arrête entre deux messages si l'arrêt est demandé : un message posté
/// doit pouvoir être noté avant la fermeture de la base.
async fn sweep(
    app: &App,
    port: &dyn PublicMessagePort,
    repair: bool,
    shutdown: &watch::Receiver<bool>,
) {
    let settings = app.game_config().public_messages.clone();
    let now = app.clock.now_ms();
    let grace_ms = i64::from(settings.repair_grace_seconds) * 1000;
    let window_ms = i64::from(settings.repair_window_hours) * 3_600_000;
    let (from, to) = if repair {
        (now - window_ms, now - grace_ms)
    } else {
        (now - grace_ms, now)
    };
    let mut after = None;
    loop {
        let page = match public_messages::behind(&app.db, from, to, after, BATCH).await {
            Ok(page) => page,
            Err(error) => {
                tracing::error!(?error, "reading public messages failed");
                return;
            }
        };
        for message in &page {
            if *shutdown.borrow() {
                return;
            }
            write_one(app, port, message, &settings, shutdown).await;
        }
        match page.last() {
            Some(last) if i64::try_from(page.len()).unwrap_or(i64::MAX) == BATCH => {
                after = Some((last.changed_at, last.id));
            }
            _ => return,
        }
    }
}

async fn write_one(
    app: &App,
    port: &dyn PublicMessagePort,
    message: &PublicMessage,
    settings: &pcr_core::config::PublicMessages,
    shutdown: &watch::Receiver<bool>,
) {
    let mut attempt = 0;
    let outcome = loop {
        match port.write(message).await {
            // Le worker est seul : une panne passagère retient les messages suivants le temps des
            // réessais, mais l'arrêt, lui, n'attend pas.
            Err(WriteError::Transient(reason)) if attempt < settings.retries => {
                let delay = u64::from(settings.retry_delay_ms) << attempt.min(16);
                tracing::debug!(%reason, id = message.id, attempt, "public message write retried");
                let mut shutdown = shutdown.clone();
                tokio::select! {
                    () = tokio::time::sleep(Duration::from_millis(delay)) => {}
                    _ = shutdown.wait_for(|stop| *stop) => break Err(WriteError::Transient(reason)),
                }
                attempt += 1;
            }
            other => break other,
        }
    };
    let recorded = match outcome {
        Ok(Written::Done { message_id }) => {
            public_messages::synced(&app.db, message.id, message.version, message_id).await
        }
        // Rien à écrire pour ce type : le noter fait, plutôt que de le relire à chaque passage.
        Ok(Written::Skipped) => {
            public_messages::skipped(&app.db, message.id, message.version).await
        }
        Err(WriteError::Gone) => {
            public_messages::gone(&app.db, message.id, app.clock.now_ms()).await
        }
        // Laissé en retard : le rattrapage le reprendra tant qu'il est dans la fenêtre.
        Err(WriteError::Transient(reason) | WriteError::Permanent(reason)) => {
            tracing::warn!(%reason, id = message.id, kind = %message.kind, "public message not written");
            Ok(())
        }
    };
    if let Err(error) = recorded {
        tracing::error!(
            ?error,
            id = message.id,
            "recording a public message write failed"
        );
    }
}
