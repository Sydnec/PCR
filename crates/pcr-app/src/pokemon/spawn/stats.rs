//! Les apparitions dans les statistiques de l'année : naissances, fuites, records d'acharnement et
//! moments notables. Écrites après le commit : une statistique qui échoue ne défait jamais une
//! apparition, elle est seulement journalisée.

use jiff::Timestamp;
use pcr_core::{clock::paris_date, pokemon::species};

use super::{Born, Fled};
use crate::{
    App,
    stats::{Counter, DailyColumn, Highlight, HighlightKind, SpeciesColumn, UserColumn},
};

/// Au-delà de ce nombre de balls encaissées, une apparition entre dans les moments notables de
/// l'année (seuil de la v1).
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

/// Une fuite dans les statistiques : l'espèce s'est échappée, les records d'acharnement de ses
/// participants, et un moment notable si elle a encaissé beaucoup de balls. Une statistique qui
/// échoue ne défait jamais la fuite : elle est seulement journalisée.
pub(super) async fn record_flight(app: &App, now: Timestamp, fled: &Fled) {
    let spawn = &fled.spawn;
    app.stats.add(
        now,
        Counter::PokemonSpecies {
            species: spawn.species_id,
            column: SpeciesColumn::Escapes,
        },
        1,
    );
    let mut by_user: Vec<(i64, i64)> = Vec::new();
    for spent in &fled.spent {
        match by_user.iter_mut().find(|(user, _)| *user == spent.user_id) {
            Some((_, throws)) => *throws += spent.throws,
            None => by_user.push((spent.user_id, spent.throws)),
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
                species: spawn.species_id,
                column: SpeciesColumn::MaxThrowsSingleSpawn,
            },
            best,
        );
    }
    let throws: i64 = fled.spent.iter().map(|spent| spent.throws).sum();
    if throws < CONTESTED_THROWS {
        return;
    }
    let cost: i64 = fled.spent.iter().map(|spent| spent.cost).sum();
    let name = u16::try_from(spawn.species_id)
        .ok()
        .and_then(species::get)
        .map_or("?", |species| species.name);
    let highlight = Highlight {
        kind: HighlightKind::CostlyEscape,
        user: None,
        species: Some(spawn.species_id),
        is_shiny: spawn.is_shiny,
        value: Some(throws),
        detail: Some(format!(
            "{name} s'est enfui après {throws} balls ({cost} pts gaspillés)"
        )),
        created_at: now.as_millisecond(),
    };
    if let Err(error) = app.stats.highlight(now, &highlight).await {
        tracing::warn!(?error, "recording a pokemon highlight failed");
    }
}
