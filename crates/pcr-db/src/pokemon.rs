//! Le jeu Pokémon : apparitions et lancers (`spawn`), collections (`collection`), sacs (`items`).
//!
//! Toutes ces tables vivent dans `pcr.db` : une collection traverse les années. Les messages publics
//! du jeu sont dans `public_messages`.

pub mod collection;
pub mod items;
pub mod spawn;
