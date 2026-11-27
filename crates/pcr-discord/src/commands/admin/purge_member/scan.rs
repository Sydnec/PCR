//! Le parcours d'une purge : l'inventaire des salons et des fils (actifs, archivés), puis chaque
//! salon du plus récent au plus ancien message, en parallèle (`purgeMember.concurrency`).

use std::{
    collections::HashSet,
    sync::{Arc, atomic::Ordering},
    time::{Duration, Instant},
};

use pcr_core::purge::{self as rules, ChannelTally, PAGE, Report};
use tokio::{sync::Semaphore, task::JoinSet};
use twilight_model::{
    channel::{Channel, ChannelType},
    id::{
        Id,
        marker::{ChannelMarker, MessageMarker},
    },
};

use super::{ARCHIVED_THREAD, NO_ACCESS, Progress, UNKNOWN_MESSAGE, code};
use crate::Ctx;

/// Les salons qui portent des messages : textes, annonces, chats vocaux.
fn has_messages(kind: ChannelType) -> bool {
    matches!(
        kind,
        ChannelType::GuildText
            | ChannelType::GuildAnnouncement
            | ChannelType::GuildVoice
            | ChannelType::GuildStageVoice
            | ChannelType::PublicThread
            | ChannelType::PrivateThread
            | ChannelType::AnnouncementThread
    )
}

/// Les salons qui ont des fils (forums compris).
fn has_threads(kind: ChannelType) -> bool {
    matches!(
        kind,
        ChannelType::GuildText
            | ChannelType::GuildAnnouncement
            | ChannelType::GuildForum
            | ChannelType::GuildMedia
    )
}

/// Ce que donne un salon parcouru.
enum Outcome {
    Done(ChannelTally),
    /// Illisible faute de droits.
    Skipped,
    Failed(String),
}

pub(super) async fn purge(
    ctx: &Ctx,
    target: u64,
    progress: &Arc<Progress>,
    settings: &pcr_core::config::PurgeMember,
) -> anyhow::Result<Report> {
    let guild = ctx.http.guild(ctx.guild_id).await?.model().await?;
    let channels = ctx
        .http
        .guild_channels(ctx.guild_id)
        .await?
        .models()
        .await?;
    let active = ctx.http.active_threads(ctx.guild_id).await?.model().await?;
    let slots = Arc::new(Semaphore::new(
        settings.concurrency.max(1).try_into().unwrap_or(1),
    ));
    let mut tasks = JoinSet::new();
    let mut seen = HashSet::new();
    let mut spawned = std::collections::HashMap::new();
    let mut enqueue = |channel: &Channel| {
        if !seen.insert(channel.id) {
            return;
        }
        progress.queued.fetch_add(1, Ordering::Relaxed);
        let archived = channel
            .thread_metadata
            .as_ref()
            .is_some_and(|metadata| metadata.archived);
        let (ctx, slots, progress, id, parent) = (
            ctx.clone(),
            Arc::clone(&slots),
            Arc::clone(progress),
            channel.id,
            channel.parent_id,
        );
        let limit_log = settings.rate_limit_log_seconds;
        let task = tasks.spawn(async move {
            let _slot = slots.acquire_owned().await;
            let outcome = purge_channel(&ctx, id, archived, target, &progress, limit_log).await;
            progress.done.fetch_add(1, Ordering::Relaxed);
            (id, parent, outcome)
        });
        // Une tâche qui panique ne rend pas son salon : la table le retrouve pour le bilan.
        spawned.insert(task.id(), id);
    };
    for channel in channels.iter().filter(|channel| has_messages(channel.kind)) {
        enqueue(channel);
    }
    for thread in &active.threads {
        enqueue(thread);
    }
    // Les fils archivés se découvrent pendant que les premiers salons se purgent.
    let mut failed = Vec::new();
    for parent in channels.iter().filter(|channel| has_threads(channel.kind)) {
        match archived_threads(ctx, parent).await {
            Ok(threads) => threads.iter().for_each(&mut enqueue),
            Err(error) => failed.push((
                parent.id.get(),
                format!("fils archivés illisibles ({error})"),
            )),
        }
    }
    let mut report = Report {
        guild: guild.name,
        failed,
        ..Report::default()
    };
    let mut skipped_parents = HashSet::new();
    let mut skipped_threads = Vec::new();
    while let Some(joined) = tasks.join_next().await {
        let (id, parent, outcome) = match joined {
            Ok(done) => done,
            Err(error) => {
                if let Some(id) = spawned.get(&error.id()) {
                    report
                        .failed
                        .push((id.get(), "tâche interrompue (voir le journal)".to_owned()));
                }
                tracing::error!(?error, "a purge task failed");
                continue;
            }
        };
        match outcome {
            Outcome::Done(tally) if tally.deleted > 0 || tally.failed > 0 => {
                report.touched.push(tally);
            }
            Outcome::Done(_) => {}
            Outcome::Skipped
                if parent.is_some_and(|parent| channels.iter().any(|c| c.id == parent)) =>
            {
                skipped_threads.push((id, parent));
            }
            Outcome::Skipped => {
                skipped_parents.insert(id);
                report.skipped.push(id.get());
            }
            Outcome::Failed(error) => report.failed.push((id.get(), error)),
        }
    }
    // Le fil d'un salon déjà cité comme ignoré ne l'est pas une seconde fois.
    for (id, parent) in skipped_threads {
        if !parent.is_some_and(|parent| skipped_parents.contains(&parent)) {
            report.skipped.push(id.get());
        }
    }
    Ok(report)
}

/// Les fils archivés d'un salon, page par page : publics, et privés quand le bot peut les lister.
async fn archived_threads(ctx: &Ctx, parent: &Channel) -> Result<Vec<Channel>, String> {
    let mut found = Vec::new();
    for private in [false, true] {
        if private && parent.kind != ChannelType::GuildText {
            continue;
        }
        let mut before: Option<String> = None;
        loop {
            let page = if private {
                let request = ctx
                    .http
                    .private_archived_threads(parent.id)
                    .limit(PAGE as u64);
                match before {
                    Some(ref before) => request.before(before).await,
                    None => request.await,
                }
            } else {
                let request = ctx
                    .http
                    .public_archived_threads(parent.id)
                    .limit(PAGE as u64);
                match before {
                    Some(ref before) => request.before(before).await,
                    None => request.await,
                }
            };
            let listing = match page {
                Ok(response) => response.model().await.map_err(|e| e.to_string())?,
                // Les fils privés ne se listent qu'avec « Gérer les fils » : sans, on s'en passe.
                Err(error) if private && code(&error).is_some_and(|c| NO_ACCESS.contains(&c)) => {
                    break;
                }
                Err(error) => return Err(error.to_string()),
            };
            let more = listing.has_more.unwrap_or(false) && !listing.threads.is_empty();
            before = listing
                .threads
                .last()
                .and_then(|thread| thread.thread_metadata.as_ref())
                .map(|metadata| metadata.archive_timestamp.iso_8601().to_string());
            found.extend(listing.threads);
            if !more {
                break;
            }
        }
    }
    Ok(found)
}

/// Une requête, chronométrée : une attente imposée par Discord au-delà du seuil réglé se journalise
/// (c'est elle qui fait passer une purge pour bloquée).
async fn timed<T>(
    channel: Id<ChannelMarker>,
    limit_seconds: u32,
    work: impl std::future::IntoFuture<Output = T>,
) -> T {
    let started = Instant::now();
    let result = work.await;
    let waited = started.elapsed();
    if waited >= Duration::from_secs(limit_seconds.into()) {
        tracing::info!(
            channel = channel.get(),
            waited = %rules::duration(i64::try_from(waited.as_millis()).unwrap_or(i64::MAX)),
            "/admin purge-membre: Discord makes us wait"
        );
    }
    result
}

/// Un salon, du plus récent au plus ancien message. Ce qui a été trouvé part au fil de la lecture.
async fn purge_channel(
    ctx: &Ctx,
    channel: Id<ChannelMarker>,
    archived: bool,
    target: u64,
    progress: &Progress,
    limit_log: u32,
) -> Outcome {
    let mut tally = ChannelTally {
        channel: channel.get(),
        ..ChannelTally::default()
    };
    let mut before: Option<Id<MessageMarker>> = None;
    let mut reopened = false;
    let outcome = loop {
        let request = ctx.http.channel_messages(channel).limit(100);
        let page = match before {
            Some(before) => timed(channel, limit_log, request.before(before)).await,
            None => timed(channel, limit_log, request).await,
        };
        let messages = match page {
            Ok(response) => match response.models().await {
                Ok(messages) => messages,
                Err(error) => break Some(Outcome::Failed(error.to_string())),
            },
            Err(error)
                if before.is_none() && code(&error).is_some_and(|c| NO_ACCESS.contains(&c)) =>
            {
                break Some(Outcome::Skipped);
            }
            Err(error) => break Some(Outcome::Failed(error.to_string())),
        };
        let read = u64::try_from(messages.len()).unwrap_or(u64::MAX);
        tally_scanned(progress, read);
        let mine: Vec<Id<MessageMarker>> = messages
            .iter()
            .filter(|message| message.author.id.get() == target)
            .map(|message| message.id)
            .collect();
        if !mine.is_empty() && archived && !reopened {
            if let Err(error) = ctx.http.update_thread(channel).archived(false).await {
                break Some(Outcome::Failed(error.to_string()));
            }
            reopened = true;
        }
        let (deleted, failed) = delete_all(ctx, channel, &mine, &mut reopened, limit_log).await;
        tally.deleted += deleted;
        tally.failed += failed;
        progress.deleted.fetch_add(deleted, Ordering::Relaxed);
        before = messages.iter().map(|message| message.id).min();
        if messages.len() < PAGE {
            break None;
        }
    };
    if reopened && let Err(error) = ctx.http.update_thread(channel).archived(true).await {
        tracing::warn!(
            ?error,
            channel = channel.get(),
            "thread left reopened by a purge"
        );
    }
    outcome.unwrap_or(Outcome::Done(tally))
}

fn tally_scanned(progress: &Progress, read: u64) {
    progress.scanned.fetch_add(read, Ordering::Relaxed);
}

/// Supprime les messages trouvés : les récents par lot, les autres un par un ; un fil archivé de
/// lui-même en cours de route est rouvert. Renvoie (supprimés, impossibles).
async fn delete_all(
    ctx: &Ctx,
    channel: Id<ChannelMarker>,
    ids: &[Id<MessageMarker>],
    reopened: &mut bool,
    limit_log: u32,
) -> (u64, u64) {
    let now = ctx.app.clock.now_ms();
    let (recent, old): (Vec<_>, Vec<_>) = ids
        .iter()
        .copied()
        .partition(|id| rules::is_recent(id.get(), now));
    let mut singles = old;
    let (mut deleted, mut failed) = (0, 0);
    if recent.len() >= 2 {
        match timed(
            channel,
            limit_log,
            ctx.http.delete_messages(channel, &recent),
        )
        .await
        {
            Ok(_) => deleted += u64::try_from(recent.len()).unwrap_or(u64::MAX),
            // Refusé quand même (fil archivé, âge franchi à la seconde près) : chacun repart seul.
            Err(_) => singles.extend(recent),
        }
    } else {
        singles.extend(recent);
    }
    for id in singles {
        let mut result = timed(channel, limit_log, ctx.http.delete_message(channel, id)).await;
        if let Err(error) = &result
            && code(error) == Some(ARCHIVED_THREAD)
            && ctx
                .http
                .update_thread(channel)
                .archived(false)
                .await
                .is_ok()
        {
            *reopened = true;
            result = ctx.http.delete_message(channel, id).await;
        }
        match result {
            Ok(_) => deleted += 1,
            // Déjà supprimé entre-temps (par son auteur, un modérateur) : rien à faire.
            Err(error) if code(&error) == Some(UNKNOWN_MESSAGE) => {}
            Err(_) => failed += 1,
        }
    }
    (deleted, failed)
}
