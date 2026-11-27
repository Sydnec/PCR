//! `/color hexa` : la couleur de son pseudo, par un rôle « &A020F0 » rangé sous le rôle repère des
//! couleurs. L'ancienne couleur est retirée, et son rôle supprimé quand plus personne ne le porte.
//! Textes de la v1.

use std::sync::Arc;

use pcr_app::members::MembersPort as _;
use pcr_core::roles::{self as rules, COLOR_PREFIX, ColorPlan};
use twilight_http::request::AuditLogReason as _;
use twilight_interactions::command::{CommandInputData, CommandModel, CreateCommand};
use twilight_model::{
    application::interaction::{Interaction, application_command::CommandData},
    guild::RolePosition,
    id::{
        Id,
        marker::{RoleMarker, UserMarker},
    },
};

use crate::{
    Ctx,
    interactions::{Edit, Reply},
    members::DiscordMembers,
    ui,
};

const FAILED: &str = "❌ Impossible d'appliquer cette couleur pour le moment.";

#[derive(Debug, CommandModel, CreateCommand)]
#[command(name = "color", desc = "Changer la couleur de votre pseudo")]
pub struct ColorCommand {
    /// code hexadécimal de la couleur
    #[command(desc = "code hexadécimal de la couleur")]
    pub hexa: String,
}

pub fn run(ctx: &Ctx, interaction: &Interaction, data: &CommandData) -> Reply {
    let (Ok(command), Some(member)) = (
        ColorCommand::from_interaction(CommandInputData::from(data.clone())),
        interaction.member.as_ref(),
    ) else {
        return ui::ephemeral_text(FAILED).into();
    };
    let Some(code) = rules::color_code(&command.hexa) else {
        return ui::ephemeral_text(rules::BAD_COLOR).into();
    };
    let (Some(user), held) = (interaction.author_id(), member.roles.clone()) else {
        return ui::ephemeral_text(FAILED).into();
    };
    let ctx = ctx.clone();
    Reply::later(true, async move {
        Ok(Edit::Text(match paint(&ctx, user, &held, &code).await {
            Ok(()) => "Ça y est, tu es tout.e beau/belle".to_owned(),
            Err(error) => {
                tracing::warn!(%error, "/color failed");
                FAILED.to_owned()
            }
        }))
    })
}

async fn paint(
    ctx: &Ctx,
    user: Id<UserMarker>,
    held: &[Id<RoleMarker>],
    code: &str,
) -> Result<(), String> {
    let guild = ctx.guild_id;
    let roles = crate::roles::server_roles(ctx).await?;
    let name = format!("{COLOR_PREFIX}{code}");
    let held: Vec<u64> = held.iter().map(|id| id.get()).collect();
    let (remove, existing) = match rules::color_plan(&roles, &held, code) {
        // Redemander sa couleur ne la retire pas (ni ne supprime son rôle).
        ColorPlan::AlreadyWorn => return Ok(()),
        ColorPlan::Change { remove, existing } => (remove, existing),
    };
    // L'ancienne couleur part ; son rôle aussi, si plus personne d'autre ne le porte (la v1 le
    // supprimait encore porté par un autre membre).
    for old in remove {
        let id = Id::<RoleMarker>::new(old);
        ctx.http
            .remove_guild_member_role(guild, user, id)
            .await
            .map_err(|e| e.to_string())?;
        let port = DiscordMembers {
            http: Arc::clone(&ctx.http),
            guild,
        };
        let others = port
            .roster(crate::id(old))
            .await?
            .members
            .iter()
            .any(|member| {
                member.id != crate::id(user.get()) && member.roles.contains(&crate::id(old))
            });
        if !others && let Err(error) = ctx.http.delete_role(guild, id).await {
            tracing::warn!(?error, "could not delete an unused color role");
        }
    }
    let role = if let Some(role) = existing {
        Id::new(role)
    } else {
        {
            let color = u32::from_str_radix(code, 16).map_err(|e| e.to_string())?;
            let reason = format!("/color demandé par {user}");
            let created = ctx
                .http
                .create_role(guild)
                .name(&name)
                .color(color)
                .reason(&reason)
                .await
                .map_err(|e| e.to_string())?
                .model()
                .await
                .map_err(|e| e.to_string())?;
            // Rangé à la place du rôle repère : juste sous lui, avec les autres couleurs.
            if let Some(anchor) = ctx.app.instance.discord.color_role_id
                && let Some(position) = roles
                    .iter()
                    .find(|role| role.id == anchor)
                    .map(|role| role.position)
            {
                let positions = [RolePosition {
                    id: created.id,
                    position: u64::try_from(position).unwrap_or(0),
                }];
                if let Err(error) = ctx.http.update_role_positions(guild, &positions).await {
                    tracing::warn!(?error, "could not place a color role");
                }
            }
            created.id
        }
    };
    ctx.http
        .add_guild_member_role(guild, user, role)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}
