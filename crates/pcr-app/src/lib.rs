//! Cas d'usage partagés par le bot Discord et le site.
//!
//! Chaque module de fonctionnalité expose des fonctions qui tiennent dans une transaction et
//! renvoient ce qui s'est passé, plus les événements à publier une fois le commit fait. Les
//! adaptateurs se contentent de traduire les entrées et de rendre les résultats.

pub mod announcements;
pub mod config;
pub mod health;

use std::sync::Arc;

use arc_swap::ArcSwap;

use pcr_core::{clock::Clock, instance::Instance};
use pcr_db::Db;

pub use health::Health;

/// Tout ce dont un cas d'usage a besoin, peu coûteux à cloner.
#[derive(Debug, Clone)]
pub struct App {
    pub db: Db,
    pub clock: Arc<dyn Clock>,
    pub instance: Arc<Instance>,
    pub health: Arc<Health>,
    /// La configuration de jeu en service ; `config::reload` la (re)lit en base.
    pub config: Arc<ArcSwap<config::Snapshot>>,
}

impl App {
    pub fn new(db: Db, clock: Arc<dyn Clock>, instance: Instance) -> Self {
        Self {
            db,
            clock,
            instance: Arc::new(instance),
            health: Arc::default(),
            config: Arc::default(),
        }
    }

    /// La configuration de jeu à lire pour une action : une copie cohérente, même si un administrateur
    /// la modifie pendant ce temps.
    pub fn game_config(&self) -> Arc<pcr_core::config::GameConfig> {
        Arc::clone(&self.config.load().config)
    }
}
