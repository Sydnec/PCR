//! `/admin config` et `/admin config-voir` : modifier et lire les réglages de jeu. Textes de la v1.

use std::fmt::Write as _;

use pcr_app::config::SetError;
use pcr_core::config::{edit, render};
use serde_json::Value;
use twilight_interactions::command::{CommandModel, CreateCommand};
use twilight_model::{
    application::command::{CommandOptionChoice, CommandOptionChoiceValue},
    http::interaction::InteractionResponse,
};

use crate::{Ctx, ui};

/// Un message Discord plafonne à 2 000 caractères : la liste s'arrête avant.
const MAX_BODY: usize = 1800;
/// Discord n'accepte que 25 propositions, de 100 caractères au plus.
const MAX_CHOICES: usize = 25;
const MAX_CHOICE_NAME: usize = 100;

#[derive(Debug, CommandModel, CreateCommand)]
#[command(
    name = "config",
    desc = "Modifie un réglage du bot, appliqué immédiatement"
)]
pub struct ConfigCommand {
    #[command(desc = "Le réglage à modifier", autocomplete = true)]
    pub cle: String,
    #[command(desc = "La nouvelle valeur (liste : séparée par des virgules)")]
    pub valeur: String,
}

#[derive(Debug, CommandModel, CreateCommand)]
#[command(
    name = "config-voir",
    desc = "Affiche un réglage — ou une branche entière — et sa valeur par défaut"
)]
pub struct ConfigVoirCommand {
    #[command(
        desc = "Le réglage ou la branche (tout si absent)",
        autocomplete = true
    )]
    pub cle: Option<String>,
}

pub async fn set(ctx: &Ctx, command: ConfigCommand, admin: u64) -> InteractionResponse {
    match pcr_app::config::set(&ctx.app, &command.cle, &command.valeur, admin).await {
        Ok(change) => ui::ephemeral_text(format!(
            "✅ `{}`\n{} → {}\nAppliqué immédiatement : la config est relue à chaque usage.",
            change.path,
            render::format(&change.before),
            render::format(&change.after)
        )),
        Err(SetError::Refused(refusal)) => {
            ui::ephemeral_text(format!("❌ {refusal}{}", alert_line(ctx, "\n")))
        }
        Err(SetError::Db(error)) => {
            tracing::error!(?error, "/admin config failed");
            ui::ephemeral_text("❌ Erreur pendant `/admin config`, voir les logs.")
        }
    }
}

pub fn view(ctx: &Ctx, command: &ConfigVoirCommand) -> InteractionResponse {
    let snapshot = ctx.app.config.load();
    let alert = alert_line(ctx, "");
    let alert = if alert.is_empty() {
        alert
    } else {
        format!("{alert}\n\n")
    };
    let Some(key) = command.cle.as_deref().filter(|key| !key.is_empty()) else {
        return ui::ephemeral_text(alert + &list_branch(&snapshot.tree, ""));
    };
    let (path, default) = match edit::lookup(key) {
        Ok(found) => found,
        Err(refusal) => return ui::ephemeral_text(format!("{alert}❌ {refusal}")),
    };
    if default.is_object() {
        return ui::ephemeral_text(format!(
            "{alert}**`{path}`**\n{}",
            list_branch(&snapshot.tree, &path)
        ));
    }
    let current = edit::get(&snapshot.tree, &path).unwrap_or(&Value::Null);
    let last = if current == default {
        "*(c'est la valeur par défaut)*".to_owned()
    } else {
        format!("Défaut : {}", render::format(default))
    };
    ui::ephemeral_text(format!(
        "{alert}`{path}`\nActuel : {}\n{last}",
        render::format(current)
    ))
}

/// Chaque proposition montre la valeur courante : on choisit un réglage en voyant ce qu'on
/// s'apprête à remplacer.
pub fn choices(ctx: &Ctx, typed: &str) -> Vec<CommandOptionChoice> {
    let snapshot = ctx.app.config.load();
    let needle = typed.to_lowercase();
    edit::leaves(&snapshot.tree, "")
        .into_iter()
        .filter(|(path, _)| path.to_lowercase().contains(&needle))
        .take(MAX_CHOICES)
        .map(|(path, current)| {
            let name = format!(
                "{path} — {} ({})",
                render::preview(current),
                render::type_name(current)
            );
            let name = if name.chars().count() > MAX_CHOICE_NAME {
                name.chars().take(MAX_CHOICE_NAME - 3).collect::<String>() + "..."
            } else {
                name
            };
            CommandOptionChoice {
                name,
                name_localizations: None,
                value: CommandOptionChoiceValue::String(path),
            }
        })
        .collect()
}

/// Les feuilles sous `prefix`, tronquées pour tenir dans un message.
fn list_branch(tree: &Value, prefix: &str) -> String {
    let entries = edit::leaves(tree, prefix);
    let mut body = String::new();
    // Discord compte en caractères, pas en octets : les accents ne doivent pas couper plus tôt.
    let mut length = 0;
    let mut shown = 0;
    for (path, current) in &entries {
        let line = format!("`{path}` = {}", render::preview(current));
        let line_length = line.chars().count() + 1;
        if length + line_length > MAX_BODY {
            break;
        }
        body.push_str(&line);
        body.push('\n');
        length += line_length;
        shown += 1;
    }
    let rest = entries.len() - shown;
    if rest > 0 {
        let _ = write!(
            body,
            "\n*et {rest} autre(s) — précise une clé pour les voir.*"
        );
    }
    body
}

/// Des surcharges en base écartées font retomber leurs réglages sur les défauts sans un mot :
/// c'est ici qu'on viendrait constater qu'un réglage « n'a pas pris », c'est donc ici qu'on le dit.
fn alert_line(ctx: &Ctx, before: &str) -> String {
    let snapshot = ctx.app.config.load();
    if snapshot.rejected.is_empty() {
        return String::new();
    }
    let keys: Vec<String> = snapshot.rejected.iter().map(|k| format!("`{k}`")).collect();
    format!(
        "{before}⚠️ Réglages en base ignorés (réglage disparu ou valeur invalide) : {}. \
         Leurs valeurs par défaut s'appliquent.",
        keys.join(", ")
    )
}
