//! `/poll question [option1…10]` : un post dans le forum des sondages, numéroté à sa création
//! (`polls::on_thread_create`). Textes de la v1.

use pcr_core::polls;
use twilight_interactions::command::{CommandInputData, CommandModel, CreateCommand};
use twilight_model::application::interaction::{Interaction, application_command::CommandData};

use crate::{
    Ctx,
    bets::render::clip,
    interactions::{Edit, Reply},
    ui,
};

const FAILED: &str = "❌ Impossible de créer le sondage.";

#[derive(Debug, CommandModel, CreateCommand)]
#[command(name = "poll", desc = "Créer un sondage dans le channel #Sondage")]
pub struct PollCommand {
    /// message à envoyer
    #[command(desc = "message à envoyer")]
    pub question: String,
    #[command(desc = "intitulé de l'option 1 (Ajoutez l'emoji en début d'option)")]
    pub option1: Option<String>,
    #[command(desc = "intitulé de l'option 2 (Ajoutez l'emoji en début d'option)")]
    pub option2: Option<String>,
    #[command(desc = "intitulé de l'option 3 (Ajoutez l'emoji en début d'option)")]
    pub option3: Option<String>,
    #[command(desc = "intitulé de l'option 4 (Ajoutez l'emoji en début d'option)")]
    pub option4: Option<String>,
    #[command(desc = "intitulé de l'option 5 (Ajoutez l'emoji en début d'option)")]
    pub option5: Option<String>,
    #[command(desc = "intitulé de l'option 6 (Ajoutez l'emoji en début d'option)")]
    pub option6: Option<String>,
    #[command(desc = "intitulé de l'option 7 (Ajoutez l'emoji en début d'option)")]
    pub option7: Option<String>,
    #[command(desc = "intitulé de l'option 8 (Ajoutez l'emoji en début d'option)")]
    pub option8: Option<String>,
    #[command(desc = "intitulé de l'option 9 (Ajoutez l'emoji en début d'option)")]
    pub option9: Option<String>,
    #[command(desc = "intitulé de l'option 10 (Ajoutez l'emoji en début d'option)")]
    pub option10: Option<String>,
}

pub fn run(ctx: &Ctx, interaction: &Interaction, data: &CommandData) -> Reply {
    let (Ok(command), Some(user), Some(forum)) = (
        PollCommand::from_interaction(CommandInputData::from(data.clone())),
        interaction.author_id(),
        ctx.app
            .instance
            .discord
            .poll_channel_id
            .and_then(twilight_model::id::Id::new_checked),
    ) else {
        return ui::ephemeral_text(FAILED).into();
    };
    let options: Vec<String> = [
        command.option1,
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
    .filter(|option| !option.trim().is_empty())
    .collect();
    // Discord refuse un post vide.
    if options.is_empty() {
        return ui::ephemeral_text(polls::NO_OPTIONS).into();
    }
    let ctx = ctx.clone();
    Reply::later(true, async move {
        let name = clip(&command.question, polls::THREAD_NAME_MAX);
        let content = options.join("\n");
        let mentions = ui::relayed();
        let created = ctx
            .http
            .create_forum_thread(forum, &name)
            .message()
            .content(&content)
            .allowed_mentions(Some(&mentions))
            .await;
        let thread = match created {
            Ok(response) => response.model().await?.channel,
            Err(error) => {
                tracing::warn!(?error, "could not create a poll");
                return Ok(Edit::Text(FAILED.to_owned()));
            }
        };
        if let Err(error) = ctx.http.add_thread_member(thread.id, user).await {
            tracing::warn!(?error, "could not add the author to the poll");
        }
        if command.question.chars().count() > polls::THREAD_NAME_MAX {
            let text = format!("La question était trop longue : \n{}", command.question);
            if let Err(error) = ctx
                .http
                .create_message(thread.id)
                .content(&clip(&text, 2000))
                .allowed_mentions(Some(&mentions))
                .await
            {
                tracing::warn!(?error, "could not post the full poll question");
            }
        }
        Ok(Edit::Text("Sondage créé".to_owned()))
    })
}
