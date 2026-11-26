//! Petits faits clé/valeur sur l'instance (dernière version annoncée, empreinte des commandes…).

use crate::{Db, DbError};

pub async fn get(db: &Db, key: &str) -> Result<Option<String>, DbError> {
    let value = sqlx::query_scalar!("SELECT value FROM meta WHERE key = ?", key)
        .fetch_optional(db.reader())
        .await?;
    Ok(value)
}

pub async fn set(db: &Db, key: &str, value: &str) -> Result<(), DbError> {
    sqlx::query!(
        "INSERT INTO meta (key, value) VALUES (?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        key,
        value
    )
    .execute(db.writer())
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn migrations_apply_and_meta_round_trips() {
        let dir = std::env::temp_dir().join(format!("pcr-db-meta-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        let db = Db::open(&dir.join("pcr.db")).await.expect("open");

        assert_eq!(get(&db, "version").await.expect("get"), None);
        set(&db, "version", "2.0.0").await.expect("set");
        set(&db, "version", "2.0.1").await.expect("overwrite");
        assert_eq!(
            get(&db, "version").await.expect("get").as_deref(),
            Some("2.0.1")
        );

        db.close().await;
        std::fs::remove_dir_all(&dir).ok();
    }
}
