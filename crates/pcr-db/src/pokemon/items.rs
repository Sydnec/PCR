//! Les sacs des dresseurs (`pokemon_inventory`) : le compteur dit ce qu'on a.

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
