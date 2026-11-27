//! `/safe-place message` : un message anonyme dans la safe place. Il n'appelle personne, et l'usage
//! de la commande n'est pas journalisé avec son auteur. Textes de la v1.

use twilight_interactions::command::{CommandInputData, CommandModel, CreateCommand};
use twilight_model::{
    application::interaction::application_command::CommandData, channel::message::AllowedMentions,
    id::Id,
};

use crate::{
    Ctx,
    interactions::{Edit, Reply},
    ui,
};

const FAILED: &str = "❌ Impossible d'envoyer le message anonyme.";

#[derive(Debug, CommandModel, CreateCommand)]
#[command(
    name = "safe-place",
    desc = "Envoie un message anonymement dans la safe place"
)]
pub struct SafePlaceCommand {
    /// message à envoyer
    #[command(desc = "message à envoyer", max_length = 1800)]
    pub message: String,
}

pub fn run(ctx: &Ctx, data: &CommandData) -> Reply {
    let (Ok(command), Some(channel)) = (
        SafePlaceCommand::from_interaction(CommandInputData::from(data.clone())),
        ctx.app
            .instance
            .discord
            .safe_place_channel_id
            .and_then(Id::new_checked),
    ) else {
        return ui::ephemeral_text(FAILED).into();
    };
    let ctx = ctx.clone();
    Reply::later(true, async move {
        let text = format!(
            "Ce message a été envoyé anonymement en utilisant la commande /safe-place : \n{}",
            command.message
        );
        let nobody = AllowedMentions::default();
        Ok(Edit::Text(
            match ctx
                .http
                .create_message(channel)
                .content(&text)
                .allowed_mentions(Some(&nobody))
                .await
            {
                Ok(response) => {
                    let posted = response.model().await?;
                    format!(
                        "Message envoyé https://discord.com/channels/{}/{}/{}",
                        ctx.guild_id, channel, posted.id
                    )
                }
                Err(error) => {
                    tracing::warn!(?error, "could not post to the safe place");
                    FAILED.to_owned()
                }
            },
        ))
    })
}
