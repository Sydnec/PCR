//! `/admin purge [lien] [nombre]` : supprime les derniers messages du salon, ou ceux qui suivent un
//! message. La borne se vérifie avant de supprimer quoi que ce soit : un lien mal collé ne vide pas
//! le salon. Discord ne supprime pas en lot les messages de plus de 14 jours : ils restent, comme en
//! v1. Textes de la v1.

use pcr_core::purge::{self as rules, PAGE};
use twilight_interactions::command::{CommandModel, CreateCommand};
use twilight_model::{
    application::interaction::Interaction,
    id::{
        Id,
        marker::{ChannelMarker, MessageMarker},
    },
};

use crate::{
    Ctx,
    interactions::{Edit, Reply},
    threads::delete,
};

#[derive(Debug, CommandModel, CreateCommand)]
#[command(name = "purge", desc = "Supprime des messages")]
pub struct PurgeCommand {
    #[command(desc = "Lien du message jusqu'auquel supprimer")]
    pub lien: Option<String>,
    #[command(
        desc = "Nombre de messages à supprimer (1 à 100)",
        min_value = 1,
        max_value = 100
    )]
    pub nombre: Option<i64>,
}

pub fn run(ctx: &Ctx, interaction: &Interaction, command: PurgeCommand, admin: u64) -> Reply {
    let ctx = ctx.clone();
    let channel = interaction.channel.as_ref().map(|channel| channel.id);
    Reply::later(true, async move {
        let Some(channel) = channel else {
            return Ok(Edit::Text(rules::NO_PARAMETER.to_owned()));
        };
        Ok(Edit::Text(match (command.nombre, command.lien) {
            (Some(count), _) if count > 0 => last(&ctx, channel, count, admin).await?,
            (_, Some(link)) => until(&ctx, channel, &link, admin).await?,
            _ => rules::NO_PARAMETER.to_owned(),
        }))
    })
}

/// Les `count` derniers messages.
async fn last(
    ctx: &Ctx,
    channel: Id<ChannelMarker>,
    count: i64,
    admin: u64,
) -> anyhow::Result<String> {
    let limit = u16::try_from(count.clamp(1, 100)).unwrap_or(100);
    let messages = ctx
        .http
        .channel_messages(channel)
        .limit(limit)
        .await?
        .models()
        .await?;
    let ids: Vec<Id<MessageMarker>> = messages
        .iter()
        .map(|message| message.id)
        .filter(|id| rules::is_recent(id.get(), ctx.app.clock.now_ms()))
        .collect();
    let deleted = delete(ctx, channel, &ids, ctx.app.clock.now_ms()).await;
    tracing::info!(admin, deleted, channel = channel.get(), "/admin purge");
    Ok(rules::deleted_count(deleted))
}

/// Ce qui suit le message du lien, au plus une page.
async fn until(
    ctx: &Ctx,
    channel: Id<ChannelMarker>,
    link: &str,
    admin: u64,
) -> anyhow::Result<String> {
    let Some((link_channel, message)) = rules::parse_message_link(link) else {
        return Ok(rules::BAD_LINK.to_owned());
    };
    let Some(message) =
        Id::<MessageMarker>::new_checked(message).filter(|_| link_channel == channel.get())
    else {
        return Ok(rules::BAD_LINK.to_owned());
    };
    if ctx.http.message(channel, message).await.is_err() {
        return Ok(rules::LINK_NOT_FOUND.to_owned());
    }
    let after = ctx
        .http
        .channel_messages(channel)
        .after(message)
        .limit(100)
        .await?
        .models()
        .await?;
    if after.is_empty() {
        return Ok(rules::NOTHING_AFTER.to_owned());
    }
    let now = ctx.app.clock.now_ms();
    let ids: Vec<Id<MessageMarker>> = after
        .iter()
        .map(|message| message.id)
        .filter(|id| rules::is_recent(id.get(), now))
        .collect();
    let deleted = delete(ctx, channel, &ids, now).await;
    tracing::info!(
        admin,
        deleted,
        channel = channel.get(),
        "/admin purge (link)"
    );
    Ok(rules::deleted_until_link(deleted, after.len() == PAGE))
}
