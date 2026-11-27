//! Le pot commun : son échéance (`economy_state`) et son journal (`points_redistributions`).
//!
//! Tout se joue dans la transaction du pot, ouverte par `pcr-app` : l'échéance n'est consommée que
//! si le pot est validé avec elle.

use sqlx::SqliteConnection;

use crate::{Db, DbError};

/// L'échéance du prochain pot (ms) ; 0 tant qu'elle n'est pas posée.
pub async fn next_due(conn: &mut SqliteConnection) -> Result<i64, DbError> {
    let at = sqlx::query_scalar!("SELECT next_redistribution_at FROM economy_state WHERE id = 1")
        .fetch_one(conn)
        .await?;
    Ok(at)
}

/// L'échéance du prochain pot, pour l'affichage.
pub async fn next_due_now(db: &Db) -> Result<i64, DbError> {
    let mut conn = db.reader().acquire().await?;
    next_due(&mut conn).await
}

/// Pose la première échéance sur une base neuve. Faux si elle l'était déjà.
pub async fn schedule_first(conn: &mut SqliteConnection, at: i64) -> Result<bool, DbError> {
    let done = sqlx::query!(
        "UPDATE economy_state SET next_redistribution_at = ?
          WHERE id = 1 AND next_redistribution_at = 0",
        at
    )
    .execute(conn)
    .await?
    .rows_affected();
    Ok(done == 1)
}

/// Remplace l'échéance `previous` par `next`. Faux si elle avait changé entre-temps : le pot
/// n'appartient alors pas à cet appelant.
pub async fn claim(conn: &mut SqliteConnection, previous: i64, next: i64) -> Result<bool, DbError> {
    let done = sqlx::query!(
        "UPDATE economy_state SET next_redistribution_at = ?
          WHERE id = 1 AND next_redistribution_at = ?",
        next,
        previous
    )
    .execute(conn)
    .await?
    .rows_affected();
    Ok(done == 1)
}

/// Une ligne du journal des pots.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Journal {
    pub ran_at: i64,
    /// L'administrateur, `None` pour l'échéance.
    pub triggered_by: Option<i64>,
    pub percent: f64,
    pub participants: i64,
    pub contributors: i64,
    pub pot: i64,
    pub share: i64,
}

/// Journalise un pot appliqué (dans sa transaction).
pub async fn journal(conn: &mut SqliteConnection, entry: &Journal) -> Result<(), DbError> {
    sqlx::query!(
        "INSERT INTO points_redistributions
           (ran_at, triggered_by, percent, participants, contributors, pot, share)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
        entry.ran_at,
        entry.triggered_by,
        entry.percent,
        entry.participants,
        entry.contributors,
        entry.pot,
        entry.share
    )
    .execute(conn)
    .await?;
    Ok(())
}
