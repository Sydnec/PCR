//! Les balls de la boutique en poche (`pokemon_ball_units`), une ligne par ball : la date d'achat
//! décide si elle sert à une apparition (seulement celles nées après).

use sqlx::SqliteConnection;

use crate::DbError;

/// Ce qu'un dresseur a d'une ball, et combien servent à une apparition donnée.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Units {
    pub ball: String,
    pub held: i64,
    /// Achetées avant l'apparition.
    pub eligible: i64,
}

/// Les balls de `user`, et celles achetées avant `spawned_at`.
pub async fn counts(
    conn: &mut SqliteConnection,
    user: i64,
    spawned_at: i64,
) -> Result<Vec<Units>, DbError> {
    let rows = sqlx::query!(
        r#"SELECT ball, COUNT(*) AS "held!: i64",
                  SUM(bought_at < ?) AS "eligible!: i64"
             FROM pokemon_ball_units WHERE user_id = ? GROUP BY ball ORDER BY ball"#,
        spawned_at,
        user
    )
    .fetch_all(conn)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| Units {
            ball: row.ball,
            held: row.held,
            eligible: row.eligible,
        })
        .collect())
}

/// Prend la plus ancienne `ball` achetée avant `spawned_at` ; `false` : aucune ne sert ici.
pub async fn take(
    conn: &mut SqliteConnection,
    user: i64,
    ball: &str,
    spawned_at: i64,
) -> Result<bool, DbError> {
    let done = sqlx::query!(
        "DELETE FROM pokemon_ball_units
          WHERE id = (SELECT id FROM pokemon_ball_units
                       WHERE user_id = ? AND ball = ? AND bought_at < ?
                       ORDER BY bought_at, id LIMIT 1)",
        user,
        ball,
        spawned_at
    )
    .execute(conn)
    .await?;
    Ok(done.rows_affected() == 1)
}
