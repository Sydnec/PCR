//! Use-cases shared by the Discord bot and the website.
//!
//! Each feature module exposes functions that run inside one DB transaction and return what
//! happened plus the events to publish once committed. Adapters only translate inputs and
//! render outcomes.

pub mod health;

use std::sync::Arc;

use pcr_core::{clock::Clock, instance::Instance};
use pcr_db::Db;

pub use health::Health;

/// Everything a use-case needs, cheap to clone.
#[derive(Debug, Clone)]
pub struct App {
    pub db: Db,
    pub clock: Arc<dyn Clock>,
    pub instance: Arc<Instance>,
    pub health: Arc<Health>,
}

impl App {
    pub fn new(db: Db, clock: Arc<dyn Clock>, instance: Instance) -> Self {
        Self {
            db,
            clock,
            instance: Arc::new(instance),
            health: Arc::default(),
        }
    }
}
