//! Le poids d'apparition d'une espèce, et le tirage qui en découle. Un seul endroit décide : les
//! apparitions, le parc, le cadenas 🔒 et les tables de `/admin poids` y passent tous.

use std::collections::{BTreeMap, BTreeSet};

use super::{
    fishing, lineage,
    rarity::{Rarity, rarity_of},
    species::{self, Species},
};
use crate::config::{Pokemon, Stages};

/// Un bloc de tirage : les apparitions du salon (`pokemon.spawn`) ou les rencontres du parc
/// (`pokemon.safari`). Même forme, sauf la majoration des générations récentes, que le parc n'a
/// pas : on y choisit sa génération.
#[derive(Debug, Clone, Copy)]
pub struct Pool<'a> {
    pub weights_by_stage: &'a Stages,
    pub very_rare_weight: f64,
    pub legendary_weight: f64,
    pub species_factors: &'a BTreeMap<u16, f64>,
    pub generation_boost: f64,
}

impl<'a> Pool<'a> {
    pub fn spawn(config: &'a Pokemon) -> Self {
        let spawn = &config.spawn;
        Self {
            weights_by_stage: &spawn.weights_by_stage,
            very_rare_weight: spawn.very_rare_weight,
            legendary_weight: spawn.legendary_weight,
            species_factors: &spawn.species_factors,
            generation_boost: spawn.generation_boost,
        }
    }

    pub fn safari(config: &'a Pokemon) -> Self {
        let safari = &config.safari;
        Self {
            weights_by_stage: &safari.weights_by_stage,
            very_rare_weight: safari.very_rare_weight,
            legendary_weight: safari.legendary_weight,
            species_factors: &safari.species_factors,
            generation_boost: 1.0,
        }
    }

    /// Le poids de base d'une rareté : un starter, monté d'un cran, pèse comme le stade d'au-dessus.
    fn rarity_weight(&self, rarity: Rarity) -> f64 {
        let stages = self.weights_by_stage;
        match rarity {
            Rarity::Common => stages.first,
            Rarity::Uncommon => stages.second,
            Rarity::Rare => stages.third,
            Rarity::VeryRare => self.very_rare_weight,
            Rarity::Legendary => self.legendary_weight,
        }
    }

    /// Le facteur propre d'une espèce (Zarbi), 1 sans réglage. Nul ou négatif, il retombe à 1 :
    /// retirer une espèce du pool est le rôle des règles, pas d'une faute de frappe.
    pub fn species_factor(&self, species: &Species) -> f64 {
        self.species_factors
            .get(&species.id)
            .copied()
            .filter(|factor| factor.is_finite() && *factor > 0.0)
            .unwrap_or(1.0)
    }
}

/// Comment on obtient une espèce, ou pourquoi on ne la croisera pas.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Obtention {
    Wild,
    /// Seule une évolution la donne (🔒) : poids nul au salon comme au parc.
    Evolution,
    /// Un bébé, qui ne sort que d'un œuf (🥚).
    Egg,
}

impl Obtention {
    /// La clé des filtres du site et du Pokédex.
    pub fn key(self) -> &'static str {
        match self {
            Self::Wild => "wild",
            Self::Evolution => "evolution",
            Self::Egg => "egg",
        }
    }

    /// Le repère affiché à côté d'une espèce qu'on ne croisera jamais.
    pub fn mark(self) -> &'static str {
        match self {
            Self::Wild => "",
            Self::Evolution => "🔒",
            Self::Egg => "🥚",
        }
    }
}

/// Ce qu'un tirage relit une fois plutôt que pour chacune des 251 espèces : la génération jouable,
/// les formes d'objet, le facteur des espèces pêchables.
#[derive(Debug)]
pub struct Draw<'a> {
    pub config: &'a Pokemon,
    pub generation: u8,
    item_only: BTreeSet<u16>,
    fishing_factor: f64,
}

impl<'a> Draw<'a> {
    pub fn new(config: &'a Pokemon, generation: u8) -> Self {
        Self {
            config,
            generation,
            item_only: lineage::item_only_species(config),
            fishing_factor: fishing::wild_rarity_factor(config, generation),
        }
    }

    /// Une forme qu'un objet est seul à donner.
    pub fn is_item_only(&self, species: &Species) -> bool {
        self.item_only.contains(&species.id)
    }

    /// Le poids d'apparition d'une espèce dans un bloc. Jamais à l'état sauvage : les évolutions par
    /// échange (on les obtient en évoluant ou en échangeant leur pré-évolution, qui garde ainsi sa
    /// valeur), les formes d'objet (l'objet serait un détour) et les bébés (un œuf seulement). Le
    /// poids de la rareté est ensuite majoré par génération après la 1ʳᵉ (plancher 1 : sous 1, le
    /// facteur inverserait l'effet attendu), réduit pour ce qui se pêche, et multiplié par le
    /// facteur propre de l'espèce.
    pub fn weight(&self, species: &'static Species, pool: Pool<'_>) -> f64 {
        if species.trade_evolution || species.baby || self.is_item_only(species) {
            return 0.0;
        }
        let base = pool.rarity_weight(rarity_of(species, self.config));
        let boost = pool.generation_boost.max(1.0);
        let fished = if fishing::is_fishable(species.id) {
            self.fishing_factor
        } else {
            1.0
        };
        let exponent = i32::from(species.generation.saturating_sub(1));
        base * boost.powi(exponent) * fished * pool.species_factor(species)
    }

    /// L'espèce à la position `roll` (dans [0, 1)) du tirage : un cumul dans l'ordre du Pokédex, et
    /// la dernière en filet si l'arrondi passe juste au-dessus du total. `generations` restreint le
    /// tirage (le parc, où l'on vise les siennes). `None` pour un pool vide.
    pub fn pick_at(
        &self,
        pool: Pool<'_>,
        generations: Option<&[u8]>,
        roll: f64,
    ) -> Option<&'static Species> {
        let candidates: Vec<(&'static Species, f64)> = species::all(self.generation)
            .filter(|s| generations.is_none_or(|list| list.contains(&s.generation)))
            .map(|s| (s, self.weight(s, pool)))
            .filter(|(_, weight)| *weight > 0.0)
            .collect();
        let total: f64 = candidates.iter().map(|(_, weight)| weight).sum();
        let target = roll * total;
        let mut cumulative = 0.0;
        for (species, weight) in &candidates {
            cumulative += weight;
            if target < cumulative {
                return Some(species);
            }
        }
        candidates.last().map(|(species, _)| *species)
    }

    /// Comment s'obtient une espèce. Le cadenas se pose sur les DEUX pools : mettre
    /// `weightsByStage.3` à zéro enfermerait tous les stades 3 derrière une évolution sans que rien
    /// ne le dise, et un stade absent du salon reste trouvable si le parc le tire.
    pub fn obtention(&self, species: &'static Species) -> Obtention {
        if species.baby {
            Obtention::Egg
        } else if self.weight(species, Pool::spawn(self.config)) <= 0.0
            && self.weight(species, Pool::safari(self.config)) <= 0.0
        {
            Obtention::Evolution
        } else {
            Obtention::Wild
        }
    }
}

#[cfg(test)]
mod tests;
