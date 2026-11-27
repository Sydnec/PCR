//! `/rappel date [message]` : un rappel en MP, et une réponse publique dont le bouton permet aux
//! autres de s'y ajouter. Un refus se dit en privé, avant la réponse publique.

use twilight_interactions::command::{CommandInputData, CommandModel, CreateCommand};
use twilight_model::application::interaction::{Interaction, application_command::CommandData};

use crate::{
    Ctx, id,
    interactions::{Edit, Reply},
    reminders::{FAILED, created_panel, failure},
    ui,
};

#[derive(Debug, CommandModel, CreateCommand)]
#[command(name = "rappel", desc = "Créer un rappel qui te sera envoyé en DM")]
pub struct RappelCommand {
    /// Date et heure du rappel
    #[command(desc = "Date et heure du rappel (format: JJ/MM/AAAA HH:MM ou JJ/MM HH:MM)")]
    pub date: String,
    /// Le message du rappel
    #[command(desc = "Le message du rappel (optionnel)", max_length = 500)]
    pub message: Option<String>,
}

pub fn run(ctx: &Ctx, interaction: &Interaction, data: &CommandData) -> Reply {
    let (Ok(command), Some(user)) = (
        RappelCommand::from_interaction(CommandInputData::from(data.clone())),
        interaction.author_id(),
    ) else {
        return ui::ephemeral_text(FAILED).into();
    };
    if let Err(error) = pcr_app::reminders::validate(&ctx.app, &command.date) {
        return match failure(error, FAILED) {
            Edit::Text(text) => ui::ephemeral_text(text).into(),
            Edit::Panel(panel) => ui::ephemeral_panel(panel).into(),
        };
    }
    let app = ctx.app.clone();
    let user = id(user.get());
    let channel = interaction
        .channel
        .as_ref()
        .map_or(0, |channel| id(channel.id.get()));
    Reply::later(false, async move {
        Ok(
            match pcr_app::reminders::create(
                &app,
                user,
                channel,
                &command.date,
                command.message.as_deref(),
            )
            .await
            {
                Ok(created) => Edit::Panel(created_panel(&created, user, true)),
                Err(error) => failure(error, FAILED),
            },
        )
    })
}
