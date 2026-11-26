//! SQLite storage.
//!
//! Two databases live side by side:
//! - `pcr.db`, persistent: economy, game, reminders, sessions, config overrides ([`Db`]);
//! - `stats-<YEAR>.db`, yearly statistics (added in P2).
//!
//! Every query goes through `sqlx::query!`, checked at compile time against the schema built
//! by `build.rs` from `migrations/`. Rule: never await Discord or HTTP inside a transaction.

pub mod meta;
mod pool;

pub use pool::{Db, DbError};
