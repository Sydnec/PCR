//! Le temps passé en vocal, pour les stats de l'année : une session va de l'arrivée dans un salon
//! vocal à la sortie du vocal (changer de salon la prolonge). Au démarrage, les sessions des membres
//! qui ne sont plus en vocal sont oubliées : l'arrêt les a coupées sans qu'on sache quand.

use pcr_db::DbError;

use crate::{App, stats::Voice};

/// Un état vocal reçu : `in_channel`, le membre est dans un salon vocal.
pub async fn changed(app: &App, user: i64, in_channel: bool) -> Result<(), DbError> {
    let change = if in_channel {
        Voice::Joined(user)
    } else {
        Voice::Left(user)
    };
    app.stats.voice(app.clock.now(), change).await
}

/// Au démarrage, la liste des membres en vocal.
pub async fn reset(app: &App, in_voice: &[i64]) -> Result<(), DbError> {
    app.stats
        .voice(app.clock.now(), Voice::Reset(in_voice))
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::TestApp;

    #[tokio::test]
    async fn a_session_adds_up_and_the_restart_forgets_the_cut_ones() {
        let t = TestApp::new("voice", "2026-11-27T12:00:00Z").await;
        changed(&t.app, 1, true).await.expect("join");
        changed(&t.app, 2, true).await.expect("join");
        // Changer de salon ne relance pas la session.
        changed(&t.at("2026-11-27T12:10:00Z"), 1, true)
            .await
            .expect("switch");
        changed(&t.at("2026-11-27T12:30:00Z"), 1, false)
            .await
            .expect("leave");
        changed(&t.at("2026-11-27T13:00:00Z"), 1, true)
            .await
            .expect("join");
        changed(&t.at("2026-11-27T13:05:00Z"), 1, false)
            .await
            .expect("leave");
        // Le bot redémarre : le membre 2 n'est plus en vocal, sa session ne compte pas.
        reset(&t.at("2026-11-27T14:00:00Z"), &[])
            .await
            .expect("reset");
        changed(&t.at("2026-11-27T14:10:00Z"), 2, false)
            .await
            .expect("leave");
        t.app.stats.close().await;

        let path = crate::stats::Stats::path(&t.app.instance.data_dir, 2026);
        let stats = pcr_db::StatsDb::open(&path).await.expect("stats");
        let rows: Vec<(i64, i64, i64)> = sqlx::query_as(
            "SELECT user_id, total_time_ms, longest_session_ms FROM voice_time ORDER BY user_id",
        )
        .fetch_all(stats.reader())
        .await
        .expect("rows");
        assert_eq!(rows, [(1, 35 * 60_000, 30 * 60_000), (2, 0, 0)]);
        stats.close().await;
        t.close().await;
    }
}
