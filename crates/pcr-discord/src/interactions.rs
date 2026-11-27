//! Route chaque interaction vers son handler et répond toujours, même en cas d'échec.

use std::{future::Future, pin::Pin};

use pcr_app::stats::Counter;
use twilight_http::client::InteractionClient;
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
    Ctx, bets,
    commands::{
        admin, bet, betstats, birthday, classement, cotd, ecaflip, edit, estimate, join,
        mesrappels, poll, randomizabaise, rappel, safe_place, solde, version, week,
    },
    reminders, ui,
};

const GENERIC_ERROR: &str = "Une erreur est survenue, réessaie dans un instant.";
pub const EXPIRED: &str = "Ce panneau a expiré, relance la commande.";

pub type Work = Pin<Box<dyn Future<Output = anyhow::Result<Edit>> + Send>>;
/// La suite d'une réponse qui tient lieu de message public : elle reçoit l'identifiant du message
/// posté, ou `None` si la réponse a échoué.
pub type Then = Box<dyn FnOnce(Option<i64>) -> Pin<Box<dyn Future<Output = ()> + Send>> + Send>;

/// La réponse d'un handler.
pub enum Reply {
    /// Tout de suite.
    Now(Box<InteractionResponse>),
    /// Différée : Discord affiche « réfléchit… » le temps du travail (au-delà de 3 s, une réponse
    /// immédiate serait refusée), puis le résultat remplace l'attente. Vaut pour une commande, un
    /// bouton ou une modale envoyée : la réponse est un nouveau message.
    Later { ephemeral: bool, work: Work },
    /// Différée sur le message du composant (un menu) : le résultat remplace ce message, et ses
    /// composants disparaissent avec un texte. Jamais pour une modale ouverte depuis un message
    /// public : c'est lui qui serait remplacé.
    LaterUpdate { work: Work },
    /// Une réponse publique immédiate qui devient un message public (celui d'un pari) : immédiate,
    /// parce que la mention d'un rôle n'appelle personne dans une réponse différée puis modifiée.
    /// `then` enregistre ensuite le message.
    Posted {
        response: Box<InteractionResponse>,
        then: Then,
    },
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

    pub fn later_update(work: impl Future<Output = anyhow::Result<Edit>> + Send + 'static) -> Self {
        Self::LaterUpdate {
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
        Reply::Posted { response, then } => {
            let posted = match client
                .create_response(interaction.id, &interaction.token, &response)
                .await
            {
                Ok(_) => original_message(&client, &interaction.token).await,
                Err(error) => {
                    tracing::warn!(?error, "could not answer interaction");
                    None
                }
            };
            then(posted).await;
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
            complete(&client, &interaction, &defer, work, false).await;
        }
        Reply::LaterUpdate { work } => {
            let defer = InteractionResponse {
                kind: InteractionResponseType::DeferredUpdateMessage,
                data: None,
            };
            complete(&client, &interaction, &defer, work, true).await;
        }
    }
}

/// L'identifiant du message que la réponse vient de poster. Introuvable, le message ne sera pas
/// réécrit : `None` le fait reposter par le worker, un doublon valant mieux qu'un message figé.
async fn original_message(client: &InteractionClient<'_>, token: &str) -> Option<i64> {
    match client.response(token).await {
        Ok(response) => match response.model().await {
            Ok(message) => i64::try_from(message.id.get()).ok(),
            Err(error) => {
                tracing::warn!(?error, "could not read the posted interaction response");
                None
            }
        },
        Err(error) => {
            tracing::warn!(?error, "could not fetch the posted interaction response");
            None
        }
    }
}

/// Diffère, fait le travail, puis remplace la réponse (ou le message du composant, `update`).
async fn complete(
    client: &InteractionClient<'_>,
    interaction: &Interaction,
    defer: &InteractionResponse,
    work: Work,
    update: bool,
) {
    if let Err(error) = client
        .create_response(interaction.id, &interaction.token, defer)
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
        // Le menu qui a servi disparaît avec le texte qui le remplace.
        Edit::Text(text) if update => request.content(Some(text)).components(Some(&[])).await,
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
            "bet" => bet::run(ctx, interaction, command).await,
            "betstats" => betstats::run(ctx, interaction, command),
            "birthday" => birthday::run(ctx, interaction, command).await,
            "classement" => classement::run(ctx),
            "cotd" => cotd::run(ctx),
            "ecaflip" => ecaflip::run(command),
            "edit" => edit::run(ctx, interaction, command),
            "estimate" => estimate::run(ctx, interaction, command).await,
            "join" => join::run(ctx, interaction),
            "mesrappels" => mesrappels::run(ctx, interaction, command),
            "poll" => poll::run(ctx, interaction, command),
            "randomizabaise" => randomizabaise::run(ctx, interaction),
            "rappel" => rappel::run(ctx, interaction, command),
            "safe-place" => safe_place::run(ctx, command),
            "week" => week::run(ctx, interaction, command),
            "solde" => solde::run(ctx, interaction, command).await,
            "version" => ui::ephemeral_panel(version::panel(ctx).await).into(),
            name => {
                tracing::warn!(name, "unknown command");
                ui::ephemeral_text(EXPIRED).into()
            }
        },
        Some(InteractionData::MessageComponent(component)) => match component.custom_id.as_str() {
            version::REFRESH => ui::update_panel(version::panel(ctx).await).into(),
            id if id.starts_with(bets::PREFIX) => {
                bets::component(ctx, interaction, component).await
            }
            id if id.starts_with(reminders::PREFIX) => reminders::button(ctx, interaction, id),
            // Un id inconnu vient d'un panneau d'une version précédente : le dire plutôt qu'échouer.
            _ => ui::ephemeral_text(EXPIRED).into(),
        },
        Some(InteractionData::ModalSubmit(modal)) if modal.custom_id.starts_with(bets::PREFIX) => {
            bets::modal(ctx, interaction, modal)
        }
        _ => ui::ephemeral_text(EXPIRED).into(),
    })
}
