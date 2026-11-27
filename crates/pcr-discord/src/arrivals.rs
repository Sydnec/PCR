//! Les arrivées : le rôle d'un nouveau membre, selon l'invitation qu'il a suivie (l'invitation des
//! membres temporaires donne leur rôle, toute autre le rôle par défaut). L'invitation se reconnaît
//! à son compteur d'utilisations, qui a monté depuis la dernière lecture (un cache, relu à chaque
//! connexion). Sans droit « Gérer le serveur », les invitations ne se lisent pas : rôle par défaut.

use std::collections::HashMap;

use twilight_model::{
    gateway::payload::incoming::{InviteCreate, MemberAdd},
    id::Id,
};

use crate::Ctx;

/// Les utilisations de chaque invitation, lues sur Discord.
async fn read_invites(ctx: &Ctx) -> Option<HashMap<String, u64>> {
    let invites = ctx
        .http
        .guild_invites(ctx.guild_id)
        .await
        .ok()?
        .models()
        .await
        .ok()?;
    Some(
        invites
            .into_iter()
            .map(|invite| (invite.code, invite.uses.unwrap_or_default()))
            .collect(),
    )
}

pub async fn cache_invites(ctx: Ctx) {
    if let Some(invites) = read_invites(&ctx).await {
        *ctx.invites
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = invites;
    } else {
        tracing::warn!("invites unreadable (Manage Server missing?): arrival roles default");
    }
}

/// Une invitation créée, sans utilisation encore.
pub fn invite_created(ctx: &Ctx, invite: &InviteCreate) {
    ctx.invites
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .insert(invite.code.clone(), 0);
    tracing::info!(code = %invite.code, inviter = ?invite.inviter.as_ref().map(|u| u.id), "invite created");
}

pub async fn member_added(ctx: Ctx, member: MemberAdd) {
    if member.guild_id != ctx.guild_id {
        return;
    }
    let fresh = read_invites(&ctx).await;
    let used = fresh.as_ref().and_then(|fresh| {
        let cached = ctx
            .invites
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        // Une invitation créée pendant que le bot était arrêté n'a pas d'entrée : elle comptait 0.
        fresh
            .iter()
            .find(|(code, uses)| cached.get(*code).copied().unwrap_or_default() < **uses)
            .map(|(code, _)| code.clone())
    });
    let discord = &ctx.app.instance.discord;
    let temporary = used.is_some() && used == discord.temporary_member_invite_code;
    let role = if temporary {
        discord.temporary_member_role_id
    } else {
        discord.default_role_id
    };
    tracing::info!(user = member.user.id.get(), invite = ?used, temporary, "member joined");
    if let Some(fresh) = fresh {
        *ctx.invites
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = fresh;
    }
    let Some(role) = role.and_then(Id::new_checked) else {
        tracing::error!("no arrival role configured");
        return;
    };
    if let Err(error) = ctx
        .http
        .add_guild_member_role(ctx.guild_id, member.user.id, role)
        .await
    {
        tracing::error!(?error, "could not give the arrival role");
    }
}
