//! Les objets au sol (`pokemon_drops`) : une ligne par objet lâché, et le ramassage, un `UPDATE` gardé
//! sur le statut. Deux clics simultanés, un seul ramasseur ; jamais celui qui a capturé le Pokémon
//! qui l'a lâché.

use sqlx::SqliteConnection;

use crate::DbError;

/// Un objet au sol.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Drop {
    pub id: i64,
    pub spawn_id: Option<i64>,
    pub item_key: String,
    pub species_id: Option<i64>,
    /// `OPEN`, `CLAIMED` ou `LOST`.
    pub status: String,
    pub claimed_by: Option<i64>,
}

/// Pose un objet au sol ; rend son numéro.
pub async fn create(
    conn: &mut SqliteConnection,
    spawn: i64,
    item_key: &str,
    species: i64,
    now_ms: i64,
) -> Result<i64, DbError> {
    Ok(sqlx::query_scalar!(
        "INSERT INTO pokemon_drops (spawn_id, item_key, species_id, dropped_at)
         VALUES (?, ?, ?, ?) RETURNING id",
        spawn,
        item_key,
        species,
        now_ms
    )
    .fetch_one(conn)
    .await?)
}

pub async fn get(conn: &mut SqliteConnection, id: i64) -> Result<Option<Drop>, DbError> {
    let row = sqlx::query!(
        "SELECT id, spawn_id, item_key, species_id, status, claimed_by FROM pokemon_drops WHERE id = ?",
        id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row.map(|row| Drop {
        id: row.id,
        spawn_id: row.spawn_id,
        item_key: row.item_key,
        species_id: row.species_id,
        status: row.status,
        claimed_by: row.claimed_by,
    }))
}

/// Ramasse l'objet, s'il est encore au sol et que `user` n'a pas capturé le Pokémon qui l'a lâché.
pub async fn claim(
    conn: &mut SqliteConnection,
    id: i64,
    user: i64,
    now_ms: i64,
) -> Result<bool, DbError> {
    let done = sqlx::query!(
        "UPDATE pokemon_drops SET status = 'CLAIMED', claimed_by = ?, claimed_at = ?
          WHERE id = ? AND status = 'OPEN'
            AND NOT EXISTS (SELECT 1 FROM pokemon_spawns s
                             WHERE s.id = pokemon_drops.spawn_id AND s.caught_by = ?)",
        user,
        now_ms,
        id,
        user
    )
    .execute(conn)
    .await?;
    Ok(done.rows_affected() == 1)
}

/// `user` a capturé le Pokémon qui a lâché cet objet : ce qu'il lâche revient aux autres.
pub async fn is_captor(conn: &mut SqliteConnection, id: i64, user: i64) -> Result<bool, DbError> {
    Ok(sqlx::query_scalar!(
        "SELECT 1 AS found FROM pokemon_drops d JOIN pokemon_spawns s ON s.id = d.spawn_id
          WHERE d.id = ? AND s.caught_by = ?",
        id,
        user
    )
    .fetch_optional(conn)
    .await?
    .is_some())
}
