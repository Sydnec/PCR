//! Sondages côté Discord : chaque ligne reçoit sa réaction (`pcr_core::polls::number`). Un post du
//! forum des sondages est numéroté à sa création (`/poll`, ou un membre qui poste directement),
//! `/edit` et `/week` après avoir écrit leur texte.
//!
//! Le message du bot est réécrit sur place ; celui d'un membre, que le bot ne peut pas modifier, est
//! reposté numéroté dans le fil puis supprimé, comme en v1.

use pcr_core::polls;
use twilight_http::request::channel::reaction::RequestReactionType;
use twilight_model::{
    channel::{Channel, message::AllowedMentions},
    id::{
        Id,
        marker::{ChannelMarker, EmojiMarker, MessageMarker},
    },
};

use crate::{Ctx, ui};

/// Les noms des emoji du serveur : seuls ceux-là peuvent servir de réaction.
async fn server_emoji(ctx: &Ctx) -> Vec<String> {
    match ctx.http.emojis(ctx.guild_id).await {
        Ok(response) => response
            .models()
            .await
            .map(|emojis| emojis.into_iter().map(|emoji| emoji.name).collect())
            .unwrap_or_default(),
        Err(error) => {
            tracing::warn!(?error, "could not list the server emoji");
            Vec::new()
        }
    }
}

/// Un emoji serveur `<:nom:id>`, ou un emoji Unicode.
fn reaction(emoji: &str) -> Option<RequestReactionType<'_>> {
    if let Some(inner) = emoji
        .strip_prefix("<:")
        .and_then(|rest| rest.strip_suffix('>'))
    {
        let (name, id) = inner.split_once(':')?;
        return Some(RequestReactionType::Custom {
            id: Id::<EmojiMarker>::new_checked(id.parse().ok()?)?,
            name: Some(name),
        });
    }
    Some(RequestReactionType::Unicode { name: emoji })
}

/// Pose les réactions, une à une : une réaction refusée (emoji disparu) n'arrête pas les suivantes.
async fn react(
    ctx: &Ctx,
    channel: Id<ChannelMarker>,
    message: Id<MessageMarker>,
    emoji: &[String],
) {
    for emoji in emoji {
        let Some(reaction) = reaction(emoji) else {
            continue;
        };
        if let Err(error) = ctx.http.create_reaction(channel, message, &reaction).await {
            tracing::warn!(?error, %emoji, "could not react to a poll");
        }
    }
}

/// Numérote un sondage du bot et réagit. `content` est le texte voulu : il est écrit s'il diffère
/// de ce que porte le message (`write`, la question réécrite par `/edit`) ou si une ligne prend un
/// numéro.
pub async fn number_own(
    ctx: &Ctx,
    channel: Id<ChannelMarker>,
    message: Id<MessageMarker>,
    content: &str,
    write: bool,
) -> Result<(), String> {
    let usable = server_emoji(ctx).await;
    let numbered = polls::number(content, |emoji| is_usable(&usable, emoji));
    let text = if numbered.rewritten {
        Some(numbered.text.as_str())
    } else {
        write.then_some(content)
    };
    if let Some(text) = text {
        let mentions = ui::relayed();
        ctx.http
            .update_message(channel, message)
            .content(Some(text))
            .allowed_mentions(Some(&mentions))
            .await
            .map_err(|e| e.to_string())?;
    }
    react(ctx, channel, message, &numbered.reactions).await;
    Ok(())
}

/// Un emoji serveur est utilisable s'il porte le nom d'un emoji du serveur (comme en v1).
fn is_usable(server: &[String], emoji: &str) -> bool {
    emoji
        .split(':')
        .nth(1)
        .is_some_and(|name| server.iter().any(|known| known == name))
}

/// Un post vient d'être créé : s'il est dans le forum des sondages, son message est numéroté.
pub async fn on_thread_create(ctx: Ctx, thread: Channel) {
    let Some(poll_channel) = ctx.app.instance.discord.poll_channel_id else {
        return;
    };
    // Un fil déjà existant où le bot vient d'être ajouté arrive aussi par cet événement.
    if thread.parent_id.map(Id::get) != Some(poll_channel) || thread.newly_created != Some(true) {
        return;
    }
    if let Err(error) = number_post(&ctx, thread.id).await {
        tracing::warn!(%error, thread = thread.id.get(), "could not number a poll");
    }
}

/// Le message d'ouverture d'un post de forum porte l'identifiant du fil.
async fn number_post(ctx: &Ctx, thread: Id<ChannelMarker>) -> Result<(), String> {
    let starter = ctx
        .http
        .message(thread, thread.cast())
        .await
        .map_err(|e| e.to_string())?
        .model()
        .await
        .map_err(|e| e.to_string())?;
    if starter.author.id.get() == ctx.application_id.get() {
        return number_own(ctx, thread, starter.id, &starter.content, false).await;
    }
    let usable = server_emoji(ctx).await;
    let numbered = polls::number(&starter.content, |emoji| is_usable(&usable, emoji));
    if !numbered.rewritten {
        react(ctx, thread, starter.id, &numbered.reactions).await;
        return Ok(());
    }
    let mentions = AllowedMentions::default();
    let copy = ctx
        .http
        .create_message(thread)
        .content(&numbered.text)
        .allowed_mentions(Some(&mentions))
        .await
        .map_err(|e| e.to_string())?
        .model()
        .await
        .map_err(|e| e.to_string())?;
    react(ctx, thread, copy.id, &numbered.reactions).await;
    ctx.http
        .delete_message(thread, starter.id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}
