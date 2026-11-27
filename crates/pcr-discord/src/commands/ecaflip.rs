//! `/ecaflip option1 [option2…10]` : pile ou face, en public. Une seule option est une question
//! (« Oui » ou « Non »), plusieurs un tirage (`pcr_core::ecaflip`).

use twilight_interactions::command::{CommandInputData, CommandModel, CreateCommand};
use twilight_model::application::interaction::application_command::CommandData;
use twilight_util::builder::interaction_response::ChannelMessageBuilder;

use crate::{interactions::Reply, ui};

#[derive(Debug, CommandModel, CreateCommand)]
#[command(name = "ecaflip", desc = "Pile ou Face ?")]
pub struct EcaflipCommand {
    #[command(desc = "Option 1 ou question à répondre par Oui ou Non")]
    pub option1: String,
    #[command(desc = "Option 2")]
    pub option2: Option<String>,
    #[command(desc = "Option 3")]
    pub option3: Option<String>,
    #[command(desc = "Option 4")]
    pub option4: Option<String>,
    #[command(desc = "Option 5")]
    pub option5: Option<String>,
    #[command(desc = "Option 6")]
    pub option6: Option<String>,
    #[command(desc = "Option 7")]
    pub option7: Option<String>,
    #[command(desc = "Option 8")]
    pub option8: Option<String>,
    #[command(desc = "Option 9")]
    pub option9: Option<String>,
    #[command(desc = "Option 10")]
    pub option10: Option<String>,
}

pub fn run(data: &CommandData) -> Reply {
    let Ok(command) = EcaflipCommand::from_interaction(CommandInputData::from(data.clone())) else {
        return ui::ephemeral_text("Une erreur est survenue, réessaie dans un instant.").into();
    };
    let options: Vec<String> = [
        Some(command.option1),
        command.option2,
        command.option3,
        command.option4,
        command.option5,
        command.option6,
        command.option7,
        command.option8,
        command.option9,
        command.option10,
    ]
    .into_iter()
    .flatten()
    .collect();
    let answer = pcr_core::ecaflip::flip(&options, &mut pcr_app::App::rng());
    ChannelMessageBuilder::new()
        .content(answer)
        .allowed_mentions(ui::relayed())
        .build()
        .into()
}
