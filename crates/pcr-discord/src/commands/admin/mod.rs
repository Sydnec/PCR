//! `/admin` : l'administration du bot, une sous-commande par action.
//!
//! Discord masque la commande aux non-administrateurs (`default_permissions`). C'est du confort, pas
//! une sécurité : un serveur peut rouvrir la permission. La garde `is_admin` fait foi, et vaut pour
//! l'exécution comme pour l'autocomplétion, qui énumère la configuration vivante.

mod config;

use twilight_interactions::command::{CommandInputData, CommandModel, CreateCommand};
use twilight_model::{
    application::{
        command::CommandOptionChoice,
        interaction::{Interaction, application_command::CommandData},
    },
    guild::Permissions,
    http::interaction::InteractionResponse,
};

use crate::{Ctx, ui};

const NOT_ADMIN: &str = "❌ Cette commande est réservée aux administrateurs.";

#[derive(Debug, CommandModel, CreateCommand)]
#[command(
    name = "admin",
    desc = "Administration du bot",
    default_permissions = "administrators"
)]
pub enum AdminCommand {
    #[command(name = "config")]
    Config(config::ConfigCommand),
    #[command(name = "config-voir")]
    ConfigVoir(config::ConfigVoirCommand),
}

fn administrators() -> Permissions {
    Permissions::ADMINISTRATOR
}

fn is_admin(interaction: &Interaction) -> bool {
    // Hors d'un serveur, pas de membre : refuser plutôt que supposer.
    interaction
        .member
        .as_ref()
        .and_then(|member| member.permissions)
        .is_some_and(|permissions| permissions.contains(Permissions::ADMINISTRATOR))
}

pub async fn run(ctx: &Ctx, interaction: &Interaction, data: &CommandData) -> InteractionResponse {
    if !is_admin(interaction) {
        return ui::ephemeral_text(NOT_ADMIN);
    }
    let Some(admin) = interaction.author_id() else {
        return ui::ephemeral_text(NOT_ADMIN);
    };
    match AdminCommand::from_interaction(CommandInputData::from(data.clone())) {
        Ok(AdminCommand::Config(command)) => config::set(ctx, command, admin.get()).await,
        Ok(AdminCommand::ConfigVoir(command)) => config::view(ctx, &command),
        // Ne peut arriver qu'entre deux versions : une sous-commande que ce binaire ne connaît pas.
        Err(error) => {
            let name = data
                .options
                .first()
                .map_or("", |option| option.name.as_str());
            tracing::warn!(?error, name, "unknown /admin subcommand");
            ui::ephemeral_text(format!(
                "❌ `{name}` est introuvable. Le bot n'est peut-être pas à jour."
            ))
        }
    }
}

/// Les propositions d'autocomplétion : aucune pour qui n'est pas administrateur.
pub fn autocomplete(
    ctx: &Ctx,
    interaction: &Interaction,
    data: &CommandData,
) -> Vec<CommandOptionChoice> {
    if !is_admin(interaction) {
        return Vec::new();
    }
    match focused(data) {
        Some((subcommand, "cle", typed))
            if subcommand == "config" || subcommand == "config-voir" =>
        {
            config::choices(ctx, typed)
        }
        _ => Vec::new(),
    }
}

/// La sous-commande, l'option en cours de saisie et ce qui y est tapé.
fn focused(data: &CommandData) -> Option<(&str, &str, &str)> {
    use twilight_model::application::interaction::application_command::CommandOptionValue;
    let subcommand = data.options.first()?;
    let CommandOptionValue::SubCommand(options) = &subcommand.value else {
        return None;
    };
    options.iter().find_map(|option| match &option.value {
        CommandOptionValue::Focused(typed, _) => Some((
            subcommand.name.as_str(),
            option.name.as_str(),
            typed.as_str(),
        )),
        _ => None,
    })
}
