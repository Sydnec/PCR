//! Les statistiques Pokémon de l'année : compteurs par espèce, par jour et par dresseur, et moments
//! notables. Le jeu vit dans `pcr.db` ; ces tables ne gardent que l'année, le périmètre du récap.

use sqlx::SqliteConnection;

use super::Counter;
use crate::{DbError, StatsDb};

/// Une colonne de `pokemon_species_stats`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SpeciesColumn {
    Spawns,
    ShinySpawns,
    Escapes,
    /// Le plus de balls encaissées en une apparition : un record, pas une somme.
    MaxThrowsSingleSpawn,
}

/// Une colonne de `pokemon_daily_stats`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum DailyColumn {
    Spawns,
}

/// Une colonne de `pokemon_stats`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum UserColumn {
    /// Le plus de lancers d'un dresseur sur une même apparition : un record.
    MostThrowsOnOneSpawn,
}

/// Les compteurs Pokémon d'un lot. Un record ne descend jamais : il garde la plus grande valeur.
pub(super) async fn add(
    conn: &mut SqliteConnection,
    counter: &Counter,
    delta: i64,
) -> Result<(), DbError> {
    match counter {
        Counter::PokemonSpecies { species, column } => {
            species_stat(conn, *species, *column, delta).await
        }
        Counter::PokemonDaily {
            day,
            column: DailyColumn::Spawns,
        } => {
            sqlx::query!(
                "INSERT INTO pokemon_daily_stats (day, spawns) VALUES (?, MAX(?, 0))
                 ON CONFLICT (day) DO UPDATE SET spawns = MAX(spawns + ?, 0)",
                day,
                delta,
                delta
            )
            .execute(conn)
            .await?;
            Ok(())
        }
        Counter::PokemonUser {
            user,
            column: UserColumn::MostThrowsOnOneSpawn,
        } => {
            sqlx::query!(
                "INSERT INTO pokemon_stats (user_id, most_throws_on_one_spawn) VALUES (?, MAX(?, 0))
                 ON CONFLICT (user_id)
                 DO UPDATE SET most_throws_on_one_spawn = MAX(most_throws_on_one_spawn, ?)",
                user,
                delta,
                delta
            )
            .execute(conn)
            .await?;
            Ok(())
        }
        _ => Ok(()),
    }
}

async fn species_stat(
    conn: &mut SqliteConnection,
    species: i64,
    column: SpeciesColumn,
    delta: i64,
) -> Result<(), DbError> {
    match column {
        SpeciesColumn::Spawns => {
            sqlx::query!(
                "INSERT INTO pokemon_species_stats (species_id, spawns) VALUES (?, MAX(?, 0))
                 ON CONFLICT (species_id) DO UPDATE SET spawns = MAX(spawns + ?, 0)",
                species,
                delta,
                delta
            )
            .execute(conn)
            .await?;
        }
        SpeciesColumn::ShinySpawns => {
            sqlx::query!(
                "INSERT INTO pokemon_species_stats (species_id, shiny_spawns) VALUES (?, MAX(?, 0))
                 ON CONFLICT (species_id) DO UPDATE SET shiny_spawns = MAX(shiny_spawns + ?, 0)",
                species,
                delta,
                delta
            )
            .execute(conn)
            .await?;
        }
        SpeciesColumn::Escapes => {
            sqlx::query!(
                "INSERT INTO pokemon_species_stats (species_id, escapes) VALUES (?, MAX(?, 0))
                 ON CONFLICT (species_id) DO UPDATE SET escapes = MAX(escapes + ?, 0)",
                species,
                delta,
                delta
            )
            .execute(conn)
            .await?;
        }
        SpeciesColumn::MaxThrowsSingleSpawn => {
            sqlx::query!(
                "INSERT INTO pokemon_species_stats (species_id, max_throws_single_spawn)
                 VALUES (?, MAX(?, 0))
                 ON CONFLICT (species_id)
                 DO UPDATE SET max_throws_single_spawn = MAX(max_throws_single_spawn, ?)",
                species,
                delta,
                delta
            )
            .execute(conn)
            .await?;
        }
    }
    Ok(())
}

/// Le genre d'un moment notable (`pokemon_highlights.type`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HighlightKind {
    Shiny,
    Legendary,
    /// Une apparition très disputée, capturée.
    SpawnDispute,
    /// Une apparition très disputée, enfuie.
    CostlyEscape,
}

impl HighlightKind {
    fn key(self) -> &'static str {
        match self {
            Self::Shiny => "SHINY",
            Self::Legendary => "LEGENDAIRE",
            Self::SpawnDispute => "SPAWN_DISPUTE",
            Self::CostlyEscape => "FUITE_COUTEUSE",
        }
    }
}

/// Un moment notable de l'année, pour raconter l'année plutôt que la résumer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Highlight {
    pub kind: HighlightKind,
    pub user: Option<i64>,
    pub species: Option<i64>,
    pub is_shiny: bool,
    pub value: Option<i64>,
    pub detail: Option<String>,
    pub created_at: i64,
}

/// Écrit un moment notable (une ligne, pas un compteur).
pub async fn record_highlight(db: &StatsDb, highlight: &Highlight) -> Result<(), DbError> {
    let kind = highlight.kind.key();
    let shiny = i64::from(highlight.is_shiny);
    sqlx::query!(
        "INSERT INTO pokemon_highlights (type, user_id, species_id, is_shiny, value, detail, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
        kind,
        highlight.user,
        highlight.species,
        shiny,
        highlight.value,
        highlight.detail,
        highlight.created_at
    )
    .execute(db.writer())
    .await?;
    Ok(())
}
