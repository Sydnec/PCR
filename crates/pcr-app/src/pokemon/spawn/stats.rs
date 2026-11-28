//! Les apparitions dans les statistiques de l'année : naissances, fuites, records d'acharnement et
//! moments notables. Écrites après le commit : une statistique qui échoue ne défait jamais une
//! apparition, elle est seulement journalisée.

use jiff::Timestamp;
use pcr_core::{
    clock::paris_date,
    pokemon::species::{self, Species},
};

use pcr_db::pokemon::spawn::{Spawn, Spent};

use super::Born;
use crate::{
    App,
    stats::{Counter, DailyColumn, Highlight, HighlightKind, SpeciesColumn, UserColumn},
};

/// Au-delà de ce nombre de balls encaissées, une apparition entre dans les moments notables de
/// l'année. Le seuil de la v1, qui ne se réglait pas : c'est un repère du récap annuel, pas une règle
/// du jeu (ni prix, ni taux, ni durée), d'où une constante plutôt qu'un réglage.
const CONTESTED_THROWS: i64 = 10;

pub(super) fn record_birth(app: &App, now: Timestamp, born: &Born) {
    let species = i64::from(born.encounter.species.id);
    let add = |counter| app.stats.add(now, counter, 1);
    add(Counter::PokemonSpecies {
        species,
        column: SpeciesColumn::Spawns,
    });
    if born.encounter.shiny.shiny {
        add(Counter::PokemonSpecies {
            species,
            column: SpeciesColumn::ShinySpawns,
        });
    }
    add(Counter::PokemonDaily {
        day: paris_date(now).to_string(),
        column: DailyColumn::Spawns,
    });
}

/// Le vainqueur d'une apparition, pour les statistiques de sa fin.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Winner {
    pub user: i64,
    pub ball_label: String,
    pub probability: f64,
    /// Shiny pour lui (Charme Chroma compris).
    pub shiny: bool,
}

/// La fin d'une apparition dans les statistiques : capturée (`winner`) ou enfuie, les records
/// d'acharnement de ses participants (y compris ceux qui ont vidé leur solde sans rien attraper, qui
/// font les meilleures histoires), et les moments notables. Une statistique qui échoue ne défait
/// jamais l'apparition : elle est seulement journalisée.
pub(crate) async fn record_end(
    app: &App,
    now: Timestamp,
    spawn: &Spawn,
    spent: &[Spent],
    winner: Option<&Winner>,
) {
    let species_id = spawn.species_id;
    let species = u16::try_from(species_id).ok().and_then(species::get);
    let name = species.map_or("?", |species| species.name);
    let add = |counter, delta| app.stats.add(now, counter, delta);
    let species_counter = |column| Counter::PokemonSpecies {
        species: species_id,
        column,
    };
    let mut highlights = Vec::new();
    match winner {
        None => add(species_counter(SpeciesColumn::Escapes), 1),
        Some(winner) => {
            let legendary = species.is_some_and(Species::is_legendary);
            add(species_counter(SpeciesColumn::Catches), 1);
            add(
                Counter::PokemonDaily {
                    day: paris_date(now).to_string(),
                    column: DailyColumn::Catches,
                },
                1,
            );
            let user_counter = |column| Counter::PokemonUser {
                user: winner.user,
                column,
            };
            add(user_counter(UserColumn::Catches), 1);
            if winner.shiny {
                add(species_counter(SpeciesColumn::ShinyCatches), 1);
                add(user_counter(UserColumn::ShinyCatches), 1);
                highlights.push((
                    HighlightKind::Shiny,
                    format!("{name} shiny capturé avec une {}", winner.ball_label),
                ));
            }
            if legendary {
                add(user_counter(UserColumn::LegendaryCatches), 1);
                highlights.push((
                    HighlightKind::Legendary,
                    format!("{name} capturé avec une {}", winner.ball_label),
                ));
            }
            let delay = now.as_millisecond() - spawn.spawned_at;
            if let Err(error) = app
                .stats
                .personal_bests(now, winner.user, winner.probability, species_id, delay)
                .await
            {
                tracing::warn!(?error, "recording personal bests failed");
            }
        }
    }
    record_participants(app, now, species_id, spent);
    let throws: i64 = spent.iter().map(|row| row.throws).sum();
    if throws >= CONTESTED_THROWS {
        let cost: i64 = spent.iter().map(|row| row.cost).sum();
        highlights.push(match winner {
            Some(_) => (
                HighlightKind::SpawnDispute,
                format!("{name} a encaissé {throws} balls ({cost} pts) avant de céder"),
            ),
            None => (
                HighlightKind::CostlyEscape,
                format!("{name} s'est enfui après {throws} balls ({cost} pts gaspillés)"),
            ),
        });
    }
    for (kind, detail) in highlights {
        let value = matches!(
            kind,
            HighlightKind::SpawnDispute | HighlightKind::CostlyEscape
        )
        .then_some(throws);
        let highlight = Highlight {
            kind,
            user: winner.map(|winner| winner.user),
            species: Some(species_id),
            is_shiny: winner.map_or(spawn.is_shiny, |winner| winner.shiny),
            value,
            detail: Some(detail),
            created_at: now.as_millisecond(),
        };
        if let Err(error) = app.stats.highlight(now, &highlight).await {
            tracing::warn!(?error, "recording a pokemon highlight failed");
        }
    }
}

/// Les records d'acharnement : les lancers de chacun sur cette apparition, et le plus grand nombre de
/// balls que son espèce ait encaissé.
fn record_participants(app: &App, now: Timestamp, species: i64, spent: &[Spent]) {
    let mut by_user: Vec<(i64, i64)> = Vec::new();
    for row in spent {
        match by_user.iter_mut().find(|(user, _)| *user == row.user_id) {
            Some((_, throws)) => *throws += row.throws,
            None => by_user.push((row.user_id, row.throws)),
        }
    }
    for (user, throws) in &by_user {
        app.stats.add(
            now,
            Counter::PokemonUser {
                user: *user,
                column: UserColumn::MostThrowsOnOneSpawn,
            },
            *throws,
        );
    }
    if let Some(best) = by_user.iter().map(|(_, throws)| *throws).max() {
        app.stats.add(
            now,
            Counter::PokemonSpecies {
                species,
                column: SpeciesColumn::MaxThrowsSingleSpawn,
            },
            best,
        );
    }
}
