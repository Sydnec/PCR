//! Outils des tests : une `App` sur une base jetable, à une heure figée.

use std::{path::PathBuf, sync::Arc};

use jiff::Timestamp;
use pcr_core::{clock::FixedClock, instance::Instance};
use pcr_db::Db;

use crate::App;

const INSTANCE: &str = include_str!("../../../deploy/instance.example.toml");

/// Une base neuve dans un dossier propre au test, supprimé à la fin.
#[derive(Debug)]
pub struct TestApp {
    pub app: App,
    dir: PathBuf,
}

impl TestApp {
    pub async fn new(name: &str, now: &str) -> Self {
        let dir = std::env::temp_dir().join(format!("pcr-app-{name}-{}", std::process::id()));
        std::fs::remove_dir_all(&dir).ok();
        std::fs::create_dir_all(&dir).expect("temp dir");
        let db = Db::open(&dir.join("pcr.db")).await.expect("open");
        let mut instance = Instance::from_toml(INSTANCE).expect("example instance");
        instance.data_dir.clone_from(&dir);
        let app = App::new(db, Arc::new(FixedClock(at(now))), instance);
        Self { app, dir }
    }

    /// La même application, l'horloge avancée à `now`.
    pub fn at(&self, now: &str) -> App {
        App {
            clock: Arc::new(FixedClock(at(now))),
            ..self.app.clone()
        }
    }

    /// Exécute du SQL brut (préparer un état, provoquer une panne).
    pub async fn sql(&self, query: impl Into<String>) {
        let query = query.into();
        sqlx::raw_sql(sqlx::AssertSqlSafe(query.clone()))
            .execute(self.app.db.writer())
            .await
            .expect(&query);
    }

    pub async fn scalar(&self, query: impl Into<String>) -> i64 {
        let query = query.into();
        sqlx::query_scalar(sqlx::AssertSqlSafe(query.clone()))
            .fetch_one(self.app.db.reader())
            .await
            .expect(&query)
    }

    pub async fn close(self) {
        self.app.db.close().await;
        std::fs::remove_dir_all(&self.dir).ok();
    }
}

pub fn at(s: &str) -> Timestamp {
    s.parse().expect("RFC 3339")
}
