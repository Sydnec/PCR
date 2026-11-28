//! Le Charme Chroma, un par génération : il récompense le Pokédex complet d'une génération, hors
//! légendaires et fabuleux (on ne les chasse pas), et son porteur voit plus de shiny parmi les Pokémon
//! de cette génération (`shinyCharm.multiplier`).
//!
//! C'est un objet d'inventaire donné une fois pour toutes : le dernier exemplaire d'une espèce ne
//! part jamais, un Pokédex complété le reste.

use std::collections::BTreeSet;

use super::{
    capture, generation,
    items::{self, CatalogueItem},
    species::{self, Species},
};
use crate::{config::Pokemon, format};

/// Les espèces qu'il faut posséder pour le charme d'une génération (bébés compris).
pub fn required(generation: u8) -> impl Iterator<Item = &'static Species> {
    species::all_data()
        .iter()
        .filter(move |species| species.generation == generation && !species.is_legendary())
}

/// Les charmes que mérite un dresseur qui possède `owned` (numéros d'espèces), parmi les générations
/// ouvertes : une génération fermée n'a pas de charme, ses espèces ne sont pas encore dans le jeu.
pub fn earned<'a>(
    config: &'a Pokemon,
    active: u8,
    owned: &BTreeSet<u16>,
) -> Vec<(u8, CatalogueItem<'a>)> {
    (1..=active)
        .filter_map(|generation| {
            let item = items::charm_item(config, generation)?;
            let mut needed = required(generation).peekable();
            needed.peek()?;
            needed
                .all(|species| owned.contains(&species.id))
                .then_some((generation, item))
        })
        .collect()
}

/// Les générations dont le dresseur porte le charme, d'après les objets de son sac.
pub fn held<'a>(config: &Pokemon, keys: impl IntoIterator<Item = &'a str>) -> Vec<u8> {
    let charms: Vec<(&str, u8)> = items::all(config)
        .filter_map(|item| Some((item.key, item.item.charm.as_ref()?.generation)))
        .collect();
    keys.into_iter()
        .filter_map(|key| charms.iter().find_map(|(k, g)| (*k == key).then_some(*g)))
        .collect()
}

/// L'annonce dans le salon des apparitions, texte de la v1 : le dresseur y est mentionné.
pub fn announcement(
    config: &Pokemon,
    user: i64,
    generation: u8,
    item: &CatalogueItem<'_>,
) -> String {
    let count = i64::try_from(required(generation).count()).unwrap_or(i64::MAX);
    format!(
        "🎉 <@{user}> complète le Pokédex de la {} génération — {} espèces, hors légendaires — et \
         reçoit le {} **{}** : chances de shiny ×{} sur les Pokémon de cette génération !",
        generation::ordinal(generation),
        format::number(count),
        item.emoji,
        item.label,
        format::decimal(capture::charm_multiplier(config))
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_required_species_are_those_of_the_generation_without_legendaries() {
        assert_eq!(required(1).count(), 146);
        assert_eq!(required(2).count(), 94);
        assert!(required(1).all(|s| s.name != "Mewtwo" && s.name != "Mew"));
    }

    #[test]
    fn a_complete_pokedex_earns_the_charm_of_an_open_generation_only() {
        let config = Pokemon::default();
        let mut owned: BTreeSet<u16> = required(1).map(|s| s.id).collect();
        let earned_now = |owned: &BTreeSet<u16>, active| {
            earned(&config, active, owned)
                .into_iter()
                .map(|(generation, _)| generation)
                .collect::<Vec<_>>()
        };
        assert_eq!(earned_now(&owned, 1), [1]);
        owned.remove(&16);
        assert!(earned_now(&owned, 1).is_empty(), "il manque Roucool");
        owned.insert(16);
        owned.extend(required(2).map(|s| s.id));
        assert_eq!(earned_now(&owned, 1), [1], "génération 2 fermée");
        assert_eq!(earned_now(&owned, 2), [1, 2]);
    }

    #[test]
    fn the_charms_held_read_from_the_bag() {
        let config = Pokemon::default();
        assert_eq!(
            held(&config, ["pepite", "charme_chroma_2", "ball_poke"]),
            [2]
        );
        let item = items::charm_item(&config, 1).expect("charm");
        let text = announcement(&config, 42, 1, &item);
        assert!(
            text.starts_with("🎉 <@42> complète le Pokédex de la 1re génération — 146 espèces")
        );
        assert!(text.ends_with("chances de shiny ×2 sur les Pokémon de cette génération !"));
    }
}
