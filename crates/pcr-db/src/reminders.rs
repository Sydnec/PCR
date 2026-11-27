//! Les rappels (`reminders`) : posés par `/rappel` ou le bouton « Me rappeler aussi », envoyés en MP
//! à leur heure, effacés quelques jours après.

use sqlx::SqliteConnection;

use crate::{Db, DbError};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reminder {
    pub id: i64,
    pub user_id: i64,
    /// Le salon où il a été posé, cité dans le MP.
    pub channel_id: i64,
    pub message: String,
    pub trigger_at: i64,
    pub created_at: i64,
}

/// Pose un rappel ; renvoie son numéro.
pub async fn create(
    conn: &mut SqliteConnection,
    user: i64,
    channel: i64,
    message: &str,
    trigger_at: i64,
    now_ms: i64,
) -> Result<i64, DbError> {
    Ok(sqlx::query_scalar!(
        "INSERT INTO reminders (user_id, channel_id, message, trigger_at, created_at)
         VALUES (?, ?, ?, ?, ?) RETURNING id",
        user,
        channel,
        message,
        trigger_at,
        now_ms
    )
    .fetch_one(conn)
    .await?)
}

/// Un rappel par son numéro, envoyé ou non (le bouton d'un rappel en recopie le message).
pub async fn get(db: &Db, id: i64) -> Result<Option<Reminder>, DbError> {
    Ok(sqlx::query_as!(
        Reminder,
        "SELECT id, user_id, channel_id, message, trigger_at, created_at FROM reminders WHERE id = ?",
        id
    )
    .fetch_optional(db.reader())
    .await?)
}

/// Les rappels à venir de `user`, du plus proche au plus lointain.
pub async fn pending_of(db: &Db, user: i64) -> Result<Vec<Reminder>, DbError> {
    Ok(sqlx::query_as!(
        Reminder,
        "SELECT id, user_id, channel_id, message, trigger_at, created_at FROM reminders
          WHERE user_id = ? AND sent_at IS NULL ORDER BY trigger_at, id",
        user
    )
    .fetch_all(db.reader())
    .await?)
}

/// Supprime un rappel à venir de `user` et le renvoie ; `None` s'il n'existe pas, est parti, ou
/// appartient à un autre.
pub async fn delete_pending(db: &Db, id: i64, user: i64) -> Result<Option<Reminder>, DbError> {
    Ok(sqlx::query_as!(
        Reminder,
        "DELETE FROM reminders WHERE id = ? AND user_id = ? AND sent_at IS NULL
         RETURNING id, user_id, channel_id, message, trigger_at, created_at",
        id,
        user
    )
    .fetch_optional(db.writer())
    .await?)
}

/// Les rappels échus et pas encore envoyés, les plus anciens d'abord.
pub async fn due(db: &Db, now_ms: i64, limit: i64) -> Result<Vec<Reminder>, DbError> {
    Ok(sqlx::query_as!(
        Reminder,
        "SELECT id, user_id, channel_id, message, trigger_at, created_at FROM reminders
          WHERE sent_at IS NULL AND trigger_at <= ? ORDER BY trigger_at, id LIMIT ?",
        now_ms,
        limit
    )
    .fetch_all(db.reader())
    .await?)
}

/// Le rappel est parti (ou ne partira jamais : membre introuvable, MP fermés).
pub async fn mark_sent(db: &Db, id: i64, now_ms: i64) -> Result<(), DbError> {
    sqlx::query!(
        "UPDATE reminders SET sent_at = ? WHERE id = ? AND sent_at IS NULL",
        now_ms,
        id
    )
    .execute(db.writer())
    .await?;
    Ok(())
}

/// Efface les rappels envoyés avant `before` ; renvoie leur nombre.
pub async fn purge_sent(db: &Db, before: i64) -> Result<u64, DbError> {
    let done = sqlx::query!(
        "DELETE FROM reminders WHERE sent_at IS NOT NULL AND sent_at < ?",
        before
    )
    .execute(db.writer())
    .await?;
    Ok(done.rows_affected())
}
