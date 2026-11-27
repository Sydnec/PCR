//! Valeurs de référence des tests v1 (`test/capture.test.js`, `test/generation2.test.js`).
// Les poids et les chances sont des produits exacts de réglages : l'égalité stricte est voulue,
// comme les `assert.equal` des tests v1.
#![allow(clippy::float_cmp)]

use super::*;
use crate::config::Fishing;

fn named(name: &str) -> &'static Species {
    species::all_data()
        .iter()
        .find(|s| s.name == name)
        .unwrap_or_else(|| panic!("{name}"))
}

/// La 2ᵉ génération, sans la rareté des espèces pêchables : ces tests ne parlent que des générations.
fn gen2() -> Pokemon {
    Pokemon {
        fishing: Fishing {
            wild_rarity_factor: 1.0,
            ..Fishing::default()
        },
        ..Pokemon::default()
    }
}

#[test]
fn the_weight_follows_the_stage_and_the_legendary_weight() {
    let config = Pokemon::default();
    let draw = Draw::new(&config, 1);
    let spawn = Pool::spawn(&config);
    let stages = &config.spawn.weights_by_stage;
    assert_eq!(draw.weight(named("Roucool"), spawn), stages.first);
    assert_eq!(draw.weight(named("Roucoups"), spawn), stages.second);
    assert_eq!(draw.weight(named("Roucarnage"), spawn), stages.third);
    assert_eq!(
        draw.weight(named("Mewtwo"), spawn),
        config.spawn.legendary_weight
    );
}

#[test]
fn a_starter_weighs_like_the_stage_above_and_its_stage_3_like_a_very_rare() {
    let config = Pokemon::default();
    let draw = Draw::new(&config, 1);
    let spawn = Pool::spawn(&config);
    let stages = &config.spawn.weights_by_stage;
    assert_eq!(draw.weight(named("Salamèche"), spawn), stages.second);
    assert_eq!(draw.weight(named("Reptincel"), spawn), stages.third);
    assert_eq!(
        draw.weight(named("Dracaufeu"), spawn),
        config.spawn.very_rare_weight
    );
    assert_eq!(
        draw.weight(named("Dracaufeu"), Pool::safari(&config)),
        config.safari.very_rare_weight
    );
}

#[test]
fn trade_evolutions_item_forms_and_babies_never_appear() {
    let config = gen2();
    let draw = Draw::new(&config, 2);
    for name in [
        "Alakazam",
        "Mackogneur",
        "Grolem",
        "Ectoplasma",
        "Steelix",
        "Joliflor",
    ] {
        assert_eq!(
            draw.weight(named(name), Pool::spawn(&config)),
            0.0,
            "{name}"
        );
        assert_eq!(draw.obtention(named(name)), Obtention::Evolution, "{name}");
        assert_eq!(draw.obtention(named(name)).mark(), "🔒");
    }
    for baby in species::all(2).filter(|s| s.baby) {
        assert_eq!(
            draw.weight(baby, Pool::spawn(&config)),
            0.0,
            "{}",
            baby.name
        );
        assert_eq!(
            draw.weight(baby, Pool::safari(&config)),
            0.0,
            "{}",
            baby.name
        );
        assert_eq!(draw.obtention(baby).mark(), "🥚");
    }
    // Un pool privé des stades 3 les enferme derrière une évolution, et le cadenas suit.
    let mut no_stage_3 = gen2();
    no_stage_3.spawn.weights_by_stage.third = 0.0;
    no_stage_3.safari.weights_by_stage.third = 0.0;
    let draw = Draw::new(&no_stage_3, 2);
    assert_eq!(draw.obtention(named("Roucarnage")), Obtention::Evolution);
    assert_eq!(draw.obtention(named("Roucool")), Obtention::Wild);
}

#[test]
fn every_species_can_be_obtained() {
    let config = gen2();
    let draw = Draw::new(&config, 2);
    for entry in species::all(2) {
        let mut current = entry;
        let mut climbed = 0;
        while draw.weight(current, Pool::spawn(&config)) <= 0.0 && !current.baby && climbed < 3 {
            current = current
                .evolves_from
                .and_then(species::get)
                .unwrap_or(current);
            climbed += 1;
        }
        let reachable = draw.weight(current, Pool::spawn(&config)) > 0.0 || current.baby;
        assert!(
            reachable,
            "{} : rien d'obtenable dans sa lignée",
            entry.name
        );
    }
}

#[test]
fn recent_generations_are_boosted_on_the_channel_but_not_at_the_park() {
    let config = gen2();
    let draw = Draw::new(&config, 2);
    let (spawn, safari) = (Pool::spawn(&config), Pool::safari(&config));
    let first = config.spawn.weights_by_stage.first;
    assert_eq!(draw.weight(named("Roucool"), spawn), first);
    assert_eq!(draw.weight(named("Fouinette"), spawn), 2.0 * first);
    assert_eq!(
        draw.weight(named("Lugia"), spawn),
        2.0 * config.spawn.legendary_weight
    );
    let park = config.safari.weights_by_stage.first;
    assert_eq!(draw.weight(named("Fouinette"), safari), park);
    // Le facteur se cumule : une 3ᵉ génération pèserait quatre fois la 1ʳᵉ.
    let third: &'static Species = Box::leak(Box::new(Species {
        generation: 3,
        ..*named("Roucool")
    }));
    assert_eq!(draw.weight(third, spawn), 4.0 * first);
    // À ×1, ou sous 1, les générations pèsent pareil plutôt que d'inverser l'effet.
    for boost in [1.0, 0.5, 0.0] {
        let mut flat = gen2();
        flat.spawn.generation_boost = boost;
        let draw = Draw::new(&flat, 2);
        assert_eq!(
            draw.weight(named("Fouinette"), Pool::spawn(&flat)),
            first,
            "{boost}"
        );
    }
}

#[test]
fn the_first_generation_keeps_its_weights_when_the_second_opens() {
    let config = gen2();
    let (before, after) = (Draw::new(&config, 1), Draw::new(&config, 2));
    let spawn = Pool::spawn(&config);
    for entry in species::all(1) {
        assert_eq!(
            before.weight(entry, spawn),
            after.weight(entry, spawn),
            "{}",
            entry.name
        );
    }
}

#[test]
fn unown_weighs_its_own_factor_times_a_stage_1_of_its_generation() {
    let config = gen2();
    let draw = Draw::new(&config, 2);
    for pool in [Pool::spawn(&config), Pool::safari(&config)] {
        assert_eq!(
            draw.weight(named("Zarbi"), pool),
            2.0 * draw.weight(named("Fouinette"), pool)
        );
    }
    // Un facteur nul ou négatif ne retire personne du pool.
    for factor in [0.0, -1.0] {
        let mut odd = gen2();
        odd.spawn.species_factors.insert(201, factor);
        let draw = Draw::new(&odd, 2);
        let spawn = Pool::spawn(&odd);
        assert_eq!(
            draw.weight(named("Zarbi"), spawn),
            draw.weight(named("Fouinette"), spawn),
            "{factor}"
        );
    }
}

#[test]
fn fished_species_are_rarer_in_the_wild_once_fishing_opens() {
    let config = Pokemon::default();
    let spawn = Pool::spawn(&config);
    let magikarp = named("Magicarpe");
    let stage_1 = config.spawn.weights_by_stage.first;
    assert_eq!(Draw::new(&config, 1).weight(magikarp, spawn), stage_1);
    let factor = config.fishing.wild_rarity_factor;
    assert!((Draw::new(&config, 2).weight(magikarp, spawn) - stage_1 * factor).abs() < 1e-9);
}

#[test]
fn the_draw_covers_its_pool_from_first_to_last() {
    let config = gen2();
    let draw = Draw::new(&config, 2);
    let spawn = Pool::spawn(&config);
    let pool: Vec<_> = species::all(2)
        .filter(|s| draw.weight(s, spawn) > 0.0)
        .collect();
    assert_eq!(
        draw.pick_at(spawn, None, 0.0).map(|s| s.id),
        Some(pool[0].id)
    );
    assert_eq!(
        draw.pick_at(spawn, None, 0.999_999_9).map(|s| s.id),
        pool.last().map(|s| s.id)
    );
    // Juste au-delà de la part de la 1ʳᵉ génération quand la 2ᵉ compte double : une espèce de la 2ᵉ.
    let mut only_stage_1 = gen2();
    only_stage_1.spawn.weights_by_stage = Stages {
        first: 1.0,
        second: 0.0,
        third: 0.0,
    };
    only_stage_1.spawn.very_rare_weight = 0.0;
    only_stage_1.spawn.legendary_weight = 0.0;
    only_stage_1.spawn.species_factors.clear();
    let draw = Draw::new(&only_stage_1, 2);
    let spawn = Pool::spawn(&only_stage_1);
    let count = |g| {
        species::all(2)
            .filter(|s| s.generation == g && draw.weight(s, spawn) > 0.0)
            .count()
    };
    #[allow(clippy::cast_precision_loss)] // Quelques centaines d'espèces.
    let (n1, n2) = (count(1) as f64, count(2) as f64);
    let roll = n1 / (n1 + 2.0 * n2) + 1e-6;
    assert_eq!(
        draw.pick_at(spawn, None, roll).map(|s| s.generation),
        Some(2)
    );
    assert_eq!(
        draw.pick_at(spawn, None, roll - 2e-6).map(|s| s.generation),
        Some(1)
    );
    // Le parc vise ses générations.
    let safari = Pool::safari(&config);
    let draw = Draw::new(&config, 2);
    assert_eq!(
        draw.pick_at(safari, Some(&[2]), 0.0).map(|s| s.generation),
        Some(2)
    );
    // Un pool vide ne donne rien plutôt que de planter.
    let mut empty = gen2();
    empty.spawn.weights_by_stage = Stages::default();
    empty.spawn.very_rare_weight = 0.0;
    empty.spawn.legendary_weight = 0.0;
    assert!(
        Draw::new(&empty, 2)
            .pick_at(Pool::spawn(&empty), None, 0.5)
            .is_none()
    );
}
