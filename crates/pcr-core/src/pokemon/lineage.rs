//! Les lignées : vers quoi une espèce évolue, ce qu'un objet est seul à donner, ce qu'un échange
//! fait évoluer. Les données relient les générations entre elles (Onix → Steelix, Pichu → Pikachu),
//! mais une évolution vers une génération fermée n'existe pas encore pour les joueurs.

use std::collections::{BTreeMap, BTreeSet, VecDeque};

use super::species::{self, Species};
use crate::config::Pokemon;

/// Les évolutions jouables d'une espèce : une cible d'une génération fermée serait une porte
/// dérobée vers une espèce qu'on ne peut pas même consulter.
pub fn targets(species: &Species, generation: u8) -> Vec<&'static Species> {
    species
        .evolves_into
        .iter()
        .filter_map(|id| species::available(*id, generation))
        .collect()
}

/// Les formes qu'un objet est seul à donner (Joliflor, Steelix…), toutes lignées confondues : le
/// catalogue le dit (`evolution.targets`), jamais une liste écrite ici.
pub fn item_only_species(config: &Pokemon) -> BTreeSet<u16> {
    config
        .items
        .entries()
        .into_iter()
        .filter(|(_, item)| item.label.is_some())
        .filter_map(|(_, item)| item.evolution.as_ref()?.targets.as_ref())
        .flat_map(|targets| targets.values().copied())
        .collect()
}

/// Les formes qu'un objet est seul à donner pour cette espèce, avec le nom des objets : la Roche
/// Royale fait de Têtarte un Tarpaud. Sans l'objet, elles sont hors de portée.
pub fn item_only_targets<'a>(
    species: &Species,
    config: &'a Pokemon,
) -> BTreeMap<u16, Vec<&'a str>> {
    let mut gated: BTreeMap<u16, Vec<&str>> = BTreeMap::new();
    for (_, item) in config.items.entries() {
        let Some(label) = item.label.as_deref() else {
            continue;
        };
        let target = item
            .evolution
            .as_ref()
            .and_then(|evolution| evolution.targets.as_ref()?.get(&species.id));
        if let Some(target) = target {
            gated.entry(*target).or_default().push(label);
        }
    }
    gated
}

/// Les espèces que l'objet `key` fait évoluer (le Catalyseur pour Onix, Insécateur, Hypocéan et
/// Porygon), lues dans le catalogue.
pub fn species_evolving_with(config: &Pokemon, key: &str) -> BTreeSet<u16> {
    config
        .items
        .entries()
        .into_iter()
        .find(|(k, _)| *k == key)
        .and_then(|(_, item)| item.evolution.as_ref()?.targets.as_ref())
        .map(|targets| targets.keys().copied().collect())
        .unwrap_or_default()
}

/// La cible d'une évolution par échange : Kadabra, Machopeur, Gravalanch et Spectrum. Les données
/// marquent aussi six formes de 2ᵉ génération, mais il leur faut un objet : c'est lui qui les donne,
/// l'échange ne les fait pas évoluer. Le marqueur est sur la cible, la source se déduit.
pub fn trade_evolution_target(
    species: &Species,
    generation: u8,
    config: &Pokemon,
) -> Option<&'static Species> {
    let gated = item_only_targets(species, config);
    targets(species, generation)
        .into_iter()
        .find(|target| target.trade_evolution && !gated.contains_key(&target.id))
}

/// La lignée complète, de la forme de base aux évolutions les plus avancées : on remonte, puis on
/// redescend en largeur, si bien qu'on retrouve la même lignée de n'importe quel maillon. Les
/// garde-fous sur les identifiants vus protègent d'un cycle dans les données.
pub fn chain(species: &'static Species, generation: u8) -> Vec<&'static Species> {
    let mut root = species;
    let mut climbed = vec![root.id];
    while let Some(parent) = root
        .evolves_from
        .and_then(|id| species::available(id, generation))
    {
        if climbed.contains(&parent.id) {
            break;
        }
        climbed.push(parent.id);
        root = parent;
    }
    let mut chain = Vec::new();
    let mut queue = VecDeque::from([root]);
    while let Some(current) = queue.pop_front() {
        if chain.iter().any(|seen: &&Species| seen.id == current.id) {
            continue;
        }
        chain.push(current);
        queue.extend(targets(current, generation));
    }
    chain
}

#[cfg(test)]
mod tests {
    use super::*;

    fn named(name: &str) -> &'static Species {
        species::all_data()
            .iter()
            .find(|s| s.name == name)
            .unwrap_or_else(|| panic!("{name}"))
    }

    fn names(list: &[&'static Species]) -> Vec<&'static str> {
        list.iter().map(|s| s.name).collect()
    }

    #[test]
    fn a_lineage_is_the_same_from_any_link() {
        let full = ["Bulbizarre", "Herbizarre", "Florizarre"];
        for name in full {
            assert_eq!(names(&chain(named(name), 1)), full, "{name}");
        }
        assert_eq!(
            names(&chain(named("Évoli"), 1)),
            ["Évoli", "Aquali", "Voltali", "Pyroli"]
        );
        assert_eq!(names(&chain(named("Tauros"), 1)), ["Tauros"]);
        // La 2ᵉ génération ajoute les bébés en amont et les nouvelles branches.
        assert_eq!(
            names(&chain(named("Raichu"), 2)),
            ["Pichu", "Pikachu", "Raichu"]
        );
    }

    #[test]
    fn every_lineage_is_well_formed() {
        for entry in species::all(2) {
            let ids = |s| {
                let mut ids: Vec<u16> = chain(s, 2).iter().map(|link| link.id).collect();
                ids.sort_unstable();
                ids
            };
            let own = ids(entry);
            assert!(own.contains(&entry.id), "{}", entry.name);
            assert!(own.windows(2).all(|w| w[0] < w[1]), "{}", entry.name);
            for link in chain(entry, 2) {
                assert_eq!(ids(link), own, "{} / {}", entry.name, link.name);
            }
            for target in targets(entry, 2) {
                assert!(
                    target.stage >= entry.stage,
                    "{} → {}",
                    entry.name,
                    target.name
                );
            }
        }
    }

    #[test]
    fn the_seven_item_only_forms_and_the_four_trade_evolutions() {
        let config = Pokemon::default();
        let mut gated: Vec<&str> = item_only_species(&config)
            .into_iter()
            .map(|id| species::get(id).expect("species").name)
            .collect();
        gated.sort_unstable();
        assert_eq!(
            gated,
            [
                "Cizayox", "Hyporoi", "Joliflor", "Porygon2", "Roigada", "Steelix", "Tarpaud"
            ]
        );
        for (from, to) in [
            ("Kadabra", "Alakazam"),
            ("Machopeur", "Mackogneur"),
            ("Gravalanch", "Grolem"),
            ("Spectrum", "Ectoplasma"),
        ] {
            let target = trade_evolution_target(named(from), 2, &config);
            assert_eq!(target.map(|s| s.name), Some(to));
        }
        // Onix évolue avec le Catalyseur, pas par échange.
        assert!(trade_evolution_target(named("Onix"), 2, &config).is_none());
        assert_eq!(
            item_only_targets(named("Têtarte"), &config).get(&186),
            Some(&vec!["Roche Royale"])
        );
        assert!(species_evolving_with(&config, "catalyseur").contains(&95));
    }
}
