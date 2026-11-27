//! Stockage SQLite.
//!
//! Deux bases cohabitent :
//! - `pcr.db`, permanente : économie, jeu, rappels, sessions, surcharges de config ([`Db`]) ;
//! - `stats-<ANNÉE>.db`, statistiques de l'année ([`StatsDb`]).
//!
//! Toute requête passe par `sqlx::query!`, vérifiée à la compilation contre le schéma que `build.rs`
//! construit depuis `migrations/`. Règle : jamais d'`await` Discord ou HTTP dans une transaction.

pub mod backup;
pub mod bets;
pub mod config;
pub mod import_prod;
pub mod jobs;
pub mod meta;
pub mod migrate_v1;
pub mod points;
mod pool;
pub mod public_messages;
pub mod redistribution;
pub mod stats;

pub use pool::{Db, DbError, StatsDb};

/// La connexion que reçoivent les fonctions des modules : une transaction ou un lecteur. Nommée ici
/// pour que `pcr-app` puisse écrire ses propres étapes sans dépendre de `sqlx`.
pub type Conn = sqlx::SqliteConnection;
/// Une transaction d'écriture ouverte par un cas d'usage (`db.writer().begin()`).
pub type Transaction = sqlx::Transaction<'static, sqlx::Sqlite>;
