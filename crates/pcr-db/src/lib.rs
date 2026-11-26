//! Stockage SQLite.
//!
//! Deux bases cohabitent :
//! - `pcr.db`, permanente : économie, jeu, rappels, sessions, surcharges de config ([`Db`]) ;
//! - `stats-<ANNÉE>.db`, statistiques de l'année ([`StatsDb`]).
//!
//! Toute requête passe par `sqlx::query!`, vérifiée à la compilation contre le schéma que `build.rs`
//! construit depuis `migrations/`. Règle : jamais d'`await` Discord ou HTTP dans une transaction.

pub mod backup;
pub mod config;
pub mod import_prod;
pub mod jobs;
pub mod meta;
pub mod migrate_v1;
mod pool;
pub mod stats;

pub use pool::{Db, DbError, StatsDb};
