//! Le jeu Pokémon : apparitions (`spawn`), lancers (`throws`), objets au sol (`drops`), collections
//! (`collection`), sacs (`items`) et balls de la boutique en poche (`units`).
//!
//! Toutes ces tables vivent dans `pcr.db` : une collection traverse les années. Les messages publics
//! du jeu sont dans `public_messages`.

pub mod collection;
pub mod drops;
pub mod items;
pub mod spawn;
pub mod throws;
pub mod units;
