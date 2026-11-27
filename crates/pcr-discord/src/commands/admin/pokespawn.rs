//! `/admin pokespawn [espece] [shiny] [annonce] [ping]` : une apparition pour un événement. Textes de
//! la v1.

use pcr_app::{error::UseCaseError, pokemon::spawn};
use pcr_core::pokemon::{species, weights::Draw};
use twilight_interactions::command::{CommandModel, CreateCommand};
use twilight_model::application::command::{CommandOptionChoice, CommandOptionChoiceValue};

use crate::{
    Ctx,
    interactions::{Edit, Reply},
};

/// Les propositions d'une autocomplétion, au plus (limite Discord).
const MAX_CHOICES: usize = 25;
const FAILED: &str = "❌ Une erreur est survenue, réessaie dans un instant.";

#[derive(Debug, CommandModel, CreateCommand)]
#[command(
    name = "pokespawn",
    desc = "Déclenche l'apparition d'un Pokémon (événements)"
)]
pub struct PokespawnCommand {
    #[command(
        desc = "Espèce à faire apparaître (aléatoire si absent)",
        autocomplete = true
    )]
    pub espece: Option<String>,
    #[command(desc = "Forcer la version shiny")]
    pub shiny: Option<bool>,
    /// Un message en composants v2 tient en 4 000 caractères : l'annonce doit y laisser sa place.
    #[command(
        desc = "Texte affiché en tête de l'embed (ex : 🎃 Événement d'Halloween !)",
        max_length = 1000
    )]
    pub annonce: Option<String>,
    #[command(desc = "Forcer ou supprimer la mention du rôle Dresseur")]
    pub ping: Option<bool>,
}

pub fn run(ctx: &Ctx, command: PokespawnCommand, admin: u64) -> Reply {
    let app = ctx.app.clone();
    // L'autocomplétion envoie un numéro ; une saisie libre qui n'en est pas un ne désigne aucune
    // espèce, et le refus le dit.
    let species = command
        .espece
        .as_deref()
        .map(|typed| typed.trim().parse::<u16>().unwrap_or(0));
    let request = spawn::Request {
        species,
        shiny: command.shiny,
        announcement: command.annonce.filter(|text| !text.trim().is_empty()),
        ping: command.ping,
    };
    Reply::later(true, async move {
        Ok(Edit::Text(match spawn::force(&app, &request).await {
            Ok(born) => {
                tracing::info!(
                    admin,
                    species = born.encounter.species.name,
                    "spawn forced by /admin pokespawn"
                );
                let name = request
                    .species
                    .map_or("espèce aléatoire", |_| born.encounter.species.name);
                let shiny = if request.shiny == Some(true) {
                    " (shiny)"
                } else {
                    ""
                };
                format!("✅ Spawn déclenché : **{name}**{shiny}.")
            }
            Err(UseCaseError::Refused(refusal)) => refusal.text().to_owned(),
            Err(UseCaseError::Db(error)) => {
                tracing::error!(?error, "forcing a spawn failed");
                FAILED.to_owned()
            }
        }))
    })
}

/// Les espèces dont le nom contient la saisie. Un événement donne volontairement accès aux espèces
/// hors pool (légendaires, évolutions par échange ou par objet) : elles sont marquées comme telles.
pub fn choices(ctx: &Ctx, typed: &str) -> Vec<CommandOptionChoice> {
    let config = ctx.app.game_config();
    let generation = pcr_app::pokemon::generation(&ctx.app);
    let draw = Draw::new(&config.pokemon, generation);
    species::search(typed, generation)
        .take(MAX_CHOICES)
        .map(|species| {
            let outside = species.trade_evolution || draw.is_item_only(species);
            CommandOptionChoice {
                name: format!(
                    "{} {}{}{}",
                    pcr_core::pokemon::display::dex_number(species),
                    species.name,
                    if outside { " (hors pool)" } else { "" },
                    if species.is_legendary() { " ⭐" } else { "" }
                ),
                name_localizations: None,
                value: CommandOptionChoiceValue::String(species.id.to_string()),
            }
        })
        .collect()
}
