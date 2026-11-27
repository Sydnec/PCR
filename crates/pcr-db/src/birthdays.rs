//! Les anniversaires (`birthdays`) et la garde qui ne fête chacun qu'une fois par an.

use crate::{Db, DbError};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Row {
    pub user_id: i64,
    pub day: i64,
    pub month: i64,
    pub year: Option<i64>,
}

/// Enregistre (ou remplace) la date de `user`. Changer sa date réarme la fête de l'année.
pub async fn set(
    db: &Db,
    user: i64,
    day: i64,
    month: i64,
    year: Option<i64>,
) -> Result<(), DbError> {
    sqlx::query!(
        "INSERT INTO birthdays (user_id, day, month, year, last_wished_year) VALUES (?, ?, ?, ?, NULL)
         ON CONFLICT (user_id) DO UPDATE SET
            day = excluded.day, month = excluded.month, year = excluded.year, last_wished_year = NULL",
        user,
        day,
        month,
        year
    )
    .execute(db.writer())
    .await?;
    Ok(())
}

/// Supprime la date de `user` ; `false` s'il n'en avait pas.
pub async fn remove(db: &Db, user: i64) -> Result<bool, DbError> {
    let done = sqlx::query!("DELETE FROM birthdays WHERE user_id = ?", user)
        .execute(db.writer())
        .await?;
    Ok(done.rows_affected() > 0)
}

pub async fn all(db: &Db) -> Result<Vec<Row>, DbError> {
    Ok(sqlx::query_as!(
        Row,
        "SELECT user_id, day, month, year FROM birthdays ORDER BY user_id"
    )
    .fetch_all(db.reader())
    .await?)
}

/// Revendique la fête de `user` pour `year` ; `false` si elle est déjà partie cette année. Deux
/// passages qui se croisent n'envoient donc qu'un message.
pub async fn claim(db: &Db, user: i64, year: i64) -> Result<bool, DbError> {
    let done = sqlx::query!(
        "UPDATE birthdays SET last_wished_year = ?
          WHERE user_id = ? AND (last_wished_year IS NULL OR last_wished_year <> ?)",
        year,
        user,
        year
    )
    .execute(db.writer())
    .await?;
    Ok(done.rows_affected() == 1)
}

/// Un envoi raté rend la fête : le passage suivant la retentera.
pub async fn release(db: &Db, user: i64, year: i64) -> Result<(), DbError> {
    sqlx::query!(
        "UPDATE birthdays SET last_wished_year = NULL WHERE user_id = ? AND last_wished_year = ?",
        user,
        year
    )
    .execute(db.writer())
    .await?;
    Ok(())
}
