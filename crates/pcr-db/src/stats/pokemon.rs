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
    Catches,
    ShinyCatches,
    ThrowsReceived,
    PointsBurned,
    /// Le plus de balls encaissées en une apparition : un record, pas une somme.
    MaxThrowsSingleSpawn,
}

/// Une colonne de `pokemon_daily_stats`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum DailyColumn {
    Spawns,
    Throws,
    Catches,
    PointsBurned,
}

/// Une colonne de `pokemon_stats`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum UserColumn {
    Throws,
    Catches,
    PointsSpent,
    PointsBurned,
    ShinyCatches,
    LegendaryCatches,
    /// Le plus de lancers d'un dresseur sur une même apparition : un record.
    MostThrowsOnOneSpawn,
}

/// Une colonne de `pokemon_ball_stats` (les balls d'un dresseur).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum BallColumn {
    Count,
    Cost,
}

/// Le delta posé dans la seule colonne visée, zéro ailleurs : une requête par table, plutôt qu'une
/// par colonne. L'ordre des variantes de chaque énumération est donc celui des colonnes de sa
/// requête. Ces compteurs ne font que monter (rien ne retire un lancer) : un delta négatif est
/// ignoré.
fn spread<const N: usize>(index: usize, delta: i64) -> [i64; N] {
    let mut deltas = [0; N];
    deltas[index] = delta.max(0);
    deltas
}

/// Les compteurs Pokémon d'un lot. Un record ne descend jamais : il garde la plus grande valeur.
pub(super) async fn add(
    conn: &mut SqliteConnection,
    counter: &Counter,
    delta: i64,
) -> Result<(), DbError> {
    match counter {
        Counter::PokemonSpecies { species, column } => {
            let d: [i64; 8] = spread(*column as usize, delta);
            sqlx::query!(
                "INSERT INTO pokemon_species_stats
                        (species_id, spawns, shiny_spawns, escapes, catches, shiny_catches,
                         throws_received, points_burned, max_throws_single_spawn)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT (species_id) DO UPDATE SET
                   spawns = spawns + excluded.spawns,
                   shiny_spawns = shiny_spawns + excluded.shiny_spawns,
                   escapes = escapes + excluded.escapes,
                   catches = catches + excluded.catches,
                   shiny_catches = shiny_catches + excluded.shiny_catches,
                   throws_received = throws_received + excluded.throws_received,
                   points_burned = points_burned + excluded.points_burned,
                   max_throws_single_spawn =
                     MAX(max_throws_single_spawn, excluded.max_throws_single_spawn)",
                species,
                d[0],
                d[1],
                d[2],
                d[3],
                d[4],
                d[5],
                d[6],
                d[7]
            )
            .execute(conn)
            .await?;
        }
        Counter::PokemonDaily { day, column } => {
            let d: [i64; 4] = spread(*column as usize, delta);
            sqlx::query!(
                "INSERT INTO pokemon_daily_stats (day, spawns, throws, catches, points_burned)
                 VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT (day) DO UPDATE SET
                   spawns = spawns + excluded.spawns,
                   throws = throws + excluded.throws,
                   catches = catches + excluded.catches,
                   points_burned = points_burned + excluded.points_burned",
                day,
                d[0],
                d[1],
                d[2],
                d[3]
            )
            .execute(conn)
            .await?;
        }
        Counter::PokemonUser { user, column } => {
            let d: [i64; 7] = spread(*column as usize, delta);
            sqlx::query!(
                "INSERT INTO pokemon_stats
                        (user_id, throws, catches, points_spent, points_burned, shiny_catches,
                         legendary_catches, most_throws_on_one_spawn)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT (user_id) DO UPDATE SET
                   throws = throws + excluded.throws,
                   catches = catches + excluded.catches,
                   points_spent = points_spent + excluded.points_spent,
                   points_burned = points_burned + excluded.points_burned,
                   shiny_catches = shiny_catches + excluded.shiny_catches,
                   legendary_catches = legendary_catches + excluded.legendary_catches,
                   most_throws_on_one_spawn =
                     MAX(most_throws_on_one_spawn, excluded.most_throws_on_one_spawn)",
                user,
                d[0],
                d[1],
                d[2],
                d[3],
                d[4],
                d[5],
                d[6]
            )
            .execute(conn)
            .await?;
        }
        Counter::PokemonBall { user, ball, column } => {
            let d: [i64; 2] = spread(*column as usize, delta);
            sqlx::query!(
                "INSERT INTO pokemon_ball_stats (user_id, ball, count, cost) VALUES (?, ?, ?, ?)
                 ON CONFLICT (user_id, ball) DO UPDATE SET
                   count = count + excluded.count, cost = cost + excluded.cost",
                user,
                ball,
                d[0],
                d[1]
            )
            .execute(conn)
            .await?;
        }
        _ => {}
    }
    Ok(())
}

/// Ce qu'un lancer ajoute à la chance d'un dresseur : la somme des probabilités de ses lancers, ses
/// captures « attendues ». Fractionnaire, elle s'écrit à part des compteurs entiers.
pub async fn record_expected_catch(
    db: &StatsDb,
    user: i64,
    probability: f64,
) -> Result<(), DbError> {
    sqlx::query!(
        "INSERT INTO pokemon_stats (user_id, expected_catches) VALUES (?, ?)
         ON CONFLICT (user_id) DO UPDATE SET expected_catches = expected_catches + excluded.expected_catches",
        user,
        probability
    )
    .execute(db.writer())
    .await?;
    Ok(())
}

/// Les records d'un dresseur à la capture : la moins probable (et son espèce, cohérentes entre elles :
/// les affectations d'un UPSERT lisent toutes la ligne d'origine) et la plus rapide.
pub async fn record_personal_bests(
    db: &StatsDb,
    user: i64,
    probability: f64,
    species: i64,
    delay_ms: i64,
) -> Result<(), DbError> {
    sqlx::query!(
        "INSERT INTO pokemon_stats (user_id, best_catch_probability, best_catch_species, fastest_catch_ms)
         VALUES (?, ?, ?, MAX(?, 0))
         ON CONFLICT (user_id) DO UPDATE SET
           best_catch_species = CASE
             WHEN best_catch_probability IS NULL
               OR excluded.best_catch_probability < best_catch_probability
             THEN excluded.best_catch_species ELSE best_catch_species END,
           best_catch_probability =
             MIN(COALESCE(best_catch_probability, 1.0), excluded.best_catch_probability),
           fastest_catch_ms =
             MIN(COALESCE(fastest_catch_ms, excluded.fastest_catch_ms), excluded.fastest_catch_ms)",
        user,
        probability,
        species,
        delay_ms
    )
    .execute(db.writer())
    .await?;
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
