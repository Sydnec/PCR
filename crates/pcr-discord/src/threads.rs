//! La liste des fils du serveur, republiée dans son salon à chaque fil créé dans un salon textuel que
//! voit le rôle par défaut (pas le forum des sondages ni le salon de l'Avent, qui ont leurs propres
//! fils). Texte de la v1 (`pcr_core::threads`).

use std::collections::{HashMap, HashSet};

use pcr_core::{
    purge::{self, split_message},
    threads::{self as rules, ChannelThreads},
};
use twilight_model::{
    channel::{Channel, ChannelType, message::AllowedMentions},
    guild::Permissions,
    id::{
        Id,
        marker::{ChannelMarker, MessageMarker},
    },
};
use twilight_util::permission_calculator::PermissionCalculator;

use crate::Ctx;

pub async fn on_thread_create(ctx: Ctx, thread: Channel) {
    let discord = &ctx.app.instance.discord;
    let Some(parent) = thread.parent_id.map(Id::get) else {
        return;
    };
    if discord.thread_list_channel_id.is_none()
        || Some(parent) == discord.poll_channel_id
        || Some(parent) == discord.advent_channel_id
        || thread.newly_created != Some(true)
    {
        return;
    }
    if let Err(error) = rebuild(&ctx, parent).await {
        tracing::warn!(%error, "could not update the thread list");
    }
}

/// Les salons textuels que voit un membre qui n'a que le rôle par défaut.
fn visible_text_channels(
    ctx: &Ctx,
    channels: &[Channel],
    roles: &[twilight_model::guild::Role],
) -> HashSet<Id<ChannelMarker>> {
    let permissions = |id: u64| {
        roles
            .iter()
            .find(|role| role.id.get() == id)
            .map_or(Permissions::empty(), |role| role.permissions)
    };
    let Some(default_role) = ctx
        .app
        .instance
        .discord
        .default_role_id
        .and_then(Id::new_checked)
    else {
        return HashSet::new();
    };
    let member_roles = [(default_role, permissions(default_role.get()))];
    let everyone = permissions(ctx.guild_id.get());
    channels
        .iter()
        .filter(|channel| channel.kind == ChannelType::GuildText)
        .filter(|channel| {
            // Un membre fictif : seuls comptent le rôle @everyone et le rôle par défaut.
            PermissionCalculator::new(ctx.guild_id, Id::new(1), everyone, &member_roles)
                .in_channel(
                    channel.kind,
                    channel.permission_overwrites.as_deref().unwrap_or_default(),
                )
                .contains(Permissions::VIEW_CHANNEL)
        })
        .map(|channel| channel.id)
        .collect()
}

/// Relit tous les fils et republie la liste ; rien si le fil a été créé ailleurs que dans un salon
/// visible.
async fn rebuild(ctx: &Ctx, parent: u64) -> Result<(), String> {
    let Some(list_channel) = ctx
        .app
        .instance
        .discord
        .thread_list_channel_id
        .and_then(Id::new_checked)
    else {
        return Ok(());
    };
    let _one_at_a_time = ctx.thread_list.lock().await;
    let http = &ctx.http;
    let err = |e: &dyn std::fmt::Display| e.to_string();
    let channels = http
        .guild_channels(ctx.guild_id)
        .await
        .map_err(|e| err(&e))?
        .models()
        .await
        .map_err(|e| err(&e))?;
    let roles = http
        .roles(ctx.guild_id)
        .await
        .map_err(|e| err(&e))?
        .models()
        .await
        .map_err(|e| err(&e))?;
    let visible = visible_text_channels(ctx, &channels, &roles);
    if !visible.iter().any(|id| id.get() == parent) {
        return Ok(());
    }
    let mut threads: HashMap<Id<ChannelMarker>, Vec<(u64, String)>> = HashMap::new();
    let active = http
        .active_threads(ctx.guild_id)
        .await
        .map_err(|e| err(&e))?
        .model()
        .await
        .map_err(|e| err(&e))?;
    for thread in active.threads {
        if let Some(parent) = thread.parent_id.filter(|id| visible.contains(id)) {
            threads
                .entry(parent)
                .or_default()
                .push((thread.id.get(), thread.name.unwrap_or_default()));
        }
    }
    for channel in &visible {
        let archived = match http.public_archived_threads(*channel).await {
            Ok(response) => response.model().await.map_err(|e| err(&e))?.threads,
            Err(error) => {
                tracing::warn!(
                    ?error,
                    channel = channel.get(),
                    "archived threads unreadable"
                );
                continue;
            }
        };
        let list = threads.entry(*channel).or_default();
        for thread in archived {
            if !list.iter().any(|(id, _)| *id == thread.id.get()) {
                list.push((thread.id.get(), thread.name.unwrap_or_default()));
            }
        }
    }
    let position_of = |id: Option<Id<ChannelMarker>>| {
        id.and_then(|id| channels.iter().find(|channel| channel.id == id))
            .and_then(|channel| channel.position)
    };
    let listed: Vec<ChannelThreads> = channels
        .iter()
        .filter(|channel| visible.contains(&channel.id))
        .map(|channel| ChannelThreads {
            name: channel.name.clone().unwrap_or_default(),
            category_position: position_of(channel.parent_id).map(i64::from),
            position: channel.position.map(i64::from).unwrap_or_default(),
            threads: threads.remove(&channel.id).unwrap_or_default(),
        })
        .collect();
    let text = rules::list(listed);
    clear(ctx, list_channel).await?;
    let silent = AllowedMentions::default();
    for message in split_message(&text, pcr_core::links::MESSAGE_MAX) {
        http.create_message(list_channel)
            .content(&message)
            .allowed_mentions(Some(&silent))
            .await
            .map_err(|e| err(&e))?;
    }
    Ok(())
}

/// Vide le salon de la liste (ses 100 derniers messages) : les récents par lot, les autres un par un.
async fn clear(ctx: &Ctx, channel: Id<ChannelMarker>) -> Result<(), String> {
    let messages = ctx
        .http
        .channel_messages(channel)
        .limit(100)
        .await
        .map_err(|e| e.to_string())?
        .models()
        .await
        .map_err(|e| e.to_string())?;
    let ids: Vec<Id<MessageMarker>> = messages.iter().map(|message| message.id).collect();
    delete(ctx, channel, &ids, ctx.app.clock.now_ms()).await;
    Ok(())
}

/// Supprime des messages : par lots de 2 à 100 pour ceux de moins de 14 jours, un par un sinon.
/// Renvoie le nombre supprimé ; les échecs sont journalisés.
pub async fn delete(
    ctx: &Ctx,
    channel: Id<ChannelMarker>,
    ids: &[Id<MessageMarker>],
    now_ms: i64,
) -> usize {
    let (recent, old): (Vec<_>, Vec<_>) = ids
        .iter()
        .copied()
        .partition(|id| purge::is_recent(id.get(), now_ms));
    let mut deleted = 0;
    if recent.len() >= 2 {
        for batch in recent.chunks(purge::PAGE) {
            match ctx.http.delete_messages(channel, batch).await {
                Ok(_) => deleted += batch.len(),
                Err(error) => tracing::warn!(?error, "bulk delete refused"),
            }
        }
    }
    let singles = if recent.len() >= 2 {
        old
    } else {
        [recent, old].concat()
    };
    for id in singles {
        match ctx.http.delete_message(channel, id).await {
            Ok(_) => deleted += 1,
            Err(error) => tracing::warn!(?error, "delete refused"),
        }
    }
    deleted
}
