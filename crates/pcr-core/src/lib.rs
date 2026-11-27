//! Domaine pur : règles du jeu, formules, types de configuration et horloge.
//!
//! Ni I/O ni async ici : chaque règle se teste avec une horloge figée et un RNG à graine fixe.
//! Les adaptateurs (Discord, site) vivent dans leurs propres crates.

pub mod bets;
pub mod build;
pub mod changelog;
pub mod clock;
pub mod config;
pub mod format;
pub mod ids;
pub mod instance;
pub mod points;
pub mod redistribution;
pub mod refusal;
pub mod schedule;
pub mod stats;
