//! `/help` : la liste des commandes et de leur description, en privé. Texte de la v1.

use twilight_interactions::command::{CommandModel, CreateCommand};

use crate::{bets::render::clip, interactions::Reply, ui};

#[derive(Debug, CommandModel, CreateCommand)]
#[command(
    name = "help",
    desc = "Fourni la liste des commandes disponibles avec ce bot"
)]
pub struct HelpCommand;

pub fn run() -> Reply {
    let lines: Vec<String> = super::all()
        .iter()
        .map(|command| format!("• **/{}**: {}", command.name, command.description))
        .collect();
    ui::ephemeral_text(clip(
        &format!(
            "Voici la liste des commandes disponibles:\n{}",
            lines.join("\n")
        ),
        pcr_core::links::MESSAGE_MAX,
    ))
    .into()
}
