//! Les rôles en libre-service : le message des rôles, réécrit au démarrage depuis les rôles du serveur
//! (`pcr_core::roles`), et les réactions qui les donnent ou les reprennent.

use pcr_core::roles::{self as rules, Role};
use twilight_model::id::{
    Id,
    marker::{RoleMarker, UserMarker},
};

use crate::{Ctx, polls};

/// Les rôles du serveur, tels que les règles les voient.
pub async fn server_roles(ctx: &Ctx) -> Result<Vec<Role>, String> {
    let roles = ctx
        .http
        .roles(ctx.guild_id)
        .await
        .map_err(|e| e.to_string())?
        .models()
        .await
        .map_err(|e| e.to_string())?;
    Ok(roles
        .into_iter()
        .map(|role| Role {
            id: role.id.get(),
            name: role.name,
            position: role.position,
            managed: role.managed,
            permissions: role.permissions.bits(),
        })
        .collect())
}

/// Au premier démarrage : le message des rôles proposé, et ses réactions. Il manque son salon, son
/// message ou le rôle de ping : rien.
pub async fn sync_message(ctx: Ctx) {
    let discord = &ctx.app.instance.discord;
    let (Some(channel), Some(message), Some(ping)) = (
        discord.role_channel_id.and_then(Id::new_checked),
        discord.role_message_id.and_then(Id::new_checked),
        discord.ping_role_id,
    ) else {
        return;
    };
    let roles = match server_roles(&ctx).await {
        Ok(roles) => roles,
        Err(error) => {
            tracing::warn!(%error, "could not read the server roles");
            return;
        }
    };
    let (text, reactions) = rules::role_message(&roles, ping);
    let silent = twilight_model::channel::message::AllowedMentions::default();
    if let Err(error) = ctx
        .http
        .update_message(channel, message)
        .content(Some(&text))
        .allowed_mentions(Some(&silent))
        .await
    {
        tracing::warn!(?error, "could not update the role message");
        return;
    }
    polls::react(&ctx, channel, message, &reactions).await;
}

/// Une réaction au message des rôles : les rôles dont le nom commence par cet emoji, donnés ou repris.
pub async fn reacted(ctx: &Ctx, user: Id<UserMarker>, emoji: &str, added: bool) {
    let Some(ping) = ctx.app.instance.discord.ping_role_id else {
        return;
    };
    let roles = match server_roles(ctx).await {
        Ok(roles) => roles,
        Err(error) => {
            tracing::warn!(%error, "could not read the server roles");
            return;
        }
    };
    for role in rules::for_reaction(&roles, ping, emoji) {
        let Some(role) = Id::<RoleMarker>::new_checked(role.id) else {
            continue;
        };
        let done = if added {
            ctx.http
                .add_guild_member_role(ctx.guild_id, user, role)
                .await
        } else {
            ctx.http
                .remove_guild_member_role(ctx.guild_id, user, role)
                .await
        };
        if let Err(error) = done {
            tracing::warn!(?error, added, "could not change a self-service role");
        }
    }
}
