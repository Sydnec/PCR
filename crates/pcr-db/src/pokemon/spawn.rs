//! Les apparitions (`pokemon_spawns`), l'état du salon (`pokemon_state`) et ce que les lancers en
//! disent (`pokemon_throws`).
//!
//! Les écritures prennent la transaction du cas d'usage : la revendication relit le salon, fait fuir
//! le Pokémon en place et insère le suivant d'un bloc. L'index unique partiel `pokemon_spawns_active`
//! reste le dernier rempart contre deux apparitions à la fois.

use sqlx::SqliteConnection;

use crate::DbError;

/// Où en est une apparition.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    /// Dans le salon.
    Active,
    /// Une touche de pêche, réservée à son pêcheur.
    Fishing,
    Caught,
    Fled,
}

impl Status {
    fn parse(text: &str) -> Result<Self, DbError> {
        Ok(match text {
            "ACTIVE" => Self::Active,
            "FISHING" => Self::Fishing,
            "CAUGHT" => Self::Caught,
            "FLED" => Self::Fled,
            // Impossible tant que le `CHECK` de la colonne tient.
            other => {
                return Err(sqlx::Error::Decode(format!("spawn status {other}").into()).into());
            }
        })
    }

    pub fn is_ended(self) -> bool {
        matches!(self, Self::Caught | Self::Fled)
    }
}

/// Une apparition, telle qu'elle a été figée à sa naissance, et sa fin.
// Les drapeaux de la ligne, un par colonne : les regrouper ne dirait rien de plus.
#[allow(clippy::struct_excessive_bools)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Spawn {
    pub id: i64,
    pub species_id: i64,
    pub is_shiny: bool,
    pub charm_shiny: bool,
    pub catch_rate: i64,
    /// La clé v1 (`COMMUN`…).
    pub rarity: String,
    pub held_item: Option<String>,
    /// `M`, `F` ou rien.
    pub sex: Option<String>,
    pub form: Option<String>,
    pub status: Status,
    pub fished: bool,
    pub spawned_at: i64,
    pub flees_at: Option<i64>,
    pub throw_count: i64,
    pub caught_by: Option<i64>,
    pub caught_ball: Option<String>,
    pub ended_at: Option<i64>,
    pub announcement: Option<String>,
    pub pings_role: bool,
}

/// Une apparition à insérer : ce que le tirage a décidé.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewSpawn<'a> {
    pub species_id: i64,
    pub is_shiny: bool,
    pub charm_shiny: bool,
    pub catch_rate: i64,
    pub rarity: &'a str,
    pub held_item: Option<&'a str>,
    pub sex: Option<&'a str>,
    pub form: Option<&'a str>,
    pub spawned_at: i64,
    pub flees_at: i64,
    pub announcement: Option<&'a str>,
    pub pings_role: bool,
}

/// L'état du salon que la revendication relit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct State {
    pub message_count: i64,
    pub last_spawn_at: i64,
    pub paused_until: i64,
}

macro_rules! spawn_from {
    ($row:expr) => {{
        let row = $row;
        Spawn {
            id: row.id,
            species_id: row.species_id,
            is_shiny: row.is_shiny != 0,
            charm_shiny: row.charm_shiny != 0,
            catch_rate: row.catch_rate,
            rarity: row.rarity,
            held_item: row.held_item,
            sex: row.sex,
            form: row.form,
            status: Status::parse(&row.status)?,
            fished: row.fished != 0,
            spawned_at: row.spawned_at,
            flees_at: row.flees_at,
            throw_count: row.throw_count,
            caught_by: row.caught_by,
            caught_ball: row.caught_ball,
            ended_at: row.ended_at,
            announcement: row.announcement,
            pings_role: row.pings_role != 0,
        }
    }};
}

/// Un message de plus pour la prochaine apparition (le compteur monte même pendant un parc safari).
pub async fn count_message(conn: &mut SqliteConnection) -> Result<(), DbError> {
    sqlx::query!("UPDATE pokemon_state SET message_count = message_count + 1 WHERE id = 1")
        .execute(conn)
        .await?;
    Ok(())
}

pub async fn state(conn: &mut SqliteConnection) -> Result<State, DbError> {
    let row = sqlx::query!(
        "SELECT message_count, last_spawn_at, spawn_paused_until FROM pokemon_state WHERE id = 1"
    )
    .fetch_one(conn)
    .await?;
    Ok(State {
        message_count: row.message_count,
        last_spawn_at: row.last_spawn_at,
        paused_until: row.spawn_paused_until,
    })
}

/// Une apparition vient d'être revendiquée : le compteur repart de zéro, l'horloge est réarmée.
pub async fn claimed(conn: &mut SqliteConnection, now_ms: i64) -> Result<(), DbError> {
    sqlx::query!(
        "UPDATE pokemon_state
            SET message_count = 0, last_spawn_at = ?, total_spawns = total_spawns + 1
          WHERE id = 1",
        now_ms
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// La fin de la dernière apparition du salon (capture ou fuite) ; une pêche n'occupe pas le salon.
/// Les apparitions se suivent sans se chevaucher : la plus récente terminée est la dernière finie.
pub async fn last_end(conn: &mut SqliteConnection) -> Result<Option<i64>, DbError> {
    Ok(sqlx::query_scalar!(
        "SELECT ended_at FROM pokemon_spawns
          WHERE fished = 0 AND ended_at IS NOT NULL ORDER BY id DESC LIMIT 1"
    )
    .fetch_optional(conn)
    .await?
    .flatten())
}

pub async fn get(conn: &mut SqliteConnection, id: i64) -> Result<Option<Spawn>, DbError> {
    let row = sqlx::query!("SELECT * FROM pokemon_spawns WHERE id = ?", id)
        .fetch_optional(conn)
        .await?;
    Ok(match row {
        Some(row) => Some(spawn_from!(row)),
        None => None,
    })
}

/// Le Pokémon du salon, s'il y en a un.
pub async fn active(conn: &mut SqliteConnection) -> Result<Option<Spawn>, DbError> {
    let row = sqlx::query!("SELECT * FROM pokemon_spawns WHERE status = 'ACTIVE'")
        .fetch_optional(conn)
        .await?;
    Ok(match row {
        Some(row) => Some(spawn_from!(row)),
        None => None,
    })
}

pub async fn insert(conn: &mut SqliteConnection, spawn: &NewSpawn<'_>) -> Result<i64, DbError> {
    let shiny = i64::from(spawn.is_shiny);
    let charm = i64::from(spawn.charm_shiny);
    let pings = i64::from(spawn.pings_role);
    Ok(sqlx::query_scalar!(
        "INSERT INTO pokemon_spawns
                (species_id, is_shiny, charm_shiny, catch_rate, rarity, held_item, sex, form,
                 spawned_at, flees_at, announcement, pings_role)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
        spawn.species_id,
        shiny,
        charm,
        spawn.catch_rate,
        spawn.rarity,
        spawn.held_item,
        spawn.sex,
        spawn.form,
        spawn.spawned_at,
        spawn.flees_at,
        spawn.announcement,
        pings
    )
    .fetch_one(conn)
    .await?)
}

/// Fait fuir une apparition encore là. `false` : elle n'y était plus (une capture a gagné la course),
/// et il n'y a rien à conclure.
pub async fn flee(conn: &mut SqliteConnection, id: i64, now_ms: i64) -> Result<bool, DbError> {
    let done = sqlx::query!(
        "UPDATE pokemon_spawns SET status = 'FLED', ended_at = ? WHERE id = ? AND status = 'ACTIVE'",
        now_ms,
        id
    )
    .execute(conn)
    .await?;
    Ok(done.rows_affected() == 1)
}

/// Les apparitions qui doivent fuir : leur durée de vie est écoulée, ou leur message a disparu (plus
/// personne ne les voit).
pub async fn due(conn: &mut SqliteConnection, now_ms: i64) -> Result<Vec<Spawn>, DbError> {
    let rows = sqlx::query!(
        "SELECT * FROM pokemon_spawns AS s
          WHERE status = 'ACTIVE'
            AND (flees_at <= ? OR EXISTS (
                  SELECT 1 FROM public_messages
                   WHERE kind = 'spawn' AND entity_id = s.id AND gone_at IS NOT NULL))",
        now_ms
    )
    .fetch_all(conn)
    .await?;
    rows.into_iter().map(|row| Ok(spawn_from!(row))).collect()
}

/// Les apparitions en cours sans échéance (antérieures à son ajout en v1), avec leur rareté.
pub async fn without_deadline(conn: &mut SqliteConnection) -> Result<Vec<(i64, String)>, DbError> {
    let rows = sqlx::query!(
        "SELECT id, rarity FROM pokemon_spawns WHERE status = 'ACTIVE' AND flees_at IS NULL"
    )
    .fetch_all(conn)
    .await?;
    Ok(rows.into_iter().map(|row| (row.id, row.rarity)).collect())
}

pub async fn set_deadline(
    conn: &mut SqliteConnection,
    id: i64,
    flees_at: i64,
) -> Result<(), DbError> {
    sqlx::query!(
        "UPDATE pokemon_spawns SET flees_at = ? WHERE id = ? AND flees_at IS NULL",
        flees_at,
        id
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// Les lancers d'une apparition par dresseur et par ball : combien (capture comprise, c'est la
/// participation), ce qu'ils ont coûté, et les points brûlés, sur les seuls ratés. Un lancer
/// remboursé n'a pas eu lieu.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Spent {
    pub user_id: i64,
    pub ball: String,
    pub throws: i64,
    pub cost: i64,
    pub burned: i64,
}

pub async fn spending(conn: &mut SqliteConnection, spawn: i64) -> Result<Vec<Spent>, DbError> {
    let rows = sqlx::query!(
        r#"SELECT user_id, ball, COUNT(*) AS "throws!: i64", SUM(cost) AS "cost!: i64",
                  SUM(CASE WHEN result = 'MISS' THEN cost ELSE 0 END) AS "burned!: i64"
             FROM pokemon_throws
            WHERE spawn_id = ? AND result != 'VOID'
            GROUP BY user_id, ball
            ORDER BY user_id, ball"#,
        spawn
    )
    .fetch_all(conn)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| Spent {
            user_id: row.user_id,
            ball: row.ball,
            throws: row.throws,
            cost: row.cost,
            burned: row.burned,
        })
        .collect())
}

/// Un lancer du journal de l'annonce.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Throw {
    pub user_id: i64,
    pub ball: String,
    pub caught: bool,
}

/// Les `limit` derniers lancers, du plus ancien au plus récent, remboursés exclus.
pub async fn recent_throws(
    conn: &mut SqliteConnection,
    spawn: i64,
    limit: i64,
) -> Result<Vec<Throw>, DbError> {
    let mut rows: Vec<Throw> = sqlx::query!(
        "SELECT user_id, ball, result FROM pokemon_throws
          WHERE spawn_id = ? AND result != 'VOID' ORDER BY id DESC LIMIT ?",
        spawn,
        limit
    )
    .fetch_all(conn)
    .await?
    .into_iter()
    .map(|row| Throw {
        user_id: row.user_id,
        ball: row.ball,
        caught: row.result == "CATCH",
    })
    .collect();
    rows.reverse();
    Ok(rows)
}

/// L'objet de cette apparition est au sol, ou a été ramassé : il l'a lâché en partant. Un objet perdu
/// (aucun salon pour l'annoncer) est revenu à son capteur.
pub async fn dropped(conn: &mut SqliteConnection, spawn: i64) -> Result<bool, DbError> {
    Ok(sqlx::query_scalar!(
        "SELECT 1 AS found FROM pokemon_drops
          WHERE spawn_id = ? AND status IN ('OPEN', 'CLAIMED') LIMIT 1",
        spawn
    )
    .fetch_optional(conn)
    .await?
    .is_some())
}
