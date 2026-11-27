//! `/edit message` : réécrit la question d'un post du forum des sondages (`;` pour aller à la
//! ligne), par son auteur ou un administrateur, puis la renumérote. Textes de la v1.

use twilight_interactions::command::{CommandInputData, CommandModel, CreateCommand};
use twilight_model::{
    application::interaction::{Interaction, application_command::CommandData},
    guild::Permissions,
    id::Id,
};

use crate::{
    Ctx,
    interactions::{Edit, Reply},
    polls::number_own,
    ui,
};

const FAILED: &str = "❌ Impossible de modifier ce sondage.";
const NOT_A_POLL: &str = "❌ Cette commande ne s'utilise que dans un post de sondage.";
const NOT_THE_AUTHOR: &str = "❌ Seul l'auteur du sondage peut le modifier.";

#[derive(Debug, CommandModel, CreateCommand)]
#[command(name = "edit", desc = "Modifie la question du sondage")]
pub struct EditCommand {
    /// nouveau message
    #[command(desc = "nouveau message (séparer avec ; pour faire des retour à la ligne)")]
    pub message: String,
}

pub fn run(ctx: &Ctx, interaction: &Interaction, data: &CommandData) -> Reply {
    let (Ok(command), Some(user), Some(channel)) = (
        EditCommand::from_interaction(CommandInputData::from(data.clone())),
        interaction.author_id(),
        interaction.channel.as_ref().map(|channel| channel.id),
    ) else {
        return ui::ephemeral_text(FAILED).into();
    };
    let admin = interaction
        .member
        .as_ref()
        .and_then(|member| member.permissions)
        .is_some_and(|permissions| permissions.contains(Permissions::ADMINISTRATOR));
    let ctx = ctx.clone();
    Reply::later(true, async move {
        // Le post se relit : l'interaction ne dit pas toujours son forum ni son auteur.
        let post = ctx.http.channel(channel).await?.model().await?;
        let poll_forum = ctx.app.instance.discord.poll_channel_id;
        if poll_forum.is_none() || post.parent_id.map(Id::get) != poll_forum {
            return Ok(Edit::Text(NOT_A_POLL.to_owned()));
        }
        if post.owner_id != Some(user) && !admin {
            return Ok(Edit::Text(NOT_THE_AUTHOR.to_owned()));
        }
        let text = command.message.replace(';', "\n");
        // Le message d'ouverture d'un post porte l'identifiant du fil.
        Ok(
            match number_own(&ctx, channel, channel.cast(), &text, true).await {
                Ok(()) => Edit::Text("Ça y est chef !".to_owned()),
                Err(error) => {
                    tracing::warn!(%error, "could not edit a poll");
                    Edit::Text(FAILED.to_owned())
                }
            },
        )
    })
}
