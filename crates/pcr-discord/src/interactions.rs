//! Route chaque interaction vers son handler et répond toujours, même en cas d'échec.

use twilight_model::{
    application::interaction::{Interaction, InteractionData, InteractionType},
    http::interaction::InteractionResponse,
};

use crate::{
    Ctx,
    commands::{admin, version},
    ui,
};

const GENERIC_ERROR: &str = "Une erreur est survenue, réessaie dans un instant.";
const EXPIRED: &str = "Ce panneau a expiré, relance la commande.";

pub async fn handle(ctx: Ctx, interaction: Interaction) {
    let response = match route(&ctx, &interaction).await {
        Ok(response) => response,
        Err(error) => {
            tracing::error!(?error, kind = ?interaction.kind, "interaction failed");
            ui::ephemeral_text(GENERIC_ERROR)
        }
    };
    if let Err(error) = ctx
        .http
        .interaction(ctx.application_id)
        .create_response(interaction.id, &interaction.token, &response)
        .await
    {
        tracing::warn!(?error, "could not answer interaction");
    }
}

async fn route(ctx: &Ctx, interaction: &Interaction) -> anyhow::Result<InteractionResponse> {
    // L'autocomplétion arrive avec les données d'une commande : c'est le type qui la distingue.
    if interaction.kind == InteractionType::ApplicationCommandAutocomplete {
        let choices = match &interaction.data {
            Some(InteractionData::ApplicationCommand(command)) if command.name == "admin" => {
                admin::autocomplete(ctx, interaction, command)
            }
            _ => Vec::new(),
        };
        return Ok(ui::autocomplete(choices));
    }
    Ok(match &interaction.data {
        Some(InteractionData::ApplicationCommand(command)) => match command.name.as_str() {
            "admin" => admin::run(ctx, interaction, command).await,
            "version" => ui::ephemeral_panel(version::panel(ctx).await),
            name => {
                tracing::warn!(name, "unknown command");
                ui::ephemeral_text(EXPIRED)
            }
        },
        Some(InteractionData::MessageComponent(component)) => match component.custom_id.as_str() {
            version::REFRESH => ui::update_panel(version::panel(ctx).await),
            // Un id inconnu vient d'un panneau d'une version précédente : le dire plutôt qu'échouer.
            _ => ui::ephemeral_text(EXPIRED),
        },
        _ => ui::ephemeral_text(EXPIRED),
    })
}
