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

/// Un faux Discord : il note ce qu'on lui fait envoyer, et peut tomber en panne.
#[derive(Debug, Default)]
pub struct FakeOutbox {
    pub posts: std::sync::Mutex<Vec<(i64, String, Vec<i64>)>>,
    pub threads: std::sync::Mutex<Vec<(i64, String, String)>>,
    pub reminded: std::sync::Mutex<Vec<i64>>,
    /// Membres injoignables en MP.
    pub unreachable: Vec<i64>,
    /// Tout envoi échoue (panne passagère).
    pub down: std::sync::atomic::AtomicBool,
}

impl FakeOutbox {
    fn check(&self) -> Result<(), String> {
        if self.down.load(std::sync::atomic::Ordering::Relaxed) {
            Err("discord down".to_owned())
        } else {
            Ok(())
        }
    }
}

impl crate::outbox::Outbox for FakeOutbox {
    fn post(
        &self,
        channel: i64,
        text: String,
        ping: Vec<i64>,
    ) -> crate::outbox::OutboxFuture<'_, ()> {
        Box::pin(async move {
            self.check()?;
            self.posts.lock().expect("lock").push((channel, text, ping));
            Ok(())
        })
    }

    fn open_thread(
        &self,
        channel: i64,
        name: String,
        text: String,
    ) -> crate::outbox::OutboxFuture<'_, ()> {
        Box::pin(async move {
            self.check()?;
            self.threads
                .lock()
                .expect("lock")
                .push((channel, name, text));
            Ok(())
        })
    }

    fn display_name(&self, user: i64) -> crate::outbox::OutboxFuture<'_, Option<String>> {
        Box::pin(async move { Ok(Some(format!("Membre {user}"))) })
    }

    fn remind<'a>(
        &'a self,
        reminder: &'a crate::outbox::Reminder,
    ) -> crate::outbox::OutboxFuture<'a, crate::outbox::Delivery> {
        Box::pin(async move {
            self.check()?;
            if self.unreachable.contains(&reminder.user_id) {
                return Ok(crate::outbox::Delivery::Unreachable);
            }
            self.reminded.lock().expect("lock").push(reminder.id);
            Ok(crate::outbox::Delivery::Sent)
        })
    }
}

/// Un faux web : une page par adresse, les autres en panne.
#[derive(Debug, Default)]
pub struct FakeWeb(pub std::collections::HashMap<String, String>);

impl crate::outbox::Web for FakeWeb {
    fn get<'a>(
        &'a self,
        url: &'a str,
        _user_agent: &'a str,
    ) -> crate::outbox::OutboxFuture<'a, String> {
        Box::pin(async move {
            self.0
                .get(url)
                .cloned()
                .ok_or_else(|| format!("{url}: unreachable"))
        })
    }
}

impl TestApp {
    /// La même application avec une instance retouchée (salons, `dm_allowlist`…).
    pub fn with_instance(&self, edit: impl FnOnce(&mut Instance)) -> App {
        let mut instance = (*self.app.instance).clone();
        edit(&mut instance);
        App {
            instance: Arc::new(instance),
            ..self.app.clone()
        }
    }
}
