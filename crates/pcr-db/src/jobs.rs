//! Les passages des tâches planifiées (`job_runs`) : une ligne par tâche et par période.
//!
//! La ligne est la revendication : le premier qui l'insère exécute. Un passage commencé mais jamais
//! terminé (arrêt brutal, erreur) se reprend une fois son bail écoulé, et le bail s'allonge à chaque
//! tentative, pour qu'une tâche qui échoue ne martèle pas ce qu'elle appelle.

use crate::{Db, DbError};

/// Revendique le passage `period` de `job`. Vrai : à l'appelant de l'exécuter puis de le terminer
/// par [`finish`]. Faux : déjà fait, ou en cours chez un autre passage dont le bail court encore.
pub async fn claim(
    db: &Db,
    job: &str,
    period: &str,
    now_ms: i64,
    lease_ms: i64,
) -> Result<bool, DbError> {
    let inserted = sqlx::query!(
        "INSERT INTO job_runs (job, period_key, claimed_at) VALUES (?, ?, ?)
         ON CONFLICT (job, period_key) DO NOTHING",
        job,
        period,
        now_ms
    )
    .execute(db.writer())
    .await?
    .rows_affected();
    if inserted == 1 {
        return Ok(true);
    }
    let retaken = sqlx::query!(
        "UPDATE job_runs SET claimed_at = ?, attempts = attempts + 1
          WHERE job = ? AND period_key = ? AND done_at IS NULL
            AND claimed_at + ? * attempts <= ?",
        now_ms,
        job,
        period,
        lease_ms,
        now_ms
    )
    .execute(db.writer())
    .await?
    .rows_affected();
    Ok(retaken == 1)
}

/// Marque le passage comme fait : il ne se rejouera plus.
pub async fn finish(db: &Db, job: &str, period: &str, now_ms: i64) -> Result<(), DbError> {
    sqlx::query!(
        "UPDATE job_runs SET done_at = ? WHERE job = ? AND period_key = ?",
        now_ms,
        job,
        period
    )
    .execute(db.writer())
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_period_runs_once_and_an_unfinished_one_is_retaken_after_a_growing_lease() {
        let dir = std::env::temp_dir().join(format!("pcr-db-jobs-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        let db = Db::open(&dir.join("pcr.db")).await.expect("open");
        let lease = 1_000;

        assert!(
            claim(&db, "cotd", "2026-11-26", 0, lease)
                .await
                .expect("first")
        );
        assert!(
            !claim(&db, "cotd", "2026-11-26", 999, lease)
                .await
                .expect("lease runs")
        );
        // Jamais terminé : repris après un bail, puis après deux.
        assert!(
            claim(&db, "cotd", "2026-11-26", 1_000, lease)
                .await
                .expect("retaken")
        );
        assert!(
            !claim(&db, "cotd", "2026-11-26", 2_999, lease)
                .await
                .expect("longer lease")
        );
        assert!(
            claim(&db, "cotd", "2026-11-26", 3_000, lease)
                .await
                .expect("retaken again")
        );

        finish(&db, "cotd", "2026-11-26", 3_100)
            .await
            .expect("finish");
        assert!(
            !claim(&db, "cotd", "2026-11-26", 99_999, lease)
                .await
                .expect("done")
        );
        // Une autre période, ou une autre tâche, est indépendante.
        assert!(
            claim(&db, "cotd", "2026-11-27", 99_999, lease)
                .await
                .expect("next day")
        );
        assert!(
            claim(&db, "birthdays", "2026-11-26", 99_999, lease)
                .await
                .expect("other job")
        );

        db.close().await;
        std::fs::remove_dir_all(&dir).ok();
    }
}
