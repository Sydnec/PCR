//! Les réactions : les stats de l'année (`pcr_app::reactions`), et les rôles en libre-service du
//! message des rôles. Celles du bot ne comptent pas.

use twilight_model::{channel::message::EmojiReactionType, gateway::GatewayReaction};

use crate::{Ctx, id, roles};

pub async fn handle(ctx: Ctx, reaction: GatewayReaction, added: bool) {
    if reaction.user_id.get() == ctx.application_id.get() || reaction.guild_id != Some(ctx.guild_id)
    {
        return;
    }
    // Le nom de l'emoji, comme en v1 : le caractère d'un emoji Unicode, le nom d'un emoji serveur.
    let emoji = match &reaction.emoji {
        EmojiReactionType::Unicode { name } => name.clone(),
        EmojiReactionType::Custom { name, .. } => name.clone().unwrap_or_default(),
    };
    pcr_app::reactions::counted(
        &ctx.app,
        id(reaction.user_id.get()),
        id(reaction.message_id.get()),
        &emoji,
        added,
    );
    if Some(reaction.message_id.get()) == ctx.app.instance.discord.role_message_id {
        roles::reacted(&ctx, reaction.user_id, &emoji, added).await;
    }
}
