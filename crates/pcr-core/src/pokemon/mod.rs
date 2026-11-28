//! Le jeu Pokémon, règles pures : espèces et générations, rareté, poids des tirages, chances de
//! capture, catalogue d'objets, apparitions, lancers, Charme Chroma. Les nombres viennent de
//! `GameConfig` (`pokemon`), la génération jouable se calcule une fois par action
//! (`generation::active`) et se passe aux règles.

pub mod bag;
pub mod capture;
pub mod charms;
pub mod display;
pub mod drop;
pub mod fishing;
pub mod generation;
pub mod items;
pub mod lineage;
pub mod rarity;
pub mod spawn;
pub mod species;
pub mod tables;
pub mod throw;
pub mod weights;

use crate::config::Pokemon;
use species::Species;

/// Verrouillé d'office en arrivant dans une boîte (capture, parc, œuf, échange) : un shiny ou un
/// légendaire, selon `pokemon.lockByDefault`, ne part pas sur un clic distrait. Le dresseur en
/// décide ensuite.
pub fn locked_by_default(config: &Pokemon, species: &Species, shiny: bool) -> bool {
    let lock = &config.lock_by_default;
    (shiny && lock.shiny) || (species.is_legendary() && lock.legendary)
}
