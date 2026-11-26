//! Cas d'usage partagés par le bot Discord et le site.
//!
//! Chaque module de fonctionnalité expose des fonctions qui tiennent dans une transaction et
//! renvoient ce qui s'est passé, plus les événements à publier une fois le commit fait. Les
//! adaptateurs se contentent de traduire les entrées et de rendre les résultats.

pub mod announcements;
pub mod config;
pub mod health;
pub mod jobs;
pub mod members;
pub mod points;
pub mod public_messages;
pub mod redistribution;
pub mod stats;
#[cfg(test)]
mod testing;

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
    /// Une modification de la config à la fois : valider, écrire et recharger d'un tenant, pour
    /// qu'un rechargement lent ne remette pas en service une lecture antérieure à une autre écriture.
    pub(crate) config_writes: Arc<tokio::sync::Mutex<()>>,
    /// Les compteurs de l'année, écrits par lots (`stats::run`).
    pub stats: Arc<stats::Stats>,
    /// Réveille le worker des messages publics (`public_messages_changed`).
    pub public_messages: Arc<tokio::sync::Notify>,
}

impl App {
    pub fn new(db: Db, clock: Arc<dyn Clock>, instance: Instance) -> Self {
        let stats = Arc::new(stats::Stats::new(instance.data_dir.clone()));
        Self {
            db,
            clock,
            instance: Arc::new(instance),
            health: Arc::default(),
            config: Arc::default(),
            config_writes: Arc::default(),
            stats,
            public_messages: Arc::default(),
        }
    }

    /// La configuration de jeu à lire pour une action : une copie cohérente, même si un administrateur
    /// la modifie pendant ce temps.
    pub fn game_config(&self) -> Arc<pcr_core::config::GameConfig> {
        Arc::clone(&self.config.load().config)
    }

    /// À appeler après le commit d'un cas d'usage qui a créé ou changé un message public : le worker
    /// l'écrit sans attendre le rattrapage.
    pub fn public_messages_changed(&self) {
        self.public_messages.notify_one();
    }
}
