//! `/admin points <cible> <montant>` : crédite, ou débite sans plancher, un dresseur ou tous les
//! porteurs d'un rôle (`@everyone` pour tout le serveur, bots exclus). Textes de la v1.

use pcr_app::{
    members::{self, MembersPort as _, Wanted},
    points::PointsError,
};
use pcr_core::format::{number, signed};
use twilight_interactions::command::{CommandModel, CreateCommand, ResolvedMentionable};

use crate::{
    Ctx,
    interactions::{Edit, Reply},
    members::DiscordMembers,
};

const FAILED: &str = "❌ Erreur pendant `/admin points`, voir les logs.";

#[derive(Debug, CommandModel, CreateCommand)]
#[command(
    name = "points",
    desc = "Donne (ou retire) des points à un dresseur ou à tout un rôle"
)]
pub struct PointsCommand {
    #[command(desc = "Un dresseur, ou un rôle pour servir tous ceux qui le portent")]
    pub cible: ResolvedMentionable,
    #[command(desc = "Positif pour donner, négatif pour retirer")]
    pub montant: i64,
}

/// Différé : servir un rôle demande la liste complète des membres.
pub fn run(ctx: &Ctx, command: PointsCommand, admin: u64) -> Reply {
    let ctx = ctx.clone();
    Reply::later(true, async move {
        Ok(Edit::Text(grant(&ctx, command, admin).await))
    })
}

fn id(id: u64) -> i64 {
    i64::try_from(id).unwrap_or(i64::MAX)
}

async fn grant(ctx: &Ctx, command: PointsCommand, admin: u64) -> String {
    let amount = command.montant;
    if let Err(refusal) = pcr_core::points::check_admin_amount(amount) {
        return format!("❌ {refusal}");
    }
    match command.cible {
        ResolvedMentionable::User(user) => {
            let name = user.resolved.name;
            match pcr_app::points::grant_user(&ctx.app, id(user.resolved.id.get()), amount).await {
                Ok(granted) => {
                    tracing::info!(admin, amount, user = %name, before = granted.before, after = granted.after, "/admin points");
                    let warning = if granted.after < 0 {
                        " ⚠️ négatif, ses achats sont bloqués jusqu'à ce qu'il remonte."
                    } else {
                        ""
                    };
                    format!(
                        "✅ **{}** points pour **{name}**.\nSolde : **{}** → **{}**{warning}",
                        signed(amount),
                        number(granted.before),
                        number(granted.after)
                    )
                }
                Err(error) => failure(&error),
            }
        }
        ResolvedMentionable::Role(role) => {
            let port = DiscordMembers {
                http: ctx.http.clone(),
                guild: twilight_model::id::Id::new(ctx.app.instance.discord.guild_id),
            };
            let role_id = id(role.id.get());
            let roster = match port.roster(role_id).await {
                Ok(roster) => roster,
                Err(error) => {
                    tracing::error!(%error, "listing members for /admin points failed");
                    return FAILED.to_owned();
                }
            };
            let guild = id(ctx.app.instance.discord.guild_id);
            let found = match members::role_members(&roster, role_id, guild, Wanted::Chosen) {
                Ok(found) => found,
                Err(refusal) => return format!("❌ {refusal}"),
            };
            match pcr_app::points::grant_members(&ctx.app, &found.members, amount).await {
                Ok(done) => {
                    tracing::info!(admin, amount, done, role = %found.role_name, "/admin points on a role");
                    format!(
                        "✅ **{}** points pour **{done}** membre(s) du rôle **{}**.\n\
                         Total distribué : **{}** points.",
                        signed(amount),
                        found.role_name,
                        signed(amount.saturating_mul(done))
                    )
                }
                Err(error) => failure(&error),
            }
        }
    }
}

fn failure(error: &PointsError) -> String {
    match error {
        PointsError::Refused(refusal) => format!("❌ {refusal}"),
        PointsError::Db(error) => {
            tracing::error!(?error, "/admin points failed");
            FAILED.to_owned()
        }
    }
}
