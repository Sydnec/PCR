//! Sauvegarde et restauration des bases.
//!
//! `VACUUM INTO` écrit une copie cohérente et compactée pendant que le bot tourne : c'est une simple
//! transaction de lecture, l'écrivain n'est jamais bloqué. La source s'ouvre en lecture seule, sans
//! migration : sauvegarder ne doit jamais modifier ce qu'on sauvegarde.

use std::path::Path;

use sqlx::{Connection as _, SqliteConnection, sqlite::SqliteConnectOptions};

use crate::DbError;

/// Copie cohérente de `src` vers `dest`. `dest` ne doit pas exister (règle de `VACUUM INTO`).
pub async fn vacuum_into(src: &Path, dest: &Path) -> Result<(), DbError> {
    let mut conn = open_read_only(src).await?;
    let dest = dest.to_string_lossy();
    sqlx::query("VACUUM INTO ?")
        .bind(dest.as_ref())
        .execute(&mut conn)
        .await?;
    conn.close().await?;
    Ok(())
}

/// Vrai si `path` est une base permanente PCR v2 : elle porte la table de migrations de sqlx et la
/// table `meta`. Évite de restaurer par erreur une base v1, une base de stats annuelle (qui a aussi
/// ses migrations sqlx, mais `stats_meta`) ou un fichier quelconque à la place de `pcr.db`.
pub async fn is_pcr_database(path: &Path) -> Result<bool, DbError> {
    let mut conn = open_read_only(path).await?;
    let found = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM sqlite_master
          WHERE type = 'table' AND name IN ('_sqlx_migrations', 'meta')",
    )
    .fetch_one(&mut conn)
    .await?;
    conn.close().await?;
    Ok(found == 2)
}

async fn open_read_only(path: &Path) -> Result<SqliteConnection, DbError> {
    // Aucun `journal_mode` : le fixer serait une écriture, refusée en lecture seule (une copie
    // produite par `VACUUM INTO` n'est pas en WAL).
    let options = SqliteConnectOptions::new().filename(path).read_only(true);
    Ok(SqliteConnection::connect_with(&options).await?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Db, StatsDb, meta};

    #[tokio::test]
    async fn backup_is_a_readable_pcr_database_with_the_same_data() {
        let dir = std::env::temp_dir().join(format!("pcr-db-backup-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        let src = dir.join("pcr.db");
        let dest = dir.join("backup.db");

        let db = Db::open(&src).await.expect("open");
        meta::set(&db, "version", "2.0.0").await.expect("set");
        vacuum_into(&src, &dest)
            .await
            .expect("backup while the source is open");
        db.close().await;

        assert!(is_pcr_database(&dest).await.expect("inspect backup"));
        let restored = Db::open(&dest).await.expect("open backup");
        assert_eq!(
            meta::get(&restored, "version")
                .await
                .expect("get")
                .as_deref(),
            Some("2.0.0")
        );
        restored.close().await;
        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn a_yearly_stats_database_is_not_taken_for_pcr_db() {
        let dir = std::env::temp_dir().join(format!("pcr-db-stats-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        let path = dir.join("stats-2026.db");

        let stats = StatsDb::open(&path).await.expect("stats migrations apply");
        stats.close().await;

        assert!(!is_pcr_database(&path).await.expect("inspect"));
        std::fs::remove_dir_all(&dir).ok();
    }
}
