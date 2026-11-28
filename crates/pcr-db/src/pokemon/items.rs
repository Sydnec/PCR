//! Les sacs des dresseurs (`pokemon_inventory`) : le compteur dit ce qu'on a, le journal
//! (`pokemon_item_log`) d'où ça vient, écrit dans la même transaction que le mouvement.

use sqlx::SqliteConnection;

use crate::DbError;

/// Les objets que `user` a en poche (clé, nombre), épuisés exclus : la ligne à zéro reste en base
/// pour garder la date du premier, c'est donc au filtre de l'écarter.
pub async fn inventory(
    conn: &mut SqliteConnection,
    user: i64,
) -> Result<Vec<(String, i64)>, DbError> {
    let rows = sqlx::query!(
        "SELECT item_key, count FROM pokemon_inventory
          WHERE user_id = ? AND count > 0 ORDER BY item_key",
        user
    )
    .fetch_all(conn)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| (row.item_key, row.count))
        .collect())
}

/// Combien de `key` a `user`.
pub async fn count(conn: &mut SqliteConnection, user: i64, key: &str) -> Result<i64, DbError> {
    Ok(sqlx::query_scalar!(
        "SELECT count FROM pokemon_inventory WHERE user_id = ? AND item_key = ?",
        user,
        key
    )
    .fetch_optional(conn)
    .await?
    .unwrap_or(0))
}

/// Retire `quantity` de `key`, seulement s'il y en a assez ; `false` : il n'en a plus (pas une
/// panne).
pub async fn consume(
    conn: &mut SqliteConnection,
    user: i64,
    key: &str,
    quantity: i64,
    source: &str,
    now_ms: i64,
) -> Result<bool, DbError> {
    let done = sqlx::query!(
        "UPDATE pokemon_inventory SET count = count - ?
          WHERE user_id = ? AND item_key = ? AND count >= ?",
        quantity,
        user,
        key,
        quantity
    )
    .execute(&mut *conn)
    .await?;
    if done.rows_affected() != 1 {
        return Ok(false);
    }
    log(conn, user, key, -quantity, source, now_ms).await?;
    Ok(true)
}

/// Donne `key` à qui ne l'a pas (le Charme Chroma) : une ligne à zéro compte comme absente. `false` :
/// il l'avait déjà, rien n'est écrit.
pub async fn grant_once(
    conn: &mut SqliteConnection,
    user: i64,
    key: &str,
    source: &str,
    now_ms: i64,
) -> Result<bool, DbError> {
    let done = sqlx::query!(
        "INSERT INTO pokemon_inventory (user_id, item_key, count, first_obtained_at, last_obtained_at)
         VALUES (?, ?, 1, ?, ?)
         ON CONFLICT (user_id, item_key) DO UPDATE SET
           count = 1,
           first_obtained_at = COALESCE(first_obtained_at, excluded.first_obtained_at),
           last_obtained_at = excluded.last_obtained_at
         WHERE count = 0",
        user,
        key,
        now_ms,
        now_ms
    )
    .execute(&mut *conn)
    .await?;
    if done.rows_affected() != 1 {
        return Ok(false);
    }
    log(conn, user, key, 1, source, now_ms).await?;
    Ok(true)
}

async fn log(
    conn: &mut SqliteConnection,
    user: i64,
    key: &str,
    delta: i64,
    source: &str,
    now_ms: i64,
) -> Result<(), DbError> {
    sqlx::query!(
        "INSERT INTO pokemon_item_log (user_id, item_key, delta, source, created_at)
         VALUES (?, ?, ?, ?, ?)",
        user,
        key,
        delta,
        source,
        now_ms
    )
    .execute(conn)
    .await?;
    Ok(())
}
