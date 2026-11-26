//! Les messages publics que le bot poste puis réécrit (`public_messages`).
//!
//! Un cas d'usage crée la ligne (ou monte sa version) dans sa transaction ; le worker de `pcr-app`
//! écrit ensuite sur Discord et pose `synced_version`. Il n'avance jamais au-delà de la version qu'il
//! a lue : un changement arrivé pendant l'écriture laisse le message en retard, et il sera repris.

use sqlx::SqliteConnection;

use crate::{Db, DbError};

/// Un message à écrire : de quoi le construire (`kind`, `entity_id`) et où.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublicMessage {
    pub id: i64,
    pub kind: String,
    pub entity_id: i64,
    pub channel_id: i64,
    /// `None` tant qu'il n'est pas posté.
    pub message_id: Option<i64>,
    pub version: i64,
}

/// Déclare le message public d'une entité, à poster dans `channel_id` (dans la transaction qui la crée).
pub async fn create(
    conn: &mut SqliteConnection,
    kind: &str,
    entity_id: i64,
    channel_id: i64,
    now_ms: i64,
) -> Result<(), DbError> {
    sqlx::query!(
        "INSERT INTO public_messages (kind, entity_id, channel_id, changed_at) VALUES (?, ?, ?, ?)",
        kind,
        entity_id,
        channel_id,
        now_ms
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// L'entité a changé : son message est à réécrire (dans la transaction du changement). Sans effet
/// pour une entité sans message public, ou dont le message a disparu.
pub async fn touch(
    conn: &mut SqliteConnection,
    kind: &str,
    entity_id: i64,
    now_ms: i64,
) -> Result<(), DbError> {
    sqlx::query!(
        "UPDATE public_messages SET version = version + 1, changed_at = ?
          WHERE kind = ? AND entity_id = ? AND gone_at IS NULL",
        now_ms,
        kind,
        entity_id
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// Les messages en retard dont le dernier changement tombe dans `[changed_from, changed_to]`, les plus
/// anciens d'abord.
pub async fn behind(
    db: &Db,
    changed_from: i64,
    changed_to: i64,
    limit: i64,
) -> Result<Vec<PublicMessage>, DbError> {
    let rows = sqlx::query!(
        "SELECT id, kind, entity_id, channel_id, message_id, version FROM public_messages
          WHERE synced_version < version AND gone_at IS NULL
            AND changed_at BETWEEN ? AND ?
          ORDER BY changed_at, id LIMIT ?",
        changed_from,
        changed_to,
        limit
    )
    .fetch_all(db.reader())
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| PublicMessage {
            id: row.id,
            kind: row.kind,
            entity_id: row.entity_id,
            channel_id: row.channel_id,
            message_id: row.message_id,
            version: row.version,
        })
        .collect())
}

/// Le message montre la version `version` (et vit à `message_id`, s'il vient d'être posté).
pub async fn synced(db: &Db, id: i64, version: i64, message_id: i64) -> Result<(), DbError> {
    sqlx::query!(
        "UPDATE public_messages SET synced_version = ?, message_id = ?
          WHERE id = ? AND synced_version < ?",
        version,
        message_id,
        id,
        version
    )
    .execute(db.writer())
    .await?;
    Ok(())
}

/// Discord a répondu que ce message ne se réécrira plus : il sort du rattrapage.
pub async fn gone(db: &Db, id: i64, now_ms: i64) -> Result<(), DbError> {
    sqlx::query!(
        "UPDATE public_messages SET gone_at = ? WHERE id = ? AND gone_at IS NULL",
        now_ms,
        id
    )
    .execute(db.writer())
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_write_never_marks_a_newer_change_as_shown() {
        let dir = std::env::temp_dir().join(format!("pcr-db-public-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        let db = Db::open(&dir.join("pcr.db")).await.expect("open");
        let mut conn = db.writer().acquire().await.expect("conn");
        create(&mut conn, "spawn", 1, 900, 1_000)
            .await
            .expect("create");
        create(&mut conn, "trade", 2, 900, 1_000)
            .await
            .expect("create");
        drop(conn);

        let pending = behind(&db, 0, 2_000, 10).await.expect("behind");
        assert_eq!(pending.len(), 2);
        let spawn = pending[0].clone();
        assert_eq!((spawn.message_id, spawn.version), (None, 1));

        // Pendant que le worker écrit la version 1, l'apparition change encore.
        let mut conn = db.writer().acquire().await.expect("conn");
        touch(&mut conn, "spawn", 1, 1_500).await.expect("touch");
        drop(conn);
        synced(&db, spawn.id, spawn.version, 800)
            .await
            .expect("synced");

        let pending = behind(&db, 0, 2_000, 10).await.expect("behind");
        let spawn = pending
            .iter()
            .find(|m| m.kind == "spawn")
            .expect("still behind");
        assert_eq!((spawn.message_id, spawn.version), (Some(800), 2));

        // Hors de la fenêtre, ou disparu : plus rien à rattraper.
        let trade = pending
            .iter()
            .find(|m| m.kind == "trade")
            .expect("trade")
            .id;
        assert!(
            behind(&db, 1_200, 2_000, 10)
                .await
                .expect("window")
                .iter()
                .all(|m| m.id != trade)
        );
        gone(&db, trade, 1_600).await.expect("gone");
        assert!(
            behind(&db, 0, 2_000, 10)
                .await
                .expect("behind")
                .iter()
                .all(|m| m.id != trade)
        );

        db.close().await;
        std::fs::remove_dir_all(&dir).ok();
    }
}
