//! Les tables de pêche officielles (`data/fishing.json`) : pour chaque canne, des espèces et leur
//! taux. Ici, ce que les apparitions en savent : une espèce qui se pêche est plus rare à l'état
//! sauvage, une fois la pêche ouverte.

use crate::config::Pokemon;

include!(concat!(env!("OUT_DIR"), "/fishing.rs"));

/// Une espèce qu'au moins une canne peut sortir.
pub fn is_fishable(species: u16) -> bool {
    RODS.iter()
        .any(|(_, pool)| pool.iter().any(|(id, _)| *id == species))
}

/// La pêche s'ouvre avec sa génération (`fishing.generation`), et rien ne change avant.
pub fn is_open(config: &Pokemon, generation: u8) -> bool {
    generation >= config.fishing.generation
}

/// Le facteur des espèces pêchables à l'état sauvage (`fishing.wildRarityFactor`), 1 tant que la
/// pêche est fermée. `generation` : la pêche telle qu'elle était alors (le bilan d'une saison close
/// ne compte pas la rareté d'une pêche qui n'existait pas encore).
pub fn wild_rarity_factor(config: &Pokemon, generation: u8) -> f64 {
    let factor = config.fishing.wild_rarity_factor;
    if is_open(config, generation) && factor.is_finite() && factor > 0.0 {
        factor
    } else {
        1.0
    }
}

#[cfg(test)]
#[allow(clippy::float_cmp)] // Des réglages relus tels quels : l'égalité stricte est voulue.
mod tests {
    use super::*;
    use crate::pokemon::species;

    #[test]
    fn magikarp_is_fished_and_bulbasaur_is_not() {
        let magikarp = species::all_data().iter().find(|s| s.slug == "magikarp");
        assert!(magikarp.is_some_and(|s| is_fishable(s.id)));
        assert!(!is_fishable(1));
    }

    #[test]
    fn the_wild_factor_waits_for_fishing_to_open() {
        let config = Pokemon::default();
        assert_eq!(wild_rarity_factor(&config, 1), 1.0);
        assert_eq!(
            wild_rarity_factor(&config, 2),
            config.fishing.wild_rarity_factor
        );
        let off = Pokemon {
            fishing: crate::config::Fishing {
                wild_rarity_factor: 0.0,
                ..config.fishing.clone()
            },
            ..config
        };
        assert_eq!(wild_rarity_factor(&off, 2), 1.0);
    }
}
