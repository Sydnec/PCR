//! `/admin item <cible> <objet> [quantite]` : donne, ou retire avec une quantité négative, un objet à
//! un dresseur ou à tous les porteurs d'un rôle. Elle sert à tester les effets, à dédommager à la main
//! et à offrir un lot à tout le serveur pour un événement. Textes de la v1.

use std::fmt::Write as _;

use pcr_app::{
    error::UseCaseError,
    members::{self, MembersPort as _, Wanted},
    pokemon::items::{self as bag, Moved},
};
use pcr_core::{
    format::{number, signed},
    pokemon::{bag as rules, items},
};
use twilight_interactions::command::{CommandModel, CreateCommand, ResolvedMentionable};
use twilight_model::application::command::{CommandOptionChoice, CommandOptionChoiceValue};

use crate::{
    Ctx,
    interactions::{Edit, Reply},
    members::DiscordMembers,
};

const FAILED: &str = "❌ Erreur pendant `/admin item`, voir les logs.";
/// Les propositions d'une autocomplétion, au plus (limite Discord).
const MAX_CHOICES: usize = 25;

#[derive(Debug, CommandModel, CreateCommand)]
#[command(
    name = "item",
    desc = "Donne (ou retire) un objet à un dresseur ou à tout un rôle"
)]
pub struct ItemCommand {
    #[command(desc = "Un dresseur, ou un rôle pour servir tous ceux qui le portent")]
    pub cible: ResolvedMentionable,
    #[command(desc = "L'objet à donner ou retirer", autocomplete = true)]
    pub objet: String,
    #[command(desc = "Positif pour donner, négatif pour retirer (1 par défaut)")]
    pub quantite: Option<i64>,
}

/// Différé : servir un rôle demande la liste complète des membres.
pub fn run(ctx: &Ctx, command: ItemCommand, admin: u64) -> Reply {
    let ctx = ctx.clone();
    Reply::later(true, async move {
        Ok(Edit::Text(give(&ctx, command, admin).await))
    })
}

fn id(id: u64) -> i64 {
    i64::try_from(id).unwrap_or(i64::MAX)
}

async fn give(ctx: &Ctx, command: ItemCommand, admin: u64) -> String {
    let quantity = command.quantite.unwrap_or(1);
    let config = ctx.app.game_config();
    let key = command.objet.trim();
    let what = items::get(&config.pokemon, key)
        .map(|item| format!("{} **{}**", item.emoji, item.label))
        .unwrap_or_default();
    match command.cible {
        ResolvedMentionable::User(user) => {
            let name = user.resolved.name;
            match bag::admin_user(&ctx.app, admin, id(user.resolved.id.get()), key, quantity).await
            {
                Ok(Moved::Done { before, after }) => {
                    tracing::info!(admin, quantity, key, user = %name, before, after, "/admin item");
                    format!(
                        "✅ **{}** {what} pour **{name}**.\nIl en a maintenant **{}**.",
                        signed(quantity),
                        number(after)
                    )
                }
                Ok(Moved::Short { held }) => match items::get(&config.pokemon, key) {
                    Some(item) => rules::not_enough(&name, held, &item, -quantity),
                    None => FAILED.to_owned(),
                },
                Err(error) => failure(error),
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
                    tracing::error!(%error, "listing members for /admin item failed");
                    return FAILED.to_owned();
                }
            };
            let guild = id(ctx.app.instance.discord.guild_id);
            let found = match members::role_members(&roster, role_id, guild, Wanted::Chosen) {
                Ok(found) => found,
                Err(refusal) => return format!("❌ {refusal}"),
            };
            match bag::admin_members(&ctx.app, admin, &found.members, key, quantity).await {
                Ok(moved) => {
                    tracing::info!(admin, quantity, key, served = moved.served, short = moved.short, role = %found.role_name, "/admin item on a role");
                    let mut text = format!(
                        "✅ **{}** {what} pour **{}** membre(s) du rôle **{}**.",
                        signed(quantity),
                        number(moved.served),
                        found.role_name
                    );
                    if moved.short > 0 {
                        let (verb, pronoun) = if moved.short > 1 {
                            ("avaient", "leur")
                        } else {
                            ("avait", "lui")
                        };
                        let _ = write!(
                            text,
                            "\n⚠️ **{}** n'en {verb} pas **{}** : rien ne {pronoun} a été retiré.",
                            number(moved.short),
                            number(-quantity)
                        );
                    }
                    text
                }
                Err(error) => failure(error),
            }
        }
    }
}

fn failure(error: UseCaseError) -> String {
    match error {
        UseCaseError::Refused(refusal) => refusal.text().to_owned(),
        UseCaseError::Db(error) => {
            tracing::error!(?error, "/admin item failed");
            FAILED.to_owned()
        }
    }
}

/// Les objets du catalogue dont la clé ou le nom contient la saisie.
pub fn choices(ctx: &Ctx, typed: &str) -> Vec<CommandOptionChoice> {
    let config = ctx.app.game_config();
    let needle = typed.to_lowercase();
    items::all(&config.pokemon)
        .filter(|item| {
            item.key.to_lowercase().contains(&needle) || item.label.to_lowercase().contains(&needle)
        })
        .take(MAX_CHOICES)
        .map(|item| CommandOptionChoice {
            name: format!("{} {}", item.emoji, item.label),
            name_localizations: None,
            value: CommandOptionChoiceValue::String(item.key.to_owned()),
        })
        .collect()
}
