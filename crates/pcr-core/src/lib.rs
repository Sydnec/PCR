//! Pure domain: game rules, formulas, configuration types and the clock.
//!
//! No I/O and no async here, so every rule can be unit-tested with a frozen clock and a
//! seeded RNG. Adapters (Discord, website) live in their own crates.

pub mod build;
pub mod clock;
pub mod instance;
