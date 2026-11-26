//! Route chaque interaction vers son handler et répond toujours, même en cas d'échec.

use std::{future::Future, pin::Pin};

use pcr_app::stats::Counter;
use twilight_model::{
    application::{
        command::CommandType,
        interaction::{
            Interaction, InteractionData, InteractionType,
            application_command::{CommandData, CommandOptionValue},
        },
    },
    channel::message::{AllowedMentions, Component, MessageFlags},
    http::interaction::{InteractionResponse, InteractionResponseData, InteractionResponseType},
};

use crate::{
    Ctx,
    commands::{admin, classement, solde, version},
    ui,
};

const GENERIC_ERROR: &str = "Une erreur est survenue, réessaie dans un instant.";
const EXPIRED: &str = "Ce panneau a expiré, relance la commande.";

pub type Work = Pin<Box<dyn Future<Output = anyhow::Result<Edit>> + Send>>;

/// La réponse d'un handler.
pub enum Reply {
    /// Tout de suite.
    Now(Box<InteractionResponse>),
    /// Différée : Discord affiche « réfléchit… » le temps du travail (au-delà de 3 s, une réponse
    /// immédiate serait refusée), puis le résultat remplace l'attente.
    Later { ephemeral: bool, work: Work },
}

impl From<InteractionResponse> for Reply {
    fn from(response: InteractionResponse) -> Self {
        Self::Now(Box::new(response))
    }
}

impl Reply {
    pub fn later(
        ephemeral: bool,
        work: impl Future<Output = anyhow::Result<Edit>> + Send + 'static,
    ) -> Self {
        Self::Later {
            ephemeral,
            work: Box::pin(work),
        }
    }
}

/// Ce qui remplace une réponse différée : un texte simple, ou un panneau en composants v2.
#[derive(Debug)]
pub enum Edit {
    Text(String),
    Panel(Vec<Component>),
}

pub async fn handle(ctx: Ctx, interaction: Interaction) {
    count_command(&ctx, &interaction);
    let reply = match route(&ctx, &interaction).await {
        Ok(reply) => reply,
        Err(error) => {
            tracing::error!(?error, kind = ?interaction.kind, "interaction failed");
            ui::ephemeral_text(GENERIC_ERROR).into()
        }
    };
    let client = ctx.http.interaction(ctx.application_id);
    match reply {
        Reply::Now(response) => {
            if let Err(error) = client
                .create_response(interaction.id, &interaction.token, &response)
                .await
            {
                tracing::warn!(?error, "could not answer interaction");
            }
        }
        Reply::Later { ephemeral, work } => {
            let flags = if ephemeral {
                MessageFlags::EPHEMERAL
            } else {
                MessageFlags::empty()
            };
            let defer = InteractionResponse {
                kind: InteractionResponseType::DeferredChannelMessageWithSource,
                data: Some(InteractionResponseData {
                    flags: Some(flags),
                    ..InteractionResponseData::default()
                }),
            };
            if let Err(error) = client
                .create_response(interaction.id, &interaction.token, &defer)
                .await
            {
                tracing::warn!(?error, "could not defer interaction");
                return;
            }
            let edit = work.await.unwrap_or_else(|error| {
                tracing::error!(?error, kind = ?interaction.kind, "deferred interaction failed");
                Edit::Text(GENERIC_ERROR.to_owned())
            });
            // Personne n'est notifié par une réponse : un classement ou un récapitulatif cite des
            // membres sans les appeler.
            let silent = AllowedMentions::default();
            let request = client
                .update_response(&interaction.token)
                .allowed_mentions(Some(&silent));
            let sent = match &edit {
                Edit::Text(text) => request.content(Some(text)).await,
                Edit::Panel(components) => {
                    request
                        .components(Some(components))
                        .flags(MessageFlags::IS_COMPONENTS_V2)
                        .await
                }
            };
            if let Err(error) = sent {
                tracing::warn!(?error, "could not complete deferred interaction");
            }
        }
    }
}

/// Chaque commande tapée compte dans les stats de l'année ; une sous-commande à part (« admin
/// points »), sans quoi l'administration se confondrait en une ligne.
fn count_command(ctx: &Ctx, interaction: &Interaction) {
    if interaction.kind != InteractionType::ApplicationCommand {
        return;
    }
    let Some(InteractionData::ApplicationCommand(command)) = &interaction.data else {
        return;
    };
    if command.kind != CommandType::ChatInput {
        return;
    }
    ctx.app.stats.add(
        ctx.app.clock.now(),
        Counter::Command {
            name: command_label(command),
        },
        1,
    );
}

fn command_label(command: &CommandData) -> String {
    match command.options.first() {
        Some(option) if matches!(option.value, CommandOptionValue::SubCommand(_)) => {
            format!("{} {}", command.name, option.name)
        }
        _ => command.name.clone(),
    }
}

async fn route(ctx: &Ctx, interaction: &Interaction) -> anyhow::Result<Reply> {
    // L'autocomplétion arrive avec les données d'une commande : c'est le type qui la distingue.
    if interaction.kind == InteractionType::ApplicationCommandAutocomplete {
        let choices = match &interaction.data {
            Some(InteractionData::ApplicationCommand(command)) if command.name == "admin" => {
                admin::autocomplete(ctx, interaction, command)
            }
            _ => Vec::new(),
        };
        return Ok(ui::autocomplete(choices).into());
    }
    Ok(match &interaction.data {
        Some(InteractionData::ApplicationCommand(command)) => match command.name.as_str() {
            "admin" => admin::run(ctx, interaction, command).await,
            "classement" => classement::run(ctx),
            "solde" => solde::run(ctx, interaction, command).await,
            "version" => ui::ephemeral_panel(version::panel(ctx).await).into(),
            name => {
                tracing::warn!(name, "unknown command");
                ui::ephemeral_text(EXPIRED).into()
            }
        },
        Some(InteractionData::MessageComponent(component)) => match component.custom_id.as_str() {
            version::REFRESH => ui::update_panel(version::panel(ctx).await).into(),
            // Un id inconnu vient d'un panneau d'une version précédente : le dire plutôt qu'échouer.
            _ => ui::ephemeral_text(EXPIRED).into(),
        },
        _ => ui::ephemeral_text(EXPIRED).into(),
    })
}
