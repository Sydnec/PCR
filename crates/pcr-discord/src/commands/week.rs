//! `/week question [jour] [date_debut] [date_fin]` : un sondage d'un jour par ligne, posté dans le
//! salon de la commande et numéroté. Textes de la v1.

use pcr_core::polls;
use twilight_interactions::command::{
    CommandInputData, CommandModel, CommandOption, CreateCommand, CreateOption,
};
use twilight_model::application::interaction::{Interaction, application_command::CommandData};

use crate::{
    Ctx,
    bets::render::clip,
    interactions::{Edit, Reply},
    polls::number_own,
    ui,
};

const FAILED: &str = "❌ Impossible de créer le sondage.";

#[derive(Debug, Clone, Copy, CommandOption, CreateOption)]
pub enum Day {
    #[option(name = "Lundi", value = "lundi")]
    Lundi,
    #[option(name = "Mardi", value = "mardi")]
    Mardi,
    #[option(name = "Mercredi", value = "mercredi")]
    Mercredi,
    #[option(name = "Jeudi", value = "jeudi")]
    Jeudi,
    #[option(name = "Vendredi", value = "vendredi")]
    Vendredi,
    #[option(name = "Samedi", value = "samedi")]
    Samedi,
    #[option(name = "Dimanche", value = "dimanche")]
    Dimanche,
}

impl Day {
    /// Du lundi (0) au dimanche (6).
    fn index(self) -> i8 {
        match self {
            Self::Lundi => 0,
            Self::Mardi => 1,
            Self::Mercredi => 2,
            Self::Jeudi => 3,
            Self::Vendredi => 4,
            Self::Samedi => 5,
            Self::Dimanche => 6,
        }
    }
}

#[derive(Debug, CommandModel, CreateCommand)]
#[command(
    name = "week",
    desc = "Créer un sondage contenant les jours d'une période"
)]
pub struct WeekCommand {
    /// Que proposes-tu cette semaine ?
    #[command(desc = "Que proposes-tu cette semaine ?")]
    pub question: String,
    #[command(desc = "Jour de la semaine pour commencer (prochaine occurrence)")]
    pub jour: Option<Day>,
    #[command(desc = "Date de début (format: JJ/MM ou JJ/MM/AAAA)")]
    pub date_debut: Option<String>,
    #[command(desc = "Date de fin (format: JJ/MM ou JJ/MM/AAAA)")]
    pub date_fin: Option<String>,
}

pub fn run(ctx: &Ctx, interaction: &Interaction, data: &CommandData) -> Reply {
    let (Ok(command), Some(channel)) = (
        WeekCommand::from_interaction(CommandInputData::from(data.clone())),
        interaction.channel.as_ref().map(|channel| channel.id),
    ) else {
        return ui::ephemeral_text(FAILED).into();
    };
    let period = polls::period(
        ctx.app.clock.today(),
        command.jour.map(Day::index),
        command.date_debut.as_deref(),
        command.date_fin.as_deref(),
        ctx.app.game_config().week.max_days,
    );
    let (first, last) = match period {
        Ok(period) => period,
        Err(refusal) => return ui::ephemeral_text(refusal.text()).into(),
    };
    let text = clip(&polls::week_poll(&command.question, first, last), 2000);
    let ctx = ctx.clone();
    Reply::later(true, async move {
        let mentions = ui::relayed();
        let posted = match ctx
            .http
            .create_message(channel)
            .content(&text)
            .allowed_mentions(Some(&mentions))
            .await
        {
            Ok(response) => response.model().await?,
            Err(error) => {
                tracing::warn!(?error, "could not post a week poll");
                return Ok(Edit::Text(FAILED.to_owned()));
            }
        };
        if let Err(error) = number_own(&ctx, channel, posted.id, &posted.content).await {
            tracing::warn!(%error, "could not number a week poll");
        }
        Ok(Edit::Text("Sondage créé ✅".to_owned()))
    })
}
