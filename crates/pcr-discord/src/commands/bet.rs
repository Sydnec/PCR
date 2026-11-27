//! `/bet question option1 option2 [option3…5]` : un pari classique. Sa réponse est le message public
//! du pari (`bets::post`).

use twilight_interactions::command::{CommandInputData, CommandModel, CreateCommand};
use twilight_model::application::interaction::{Interaction, application_command::CommandData};

use crate::{Ctx, bets, interactions::Reply, ui};

#[derive(Debug, CommandModel, CreateCommand)]
#[command(name = "bet", desc = "Créer un nouveau pari")]
pub struct BetCommand {
    // Le titre de l'embed v1 (« Nouveau Pari d'Estimation #N: » et la question) ne dépassait pas
    // 256 caractères sans faire échouer la commande : la limite reste celle-là.
    #[command(desc = "La question du pari", max_length = 200)]
    pub question: String,
    // Un libellé d'option tient sur son bouton (80 caractères avec « 5. ») : la v1 échouait au-delà.
    #[command(desc = "Option 1", max_length = 76)]
    pub option1: String,
    #[command(desc = "Option 2", max_length = 76)]
    pub option2: String,
    #[command(desc = "Option 3", max_length = 76)]
    pub option3: Option<String>,
    #[command(desc = "Option 4", max_length = 76)]
    pub option4: Option<String>,
    #[command(desc = "Option 5", max_length = 76)]
    pub option5: Option<String>,
}

pub async fn run(ctx: &Ctx, interaction: &Interaction, data: &CommandData) -> Reply {
    let (Ok(command), Some(creator)) = (
        BetCommand::from_interaction(CommandInputData::from(data.clone())),
        interaction.author_id(),
    ) else {
        return ui::ephemeral_text("Erreur création pari.").into();
    };
    let options: Vec<String> = [
        Some(command.option1),
        Some(command.option2),
        command.option3,
        command.option4,
        command.option5,
    ]
    .into_iter()
    .flatten()
    .filter(|option| !option.trim().is_empty())
    .collect();
    let creator = i64::try_from(creator.get()).unwrap_or(i64::MAX);
    let created = pcr_app::bets::create(&ctx.app, creator, &command.question, &options).await;
    bets::post(ctx, interaction, created).await
}
