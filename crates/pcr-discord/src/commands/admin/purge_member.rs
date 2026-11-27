//! `/admin purge-membre id` : supprime tous les messages d'un membre (parti ou non) sur le serveur,
//! salons, chats vocaux, fils actifs et archivés compris, et envoie le bilan en MP. Textes de la v1.
//!
//! Le parcours peut durer des heures, bien au-delà de la vie d'une interaction : il tourne en
//! tâche de fond, son avancement au journal du bot, et rien n'est publié dans les salons. Un salon que
//! le bot ne peut pas lire est cité dans le bilan plutôt que de faire échouer la purge. Un fil archivé
//! est rouvert le temps d'y supprimer, puis refermé.

use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};

use pcr_core::{
    format::number,
    purge::{self as rules, split_message},
};
use twilight_http::{api_error::ApiError, error::ErrorType};
use twilight_interactions::command::{CommandModel, CreateCommand};
use twilight_model::{
    channel::message::AllowedMentions,
    id::{Id, marker::UserMarker},
};

use crate::{
    Ctx,
    interactions::{Edit, Reply},
};

mod scan;

/// Les purges en cours, par membre visé.
pub type Running = Arc<Mutex<HashMap<u64, Arc<Progress>>>>;

/// Codes Discord : accès refusé, droits manquants, salon inconnu ; message inconnu ; fil archivé.
const NO_ACCESS: [u64; 3] = [50001, 50013, 10003];
const UNKNOWN_MESSAGE: u64 = 10008;
const ARCHIVED_THREAD: u64 = 50083;

/// L'avancement d'une purge, lu par le journal et par le refus d'une seconde purge.
#[derive(Debug)]
pub struct Progress {
    started: Instant,
    deleted: AtomicU64,
    scanned: AtomicU64,
    done: AtomicU64,
    queued: AtomicU64,
}

impl Progress {
    fn new() -> Self {
        Self {
            started: Instant::now(),
            deleted: AtomicU64::default(),
            scanned: AtomicU64::default(),
            done: AtomicU64::default(),
            queued: AtomicU64::default(),
        }
    }

    fn elapsed_ms(&self) -> i64 {
        i64::try_from(self.started.elapsed().as_millis()).unwrap_or(i64::MAX)
    }

    fn get(counter: &AtomicU64) -> String {
        number(i64::try_from(counter.load(Ordering::Relaxed)).unwrap_or(i64::MAX))
    }
}

#[derive(Debug, CommandModel, CreateCommand)]
#[command(
    name = "purge-membre",
    desc = "Supprime tous les messages d'un membre sur le serveur, bilan en MP"
)]
pub struct PurgeMembreCommand {
    #[command(desc = "Identifiant Discord du membre (il peut avoir quitté le serveur)")]
    pub id: String,
}

pub fn run(ctx: &Ctx, command: PurgeMembreCommand, admin: u64) -> Reply {
    let ctx = ctx.clone();
    Reply::later(true, async move {
        Ok(Edit::Text(start(&ctx, command.id.trim(), admin).await?))
    })
}

fn code(error: &twilight_http::Error) -> Option<u64> {
    match error.kind() {
        ErrorType::Response {
            error: ApiError::General(general),
            ..
        } => Some(general.code),
        _ => None,
    }
}

async fn start(ctx: &Ctx, raw: &str, admin: u64) -> anyhow::Result<String> {
    if !rules::is_snowflake(raw) {
        return Ok(format!(
            "❌ « {raw} » n'est pas un identifiant Discord : il faut 17 à 20 chiffres."
        ));
    }
    let target: u64 = raw.parse()?;
    if target == ctx.application_id.get() {
        return Ok("❌ C'est l'identifiant du bot : effacer ses messages casserait les apparitions et les boutons en cours.".to_owned());
    }
    // Une faute de frappe tombe presque toujours sur un compte qui n'existe pas : le seul garde-fou
    // avant l'irréversible.
    let user = match ctx.http.user(Id::<UserMarker>::new(target)).await {
        Ok(response) => response.model().await?,
        Err(error) if code(&error) == Some(10013) => {
            return Ok(format!(
                "❌ Aucun compte Discord ne porte l'identifiant `{raw}`."
            ));
        }
        Err(error) => return Err(error.into()),
    };
    let who = format!(
        "**{}** (`{raw}`)",
        user.global_name.as_deref().unwrap_or(&user.name)
    );
    let progress = {
        let mut running = ctx
            .purges
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(current) = running.get(&target) {
            return Ok(format!(
                "❌ Une purge des messages de {who} est déjà en cours depuis {} : **{}** message(s) \
                 supprimé(s) sur {} lu(s), {} salon(s) parcouru(s) sur {}.",
                rules::duration(current.elapsed_ms()),
                Progress::get(&current.deleted),
                Progress::get(&current.scanned),
                Progress::get(&current.done),
                Progress::get(&current.queued)
            ));
        }
        let progress = Arc::new(Progress::new());
        running.insert(target, Arc::clone(&progress));
        progress
    };
    tracing::info!(admin, target, "/admin purge-membre started");
    tokio::spawn(run_purge(ctx.clone(), target, who.clone(), admin, progress));
    Ok(format!(
        "🧹 Purge des messages de {who} lancée sur tout le serveur. Le bilan t'arrivera en MP."
    ))
}

/// Le parcours, du lancement au bilan ; le verrou est rendu quoi qu'il arrive.
async fn run_purge(ctx: Ctx, target: u64, who: String, admin: u64, progress: Arc<Progress>) {
    let settings = ctx.app.game_config().purge_member.clone();
    let ticker = tokio::spawn({
        let progress = Arc::clone(&progress);
        let every = Duration::from_secs(settings.progress_log_seconds.max(1).into());
        async move {
            loop {
                tokio::time::sleep(every).await;
                tracing::info!(
                    target,
                    elapsed = %rules::duration(progress.elapsed_ms()),
                    done = progress.done.load(Ordering::Relaxed),
                    queued = progress.queued.load(Ordering::Relaxed),
                    scanned = progress.scanned.load(Ordering::Relaxed),
                    deleted = progress.deleted.load(Ordering::Relaxed),
                    "/admin purge-membre in progress"
                );
            }
        }
    });
    let lines = match scan::purge(&ctx, target, &progress, &settings).await {
        Ok(mut report) => {
            report.who = who;
            report.elapsed_ms = progress.elapsed_ms();
            report.scanned = progress.scanned.load(Ordering::Relaxed);
            report.channels_done = progress.done.load(Ordering::Relaxed);
            tracing::info!(
                target,
                deleted = report.deleted(),
                "/admin purge-membre done"
            );
            report.lines()
        }
        Err(error) => {
            tracing::error!(%error, target, "/admin purge-membre stopped");
            vec![
                format!(
                    "❌ La purge des messages de {who} s'est arrêtée sur une erreur, voir le journal du bot."
                ),
                format!(
                    "**{}** message(s) supprimé(s) avant l'arrêt : la relancer reprendra le reste.",
                    Progress::get(&progress.deleted)
                ),
            ]
        }
    };
    ticker.abort();
    notify(&ctx, admin, &lines).await;
    ctx.purges
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .remove(&target);
}

/// Le bilan en MP, coupé à la taille d'un message ; des MP fermés le laissent au journal.
async fn notify(ctx: &Ctx, admin: u64, lines: &[String]) {
    let text = lines.join("\n");
    let sent = async {
        let dm = ctx
            .http
            .create_private_channel(Id::new(admin))
            .await?
            .model()
            .await?;
        let silent = AllowedMentions::default();
        for chunk in split_message(&text, pcr_core::links::MESSAGE_MAX) {
            ctx.http
                .create_message(dm.id)
                .content(&chunk)
                .allowed_mentions(Some(&silent))
                .await?;
        }
        anyhow::Ok(())
    };
    if let Err(error) = sent.await {
        tracing::error!(?error, report = %text.replace('\n', " | "), "/admin purge-membre report not sent");
    }
}
