//! Les statistiques de l'année, tamponnées en mémoire et écrites par lots dans `stats-<ANNÉE>.db`.
//!
//! Chaque incrément porte l'année de Paris où il a eu lieu : un lot vidé juste après minuit le
//! 1er janvier écrit encore dans le fichier de l'année écoulée ce qui s'y est passé, et ouvre le
//! fichier de la nouvelle année pour le reste. La bascule annuelle n'a donc besoin d'aucune tâche, et
//! le fichier de l'année écoulée n'est jamais supprimé par le bot.
//!
//! Le tampon est un cache, pas de l'état de jeu : un arrêt brutal perd au plus un lot de compteurs.
//! L'arrêt normal vide tout. Un retrait et un ajout d'un même lot se compensent avant d'atteindre le
//! plancher de zéro : au pire un d'écart sur un compteur, dans ce seul cas limite.

use std::{
    collections::{HashMap, hash_map::Entry},
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};

use jiff::Timestamp;
use pcr_core::clock::paris_date;
pub use pcr_db::stats::{BetStats, Counter};
use pcr_db::{DbError, StatsDb};
use tokio::sync::watch;

use crate::App;

/// Cadence des lots : assez court pour qu'un arrêt brutal coûte peu, assez long pour qu'un salon
/// animé ne coûte qu'une écriture de temps en temps.
const FLUSH: Duration = Duration::from_secs(15);

#[derive(Debug)]
pub struct Stats {
    data_dir: PathBuf,
    pending: Mutex<HashMap<(i16, Counter), i64>>,
    /// Le fichier de l'année en cours, gardé ouvert entre deux lots.
    open: tokio::sync::Mutex<Option<(i16, StatsDb)>>,
}

impl Stats {
    pub fn new(data_dir: PathBuf) -> Self {
        Self {
            data_dir,
            pending: Mutex::default(),
            open: tokio::sync::Mutex::default(),
        }
    }

    /// Le fichier des stats de `year`.
    pub fn path(data_dir: &Path, year: i16) -> PathBuf {
        data_dir.join(format!("stats-{year}.db"))
    }

    /// Ajoute `delta` à `counter` (ou le retient comme record, voir [`Counter::combine`]), pour
    /// l'année de Paris de `at`.
    pub fn add(&self, at: Timestamp, counter: Counter, delta: i64) {
        let year = paris_date(at).year();
        let mut pending = self
            .pending
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        merge(&mut pending, year, counter, delta);
    }

    /// Un `/randomizabaise`, dans le fichier de l'année en cours (directement : c'est une ligne,
    /// pas un compteur à additionner).
    pub async fn record_ship(
        &self,
        now: Timestamp,
        message: i64,
        members: &[i64],
        shiny: bool,
    ) -> Result<(), DbError> {
        let mut open = self.open.lock().await;
        let db = self.current(&mut open, paris_date(now).year()).await?;
        pcr_db::stats::record_ship(db, message, members, shiny).await
    }

    /// Les statistiques de paris de l'année en cours. Le tampon est d'abord écrit : un pari résolu à
    /// l'instant compte déjà.
    pub async fn bet_stats(&self, now: Timestamp, user: i64) -> Result<BetStats, DbError> {
        self.flush(now).await?;
        let mut open = self.open.lock().await;
        let db = self.current(&mut open, paris_date(now).year()).await?;
        pcr_db::stats::bet_stats(db, user).await
    }

    /// Écrit le tampon, une transaction par année. Un lot qui échoue revient dans le tampon pour le
    /// passage suivant : une panne passagère ne perd rien.
    pub async fn flush(&self, now: Timestamp) -> Result<(), DbError> {
        let batch = std::mem::take(
            &mut *self
                .pending
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner),
        );
        let mut by_year: HashMap<i16, Vec<(Counter, i64)>> = HashMap::new();
        for ((year, counter), delta) in batch {
            if delta != 0 {
                by_year.entry(year).or_default().push((counter, delta));
            }
        }
        let current = paris_date(now).year();
        let mut open = self.open.lock().await;
        let mut years: Vec<_> = by_year.into_iter().collect();
        years.sort_by_key(|(year, _)| *year);
        let mut failure = None;
        for (year, counters) in years {
            if failure.is_some() {
                self.restore(year, counters);
                continue;
            }
            let written = if year == current {
                match self.current(&mut open, current).await {
                    Ok(db) => pcr_db::stats::add_all(db, &counters).await,
                    Err(error) => Err(error),
                }
            } else {
                self.write_other_year(year, &counters).await
            };
            if let Err(error) = written {
                self.restore(year, counters);
                failure = Some(error);
            }
        }
        failure.map_or(Ok(()), Err)
    }

    /// Ferme le fichier ouvert (arrêt).
    pub async fn close(&self) {
        if let Some((_, db)) = self.open.lock().await.take() {
            db.close().await;
        }
    }

    /// Le fichier de l'année en cours, ouvert au besoin ; celui d'une année écoulée se referme.
    async fn current<'a>(
        &self,
        open: &'a mut Option<(i16, StatsDb)>,
        year: i16,
    ) -> Result<&'a StatsDb, DbError> {
        if open
            .as_ref()
            .is_none_or(|(open_year, _)| *open_year != year)
        {
            if let Some((_, previous)) = open.take() {
                previous.close().await;
            }
            let db = StatsDb::open(&Self::path(&self.data_dir, year)).await?;
            pcr_db::stats::mark_year(&db, year).await?;
            *open = Some((year, db));
        }
        Ok(&open.as_ref().expect("opened above").1)
    }

    async fn write_other_year(
        &self,
        year: i16,
        counters: &[(Counter, i64)],
    ) -> Result<(), DbError> {
        let db = StatsDb::open(&Self::path(&self.data_dir, year)).await?;
        let written = async {
            pcr_db::stats::mark_year(&db, year).await?;
            pcr_db::stats::add_all(&db, counters).await
        }
        .await;
        db.close().await;
        written
    }

    fn restore(&self, year: i16, counters: Vec<(Counter, i64)>) {
        let mut pending = self
            .pending
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        for (counter, delta) in counters {
            merge(&mut pending, year, counter, delta);
        }
    }
}

/// Fusionne une valeur dans le tampon : additionnée, ou gardée si c'est un nouveau record.
fn merge(pending: &mut HashMap<(i16, Counter), i64>, year: i16, counter: Counter, value: i64) {
    match pending.entry((year, counter)) {
        Entry::Occupied(mut entry) => {
            let combined = entry.key().1.combine(*entry.get(), value);
            *entry.get_mut() = combined;
        }
        Entry::Vacant(entry) => {
            entry.insert(value);
        }
    }
}

/// Vide le tampon régulièrement, puis une dernière fois à l'arrêt.
pub async fn run(app: App, mut shutdown: watch::Receiver<bool>) {
    loop {
        let stop = tokio::select! {
            () = tokio::time::sleep(FLUSH) => false,
            _ = shutdown.wait_for(|stop| *stop) => true,
        };
        if let Err(error) = app.stats.flush(app.clock.now()).await {
            tracing::error!(
                ?error,
                "writing yearly stats failed, kept for the next batch"
            );
        }
        if stop {
            app.stats.close().await;
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use sqlx::SqlitePool;

    use super::*;

    fn at(s: &str) -> Timestamp {
        s.parse().expect("RFC 3339")
    }

    async fn count(dir: &Path, year: i16, sql: &'static str) -> i64 {
        let pool = SqlitePool::connect(&format!("sqlite://{}", Stats::path(dir, year).display()))
            .await
            .expect("open stats");
        let value: i64 = sqlx::query_scalar(sql).fetch_one(&pool).await.expect(sql);
        pool.close().await;
        value
    }

    #[tokio::test]
    async fn a_batch_flushed_after_midnight_splits_between_the_two_years() {
        let dir = std::env::temp_dir().join(format!("pcr-app-stats-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("temp dir");
        let stats = Stats::new(dir.clone());
        let command = || Counter::Command {
            name: "rappel".to_owned(),
        };

        // 31 décembre 23 h 59 à Paris (22 h 59 UTC), puis 1er janvier 0 h 01.
        stats.add(at("2026-12-31T22:59:00Z"), command(), 2);
        stats.add(at("2026-12-31T23:01:00Z"), command(), 1);
        stats.add(at("2026-12-31T23:01:30Z"), Counter::Reaction { user: 7 }, 1);
        stats
            .flush(at("2026-12-31T23:02:00Z"))
            .await
            .expect("flush");

        // Une réaction retirée en janvier, posée en décembre : le compteur de 2027 reste à zéro.
        stats.add(
            at("2026-12-31T23:05:00Z"),
            Counter::Reaction { user: 7 },
            -2,
        );
        stats
            .flush(at("2026-12-31T23:06:00Z"))
            .await
            .expect("flush");
        stats.close().await;

        assert_eq!(
            count(&dir, 2026, "SELECT count FROM command_stats").await,
            2
        );
        assert_eq!(
            count(&dir, 2027, "SELECT count FROM command_stats").await,
            1
        );
        assert_eq!(
            count(&dir, 2027, "SELECT count FROM reaction_stats").await,
            0
        );
        assert_eq!(
            count(
                &dir,
                2027,
                "SELECT CAST(value AS INTEGER) FROM stats_meta WHERE key = 'year'"
            )
            .await,
            2027
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn a_record_keeps_the_largest_value_through_the_buffer_and_the_base() {
        let dir = std::env::temp_dir().join(format!("pcr-app-stats-max-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let stats = Stats::new(dir.clone());
        let now = at("2026-11-27T12:00:00Z");
        let record = || Counter::BetMaxWin { user: 7 };
        let wagered = || Counter::BetWagered { user: 7 };

        // Le dossier n'existe pas encore : le lot échoue et revient dans le tampon.
        stats.add(now, record(), 50);
        stats.add(now, wagered(), 10);
        assert!(stats.flush(now).await.is_err());
        stats.add(now, record(), 30);
        stats.add(now, wagered(), 20);
        std::fs::create_dir_all(&dir).expect("temp dir");
        stats.flush(now).await.expect("flush");

        // Un record plus petit que celui de la base ne l'écrase pas.
        stats.add(now, record(), 40);
        stats.add(now, Counter::BetMaxWin { user: 8 }, 0);
        let read = stats.bet_stats(now, 7).await.expect("read");
        assert_eq!(
            read,
            BetStats {
                total_wagered: 30,
                max_win: 50,
                server_wagered: 30,
                server_max_win: 50,
                record_holder: Some(7),
            }
        );
        stats.add(now, record(), 90);
        assert_eq!(stats.bet_stats(now, 7).await.expect("read").max_win, 90);
        assert_eq!(
            stats.bet_stats(now, 8).await.expect("read"),
            BetStats {
                total_wagered: 0,
                max_win: 0,
                server_wagered: 30,
                server_max_win: 90,
                record_holder: Some(7),
            }
        );
        stats.close().await;
        std::fs::remove_dir_all(&dir).ok();
    }
}
