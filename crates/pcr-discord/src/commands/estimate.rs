//! `/estimate question` : un pari d'estimation (le plus proche gagne). Sa réponse est le message
//! public du pari (`bets::post`).

use twilight_interactions::command::{CommandInputData, CommandModel, CreateCommand};
use twilight_model::application::interaction::{Interaction, application_command::CommandData};

use crate::{Ctx, bets, interactions::Reply, ui};

#[derive(Debug, CommandModel, CreateCommand)]
#[command(
    name = "estimate",
    desc = "Créer un nouveau pari d'estimation (Le plus proche gagne)"
)]
pub struct EstimateCommand {
    // Le titre de l'embed v1 (« Nouveau Pari d'Estimation #N: » et la question) ne dépassait pas
    // 256 caractères sans faire échouer la commande : la limite reste celle-là.
    #[command(desc = "La question du pari", max_length = 200)]
    pub question: String,
}

pub async fn run(ctx: &Ctx, interaction: &Interaction, data: &CommandData) -> Reply {
    let (Ok(command), Some(creator)) = (
        EstimateCommand::from_interaction(CommandInputData::from(data.clone())),
        interaction.author_id(),
    ) else {
        return ui::ephemeral_text("Erreur création pari.").into();
    };
    let creator = i64::try_from(creator.get()).unwrap_or(i64::MAX);
    let created = pcr_app::bets::create_estimate(&ctx.app, creator, &command.question).await;
    bets::post(ctx, interaction, created).await
}
