//! Surcharges de la configuration de jeu (`config_overrides`) : seulement ce qui diffère des valeurs
//! par défaut du code, une ligne par chemin pointé, la valeur en JSON.

use crate::{Db, DbError};

/// Toutes les surcharges, en (chemin, valeur JSON).
pub async fn list(db: &Db) -> Result<Vec<(String, String)>, DbError> {
    let rows = sqlx::query!("SELECT key, value FROM config_overrides ORDER BY key")
        .fetch_all(db.reader())
        .await?;
    Ok(rows.into_iter().map(|row| (row.key, row.value)).collect())
}

/// Pose (ou remplace) la surcharge de `key`. `value` est du JSON déjà validé par `pcr-core`.
pub async fn set(db: &Db, key: &str, value: &str, now_ms: i64, by: i64) -> Result<(), DbError> {
    sqlx::query!(
        "INSERT INTO config_overrides (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at,
                                        updated_by = excluded.updated_by",
        key,
        value,
        now_ms,
        by
    )
    .execute(db.writer())
    .await?;
    Ok(())
}
