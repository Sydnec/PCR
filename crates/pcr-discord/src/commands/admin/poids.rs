//! `/admin poids [table]` : les tables de tirage pondéré, converties en probabilités. Un poids ne se
//! lit pas : 400 ne veut rien dire tant qu'on ne connaît pas la somme des autres, et doubler un poids
//! ne double pas tout à fait son taux, puisqu'il grossit aussi le total. La commande fait la
//! conversion, pour qu'un réglage se décide sur le chiffre qu'on cherche. Textes de la v1.

use pcr_app::pokemon;
use pcr_core::pokemon::tables::WeightTable;
use twilight_interactions::command::{CommandModel, CommandOption, CreateCommand, CreateOption};
use twilight_model::channel::message::Component;
use twilight_util::builder::message::{ContainerBuilder, TextDisplayBuilder};

use crate::{
    Ctx,
    interactions::{Edit, Reply},
};

const BLURPLE: u32 = 0x58_65_f2;
const TITLE: &str = "### ⚖️ Tables de tirage pondéré";
const DESCRIPTION: &str = "Un poids n'est pas un pourcentage : c'est une part du total de sa table. \
    Doubler un poids ne double donc pas tout à fait son taux — il grossit aussi le total, et dilue \
    légèrement les autres lignes.";
const FOOTER: &str = "-# Tout se règle via /admin config, à chaud.";
/// Le texte d'un message en composants v2, tous blocs confondus.
const MESSAGE_MAX: usize = 4000;

#[derive(Debug, Clone, Copy, CommandOption, CreateOption)]
pub enum TableChoice {
    #[option(name = "Apparitions sauvages", value = "spawn")]
    Spawn,
    #[option(name = "Rencontres du parc safari", value = "safari")]
    Safari,
    #[option(name = "Butin des Pokémon", value = "butin")]
    Held,
    #[option(name = "Loterie quotidienne", value = "loterie")]
    Lottery,
}

impl TableChoice {
    fn key(self) -> &'static str {
        match self {
            Self::Spawn => "spawn",
            Self::Safari => "safari",
            Self::Held => "butin",
            Self::Lottery => "loterie",
        }
    }
}

#[derive(Debug, CommandModel, CreateCommand)]
#[command(
    name = "poids",
    desc = "Convertit les poids de tirage en probabilités réelles"
)]
pub struct PoidsCommand {
    #[command(desc = "Une seule table, au lieu de toutes")]
    pub table: Option<TableChoice>,
}

/// Différé : quatre tables peuvent demander plusieurs messages, que seules des suites permettent.
pub fn run(ctx: &Ctx, command: &PoidsCommand) -> Reply {
    let wanted = command.table.map(TableChoice::key);
    let tables: Vec<WeightTable> = pokemon::weight_tables(&ctx.app)
        .into_iter()
        .filter(|table| wanted.is_none_or(|key| table.key == key))
        .collect();
    let panels = panels(&tables);
    Reply::later(true, async move { Ok(Edit::Panels(panels)) })
}

/// Le titre et l'explication, en tête du premier message.
fn heading() -> String {
    format!("{TITLE}\n{DESCRIPTION}")
}

fn length(text: &str) -> usize {
    text.chars().count()
}

/// Les blocs d'une table : son nom, sa phrase, puis le tableau. Un tableau trop long pour un message
/// se poursuit dans un bloc « suite », en-tête répété.
fn blocks(table: &WeightTable) -> Vec<String> {
    let (head, body) = table.lines();
    let code = |lines: &[String]| format!("```\n{head}\n{}\n```", lines.join("\n"));
    // Un bloc tient toujours dans un message, même celui qui porte le titre et le pied de page.
    let budget = MESSAGE_MAX.saturating_sub(length(&heading()) + length(FOOTER));
    let mut blocks = Vec::new();
    let mut prefix = format!("**{}**\n{}\n", table.name, table.intro());
    let mut chunk: Vec<String> = Vec::new();
    for line in body {
        let mut grown = chunk.clone();
        grown.push(line.clone());
        if !chunk.is_empty() && length(&prefix) + length(&code(&grown)) > budget {
            blocks.push(prefix + &code(&chunk));
            prefix = format!("**{} (suite)**\n", table.name);
            grown = vec![line];
        }
        chunk = grown;
    }
    blocks.push(prefix + &code(&chunk));
    blocks
}

/// Les blocs répartis en messages : le premier porte le titre et l'explication, le dernier le pied
/// de page, et aucun ne dépasse ce que Discord accepte.
fn panels(tables: &[WeightTable]) -> Vec<Vec<Component>> {
    let mut messages: Vec<Vec<String>> = Vec::new();
    let mut current = vec![heading()];
    // Le pied de page est compté partout : on ne sait pas d'avance quel message sera le dernier.
    let mut size = length(&heading()) + length(FOOTER);
    for block in tables.iter().flat_map(blocks) {
        let cost = length(&block);
        if size + cost > MESSAGE_MAX && !current.is_empty() {
            messages.push(std::mem::take(&mut current));
            size = length(FOOTER);
        }
        current.push(block);
        size += cost;
    }
    current.push(FOOTER.to_owned());
    messages.push(current);
    messages
        .into_iter()
        .map(|texts| {
            let container = texts.into_iter().fold(
                ContainerBuilder::new().accent_color(Some(BLURPLE)),
                |container, text| container.component(TextDisplayBuilder::new(text).build()),
            );
            vec![container.build().into()]
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use pcr_core::{
        config::Pokemon,
        pokemon::{tables, weights::Draw},
    };
    use twilight_model::channel::message::Component;

    use super::*;

    fn text_length(panel: &[Component]) -> usize {
        let mut total = 0;
        for component in panel {
            if let Component::Container(container) = component {
                for inner in &container.components {
                    if let Component::TextDisplay(text) = inner {
                        total += text.content.chars().count();
                    }
                }
            }
        }
        total
    }

    /// Discord refuse un message de plus de 4 000 caractères : la table la plus longue doit se
    /// répartir, le titre en tête et le pied de page en dernier.
    #[test]
    fn every_message_fits_in_discord_limits() {
        let config = Pokemon::default();
        let all = tables::all(&Draw::new(&config, 2));
        let messages = panels(&all);
        assert!(messages.len() > 1);
        for panel in &messages {
            assert!(text_length(panel) <= MESSAGE_MAX, "{}", text_length(panel));
        }
        // Une table trop longue pour un seul message se poursuit dans un bloc « suite ».
        let mut long = all[0].clone();
        long.rows = (0..200).map(|_| long.rows[0].clone()).collect();
        let parts = blocks(&long);
        assert!(parts.len() > 1);
        assert!(parts[1].starts_with("**Apparitions sauvages (suite)**\n```"));
        assert!(
            panels(&[long])
                .iter()
                .all(|p| text_length(p) <= MESSAGE_MAX)
        );
    }
}
