//! La rareté d'une espèce : son stade, un cran plus haut pour une lignée de starter, à part pour les
//! légendaires. Elle décide du poids d'apparition, de la revente et de la mention du rôle : tout se
//! lit dans la rareté.

use super::species::{self, Species};
use crate::config::Pokemon;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Rarity {
    Common,
    Uncommon,
    Rare,
    /// Entre rare et légendaire : le stade 3 d'une lignée de starter (Dracaufeu).
    VeryRare,
    Legendary,
}

impl Rarity {
    /// La clé v1, telle qu'elle s'écrit en base (`pokemon_spawns.rarity`) et dans la config
    /// (`sell.byRarity`, `spawn.pingRarities`).
    pub fn key(self) -> &'static str {
        match self {
            Self::Common => "COMMUN",
            Self::Uncommon => "PEU_COMMUN",
            Self::Rare => "RARE",
            Self::VeryRare => "TRES_RARE",
            Self::Legendary => "LEGENDAIRE",
        }
    }

    pub fn from_key(key: &str) -> Option<Self> {
        [
            Self::Common,
            Self::Uncommon,
            Self::Rare,
            Self::VeryRare,
            Self::Legendary,
        ]
        .into_iter()
        .find(|rarity| rarity.key() == key)
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Common => "Commun",
            Self::Uncommon => "Peu commun",
            Self::Rare => "Rare",
            Self::VeryRare => "Très rare",
            Self::Legendary => "Légendaire",
        }
    }

    pub fn icon(self) -> &'static str {
        match self {
            Self::Common => "⚪",
            Self::Uncommon => "🟢",
            Self::Rare => "🔵",
            Self::VeryRare => "🟣",
            Self::Legendary => "🟠",
        }
    }

    /// La rareté ordinaire d'un stade (1 à 3), décalée de `step` crans (1 pour un starter).
    fn of_stage(stage: u8, step: u8) -> Self {
        match stage.clamp(1, 3) + step {
            1 => Self::Common,
            2 => Self::Uncommon,
            3 => Self::Rare,
            _ => Self::VeryRare,
        }
    }
}

/// La forme de base d'une lignée, en remontant `evolves_from` (générations fermées comprises : un
/// starter de 2ᵉ génération est déjà un starter). Le garde-fou protège d'un cycle dans les données.
fn line_root(species: &'static Species) -> &'static Species {
    let mut root = species;
    let mut climbed = vec![root.id];
    while let Some(parent) = root.evolves_from.and_then(species::get) {
        if climbed.contains(&parent.id) {
            break;
        }
        climbed.push(parent.id);
        root = parent;
    }
    root
}

pub fn is_starter_line(species: &'static Species, config: &Pokemon) -> bool {
    config.starter_lines.contains(&line_root(species).id)
}

pub fn rarity_of(species: &'static Species, config: &Pokemon) -> Rarity {
    if species.is_legendary() {
        return Rarity::Legendary;
    }
    Rarity::of_stage(species.stage, u8::from(is_starter_line(species, config)))
}
