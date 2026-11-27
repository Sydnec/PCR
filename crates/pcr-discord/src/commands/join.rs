//! `/join` : rejoindre le fil où l'on tape la commande. Textes de la v1.

use twilight_interactions::command::{CommandModel, CreateCommand};
use twilight_model::{application::interaction::Interaction, channel::ChannelType};

use crate::{
    Ctx,
    interactions::{Edit, Reply},
    ui,
};

#[derive(Debug, CommandModel, CreateCommand)]
#[command(name = "join", desc = "Rejoindre le fil de discussion actuel")]
pub struct JoinCommand;

pub fn run(ctx: &Ctx, interaction: &Interaction) -> Reply {
    let thread = interaction.channel.as_ref().filter(|channel| {
        matches!(
            channel.kind,
            ChannelType::PublicThread
                | ChannelType::PrivateThread
                | ChannelType::AnnouncementThread
        )
    });
    let (Some(thread), Some(user)) = (thread, interaction.author_id()) else {
        return ui::ephemeral_text(
            "❌ Cette commande ne peut être utilisée que dans un fil de discussion.",
        )
        .into();
    };
    let (http, thread) = (ctx.http.clone(), thread.id);
    Reply::later(true, async move {
        // Discord accepte d'ajouter un membre déjà là sans rien dire : la v1 voulait le signaler.
        if http.thread_member(thread, user).await.is_ok() {
            return Ok(Edit::Text("✅ Tu es déjà membre de ce fil !".to_owned()));
        }
        Ok(Edit::Text(
            match http.add_thread_member(thread, user).await {
                Ok(_) => "👀".to_owned(),
                Err(error) => {
                    tracing::warn!(?error, "could not add a member to a thread");
                    "❌ Une erreur est survenue lors de l'ajout au fil.".to_owned()
                }
            },
        ))
    })
}
