//! `/mesrappels liste|supprimer` : ses rappels à venir, en privé. Textes de la v1.

use pcr_app::outbox::Reminder;
use twilight_interactions::command::{CommandInputData, CommandModel, CreateCommand};
use twilight_model::{
    application::interaction::{Interaction, application_command::CommandData},
    channel::message::Component,
};
use twilight_util::builder::message::{ContainerBuilder, TextDisplayBuilder};

use crate::{
    Ctx,
    bets::render::clip,
    id,
    interactions::{Edit, Reply},
    reminders::{failure, full, relative},
    ui,
};

const FAILED: &str = "❌ Une erreur est survenue.";
const BLURPLE: u32 = 0x58_65_f2;
const RED: u32 = 0xff_00_00;
/// Place laissée à la liste dans le panneau (Discord en accepte 4 000 caractères).
const LIST_MAX: usize = 3_500;

#[derive(Debug, CommandModel, CreateCommand)]
#[command(name = "mesrappels", desc = "Voir et gérer tes rappels")]
pub enum MesrappelsCommand {
    #[command(name = "liste")]
    Liste(ListeCommand),
    #[command(name = "supprimer")]
    Supprimer(SupprimerCommand),
}

#[derive(Debug, CommandModel, CreateCommand)]
#[command(name = "liste", desc = "Voir la liste de tes rappels actifs")]
pub struct ListeCommand;

#[derive(Debug, CommandModel, CreateCommand)]
#[command(name = "supprimer", desc = "Supprimer un rappel")]
pub struct SupprimerCommand {
    /// ID du rappel à supprimer
    #[command(desc = "ID du rappel à supprimer")]
    pub id: i64,
}

pub fn run(ctx: &Ctx, interaction: &Interaction, data: &CommandData) -> Reply {
    let (Ok(command), Some(user)) = (
        MesrappelsCommand::from_interaction(CommandInputData::from(data.clone())),
        interaction.author_id(),
    ) else {
        return ui::ephemeral_text(FAILED).into();
    };
    let app = ctx.app.clone();
    let user = id(user.get());
    Reply::later(true, async move {
        Ok(match command {
            MesrappelsCommand::Liste(_) => match pcr_app::reminders::pending(&app, user).await {
                Ok(list) if list.is_empty() => {
                    Edit::Text("📭 Tu n'as aucun rappel actif.".to_owned())
                }
                Ok(list) => Edit::Panel(list_panel(&list)),
                Err(error) => {
                    tracing::error!(?error, "listing reminders failed");
                    Edit::Text(FAILED.to_owned())
                }
            },
            MesrappelsCommand::Supprimer(command) => {
                match pcr_app::reminders::delete(&app, user, command.id).await {
                    Ok(deleted) => Edit::Panel(deleted_panel(&deleted)),
                    Err(error) => failure(error, FAILED),
                }
            }
        })
    })
}

fn list_panel(list: &[Reminder]) -> Vec<Component> {
    let entries: Vec<String> = list
        .iter()
        .map(|reminder| {
            format!(
                "**🔔 Rappel #{}**\n**Message:** {}\n**Quand:** {}\n**Date:** {}",
                reminder.id,
                reminder.message,
                relative(reminder.trigger_at),
                full(reminder.trigger_at)
            )
        })
        .collect();
    vec![
        ContainerBuilder::new()
            .accent_color(Some(BLURPLE))
            .component(
                TextDisplayBuilder::new(format!(
                    "### 📋 Tes rappels ({})\nVoici la liste de tes rappels actifs",
                    list.len()
                ))
                .build(),
            )
            .component(TextDisplayBuilder::new(clip(&entries.join("\n\n"), LIST_MAX)).build())
            .component(
                TextDisplayBuilder::new(
                    "-# Utilise /mesrappels supprimer <id> pour supprimer un rappel",
                )
                .build(),
            )
            .build()
            .into(),
    ]
}

fn deleted_panel(reminder: &Reminder) -> Vec<Component> {
    vec![
        ContainerBuilder::new()
            .accent_color(Some(RED))
            .component(
                TextDisplayBuilder::new(format!(
                    "### 🗑️ Rappel supprimé\nLe rappel #{} a été supprimé avec succès.\n\
                     **📝 Message**\n{}",
                    reminder.id, reminder.message
                ))
                .build(),
            )
            .build()
            .into(),
    ]
}
