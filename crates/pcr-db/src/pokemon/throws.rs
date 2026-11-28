//! Les lancers (`pokemon_throws`) et ce qu'ils font à une apparition : un raté monte son compteur,
//! une capture la clôt. Les deux écritures sont gardées sur le statut : elles ne touchent qu'une
//! apparition encore en jeu (dans le salon, ou une touche de pêche pas encore enfuie).

use sqlx::SqliteConnection;

use crate::DbError;

/// L'issue d'un lancer dans le journal.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Result {
    Catch,
    Miss,
}

/// Un lancer à journaliser.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct NewThrow<'a> {
    pub spawn: i64,
    pub user: i64,
    pub ball: &'a str,
    /// Les points pris : zéro pour une ball offerte ou de la boutique.
    pub cost: i64,
    pub probability: f64,
    pub result: Result,
    pub thrown_at: i64,
}

pub async fn record(
    conn: &mut SqliteConnection,
    throw: &NewThrow<'_>,
) -> std::result::Result<(), DbError> {
    let result = match throw.result {
        Result::Catch => "CATCH",
        Result::Miss => "MISS",
    };
    sqlx::query!(
        "INSERT INTO pokemon_throws (spawn_id, user_id, ball, cost, probability, result, thrown_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
        throw.spawn,
        throw.user,
        throw.ball,
        throw.cost,
        throw.probability,
        result,
        throw.thrown_at
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// Un raté : le compteur monte, si l'apparition est encore en jeu.
pub async fn miss(
    conn: &mut SqliteConnection,
    spawn: i64,
    now_ms: i64,
) -> std::result::Result<bool, DbError> {
    let done = sqlx::query!(
        "UPDATE pokemon_spawns SET throw_count = throw_count + 1
          WHERE id = ? AND (status = 'ACTIVE' OR (status = 'FISHING' AND flees_at > ?))",
        spawn,
        now_ms
    )
    .execute(conn)
    .await?;
    Ok(done.rows_affected() == 1)
}

/// La capture : un seul vainqueur, si l'apparition est encore en jeu.
pub async fn catch(
    conn: &mut SqliteConnection,
    spawn: i64,
    user: i64,
    ball: &str,
    now_ms: i64,
) -> std::result::Result<bool, DbError> {
    let done = sqlx::query!(
        "UPDATE pokemon_spawns
            SET status = 'CAUGHT', caught_by = ?, caught_at = ?, caught_ball = ?, ended_at = ?,
                throw_count = throw_count + 1
          WHERE id = ? AND (status = 'ACTIVE' OR (status = 'FISHING' AND flees_at > ?))",
        user,
        now_ms,
        ball,
        now_ms,
        spawn,
        now_ms
    )
    .execute(conn)
    .await?;
    Ok(done.rows_affected() == 1)
}

/// Brillante pour son vainqueur (Charme Chroma), l'apparition l'est désormais tout court : la ligne
/// dit ce qui a été attrapé, et le message comme les statistiques la lisent telle quelle.
pub async fn shine(conn: &mut SqliteConnection, spawn: i64) -> std::result::Result<(), DbError> {
    sqlx::query!("UPDATE pokemon_spawns SET is_shiny = 1 WHERE id = ?", spawn)
        .execute(conn)
        .await?;
    Ok(())
}

/// Combien de fois `user` a payé `ball` en points : un lancer remboursé (VOID, en v1) ou offert n'y
/// compte pas. Le prix de la Master Ball se lit ici.
pub async fn paid(
    conn: &mut SqliteConnection,
    user: i64,
    ball: &str,
) -> std::result::Result<i64, DbError> {
    Ok(sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "paid!: i64" FROM pokemon_throws
            WHERE user_id = ? AND ball = ? AND cost > 0 AND result != 'VOID'"#,
        user,
        ball
    )
    .fetch_one(conn)
    .await?)
}
