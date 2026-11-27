//! `/randomizabaise` : un ship tiré parmi les membres, en public, retenu dans les stats de l'année.
//! Texte de la v1. La réponse est différée puis remplacée : comme en v1, personne n'est appelé.

use std::sync::Arc;

use pcr_app::error::UseCaseError;
use pcr_core::randomizabaise::message;
use twilight_interactions::command::{CommandModel, CreateCommand};
use twilight_model::application::interaction::Interaction;

use crate::{
    Ctx,
    interactions::{Edit, Reply},
    members::DiscordMembers,
};

const FAILED: &str = "Une erreur est survenue, réessaie dans un instant.";

#[derive(Debug, CommandModel, CreateCommand)]
#[command(
    name = "randomizabaise",
    desc = "Depuis le temps que vous l'attendiez celle là"
)]
pub struct RandomizabaiseCommand;

pub fn run(ctx: &Ctx, interaction: &Interaction) -> Reply {
    let ctx = ctx.clone();
    let token = interaction.token.clone();
    Reply::later(false, async move {
        let port = DiscordMembers {
            http: Arc::clone(&ctx.http),
            guild: ctx.guild_id,
        };
        let ship =
            match pcr_app::randomizabaise::draw(&ctx.app, &port, &mut pcr_app::App::rng()).await {
                Ok(ship) => ship,
                Err(Ok(UseCaseError::Refused(refusal))) => {
                    return Ok(Edit::Text(format!("❌ {refusal}")));
                }
                Err(Ok(UseCaseError::Db(error))) => {
                    tracing::error!(?error, "randomizabaise failed");
                    return Ok(Edit::Text(FAILED.to_owned()));
                }
                Err(Err(error)) => {
                    tracing::warn!(%error, "members unavailable for randomizabaise");
                    return Ok(Edit::Text(FAILED.to_owned()));
                }
            };
        // La réponse différée est déjà un message : son identifiant est celui que les réactions
        // désigneront.
        match ctx
            .http
            .interaction(ctx.application_id)
            .response(&token)
            .await
        {
            Ok(response) => match response.model().await {
                Ok(posted) => {
                    let id = crate::id(posted.id.get());
                    if let Err(error) = pcr_app::randomizabaise::record(&ctx.app, id, &ship).await {
                        tracing::error!(?error, "recording a ship failed");
                    }
                }
                Err(error) => tracing::warn!(?error, "could not read the ship message"),
            },
            Err(error) => tracing::warn!(?error, "could not fetch the ship message"),
        }
        Ok(Edit::Text(message(&ship)))
    })
}
