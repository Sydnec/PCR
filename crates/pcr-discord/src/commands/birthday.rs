//! `/birthday add|list|remove` : sa date d'anniversaire, et les prochaines fêtes du serveur (en
//! public). Textes de la v1.

use pcr_app::birthdays::Upcoming;
use pcr_core::birthdays as rules;
use twilight_interactions::command::{CommandInputData, CommandModel, CreateCommand};
use twilight_model::{
    application::interaction::{Interaction, application_command::CommandData},
    channel::message::Component,
};
use twilight_util::builder::message::{ContainerBuilder, TextDisplayBuilder};

use crate::{
    Ctx, id,
    interactions::{Edit, Reply},
    members::display_name,
    reminders::failure,
    ui,
};

const FAILED: &str = "❌ Une erreur est survenue, réessaie plus tard.";
const GOLD: u32 = 0xff_d7_00;

#[derive(Debug, CommandModel, CreateCommand)]
#[command(name = "birthday", desc = "Gère ta date d'anniversaire")]
pub enum BirthdayCommand {
    #[command(name = "add")]
    Add(AddCommand),
    #[command(name = "list")]
    List(ListCommand),
    #[command(name = "remove")]
    Remove(RemoveCommand),
}

#[derive(Debug, CommandModel, CreateCommand)]
#[command(name = "add", desc = "Enregistre (ou modifie) ta date d'anniversaire")]
pub struct AddCommand {
    /// Ton anniversaire
    #[command(desc = "Ton anniversaire : JJ/MM ou JJ/MM/AAAA si tu donnes ton âge")]
    pub date: String,
}

#[derive(Debug, CommandModel, CreateCommand)]
#[command(
    name = "list",
    desc = "Affiche les 10 prochains anniversaires du serveur"
)]
pub struct ListCommand;

#[derive(Debug, CommandModel, CreateCommand)]
#[command(name = "remove", desc = "Supprime ta date d'anniversaire")]
pub struct RemoveCommand;

pub async fn run(ctx: &Ctx, interaction: &Interaction, data: &CommandData) -> Reply {
    let (Ok(command), Some(user)) = (
        BirthdayCommand::from_interaction(CommandInputData::from(data.clone())),
        interaction.author_id(),
    ) else {
        return ui::ephemeral_text(FAILED).into();
    };
    let ctx = ctx.clone();
    let user = id(user.get());
    match command {
        BirthdayCommand::Add(add) => Reply::later(true, async move {
            Ok(
                match pcr_app::birthdays::set(&ctx.app, user, &add.date).await {
                    Ok(birthday) => Edit::Text(rules::saved(birthday)),
                    Err(error) => failure(error, FAILED),
                },
            )
        }),
        BirthdayCommand::Remove(_) => Reply::later(true, async move {
            Ok(Edit::Text(
                match pcr_app::birthdays::remove(&ctx.app, user).await {
                    Ok(true) => rules::REMOVED.to_owned(),
                    Ok(false) => rules::NOTHING_TO_REMOVE.to_owned(),
                    Err(error) => {
                        tracing::error!(?error, "removing a birthday failed");
                        FAILED.to_owned()
                    }
                },
            ))
        }),
        // La liste se lit d'abord (une lecture rapide) : vide ou illisible, la réponse reste privée ;
        // sinon la réponse publique est différée, le temps de lire un pseudo par fête sur Discord.
        BirthdayCommand::List(_) => {
            let list = match pcr_app::birthdays::upcoming(&ctx.app).await {
                Ok(list) if list.is_empty() => return ui::ephemeral_text(rules::NONE_YET).into(),
                Ok(list) => list,
                Err(error) => {
                    tracing::error!(?error, "listing birthdays failed");
                    return ui::ephemeral_text(FAILED).into();
                }
            };
            Reply::later(false, async move {
                let mut lines = Vec::with_capacity(list.len());
                for entry in &list {
                    lines.push(line(&ctx, entry).await);
                }
                Ok(Edit::Panel(panel(&lines)))
            })
        }
    }
}

/// « **24/07** — Pseudo (28 ans) — dans 3 jours (<t:…:d>) » ; l'âge n'est donné que si l'année
/// est connue.
async fn line(ctx: &Ctx, entry: &Upcoming) -> String {
    let name = display_name(&ctx.http, ctx.guild_id, entry.user)
        .await
        .unwrap_or_else(|| format!("<@{}>", entry.user));
    let age = entry
        .age
        .map(|age| format!(" ({age} ans)"))
        .unwrap_or_default();
    let when = match entry.days {
        0 => "🎉 **aujourd'hui**".to_owned(),
        1 => "dans 1 jour".to_owned(),
        days => format!("dans {days} jours"),
    };
    format!(
        "**{}** — {name}{age} — {when} (<t:{}:d>)",
        rules::format(entry.birthday),
        entry.next_at
    )
}

fn panel(lines: &[String]) -> Vec<Component> {
    vec![
        ContainerBuilder::new()
            .accent_color(Some(GOLD))
            .component(
                TextDisplayBuilder::new(format!(
                    "### 🎂 Prochains anniversaires\n{}",
                    lines.join("\n")
                ))
                .build(),
            )
            .build()
            .into(),
    ]
}
