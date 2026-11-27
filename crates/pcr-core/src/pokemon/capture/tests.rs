//! Valeurs de référence des tests v1 (`test/capture.test.js`, `test/generation2.test.js`).
// Les poids et les chances sont des produits exacts de réglages : l'égalité stricte est voulue,
// comme les `assert.equal` des tests v1.
#![allow(clippy::float_cmp)]

use super::*;
use crate::pokemon::{
    rarity::{Rarity, rarity_of},
    species,
};

fn close(actual: f64, expected: f64) {
    assert!((actual - expected).abs() < 1e-9, "{actual} ≠ {expected}");
}

fn capture(global_multiplier: f64, min_catch_rate: u32) -> Capture {
    Capture {
        global_multiplier,
        min_catch_rate,
        ..Capture::default()
    }
}

fn named(name: &str) -> &'static Species {
    species::all_data()
        .iter()
        .find(|s| s.name == name)
        .unwrap_or_else(|| panic!("{name}"))
}

#[test]
fn the_official_formula_floored_and_bounded() {
    let normal = capture(1.0, 10);
    close(catch_probability(&normal, 45, 1.0), 45.0 / 765.0);
    close(catch_probability(&normal, 255, 2.0), 510.0 / 765.0);
    close(catch_probability(&normal, 120, 4.0), 480.0 / 765.0);
    assert_eq!(catch_probability(&normal, 255, 255.0), 1.0);
    assert_eq!(catch_probability(&capture(100.0, 10), 255, 4.0), 1.0);
    assert_eq!(catch_probability(&capture(0.0, 10), 0, 1.0), 0.0);
    // Le curseur global divise sans changer la hiérarchie.
    close(
        catch_probability(&capture(0.5, 10), 45, 1.0),
        45.0 / 765.0 / 2.0,
    );
    // Le plancher relève un taux plus bas, et la formule le lit.
    assert_eq!(effective_catch_rate(&normal, 3), 10);
    assert_eq!(effective_catch_rate(&normal, 45), 45);
    close(catch_probability(&normal, 3, 4.0), 40.0 / 765.0);
    // À 0, le taux de l'espèce s'applique tel quel ; à 50, il relève aussi Mew.
    close(catch_probability(&capture(1.0, 0), 3, 1.0), 3.0 / 765.0);
    assert_eq!(effective_catch_rate(&capture(1.0, 50), 45), 50);
    assert_eq!(effective_catch_rate(&capture(1.0, 50), 120), 120);
}

#[test]
fn only_legendaries_are_under_the_floor() {
    let normal = Capture::default();
    let under: Vec<_> = species::all(2).filter(|s| s.catch_rate < 10).collect();
    assert!(!under.is_empty() && under.iter().all(|s| s.is_legendary()));
    for name in ["Raikou", "Entei", "Suicune", "Lugia", "Ho-Oh"] {
        let rate = u32::from(named(name).catch_rate);
        assert_eq!(effective_catch_rate(&normal, rate), 10, "{name}");
        assert_eq!(
            difficulty_of(&normal, rate).label,
            "Très difficile",
            "{name}"
        );
    }
    assert_eq!(
        effective_catch_rate(&normal, u32::from(named("Celebi").catch_rate)),
        45
    );
}

#[test]
fn balls_are_announced_in_catalogue_order_with_the_master_ball_guaranteed() {
    let normal = Capture::default();
    let balls = probabilities_by_ball(&normal, 45);
    let keys: Vec<_> = balls.iter().map(|chance| chance.key).collect();
    assert_eq!(keys, ["poke", "super", "hyper", "master"]);
    assert_eq!(balls[3].probability, 1.0);
    assert!(balls[0].probability < balls[1].probability);
    assert!(balls[1].probability < balls[2].probability);
    // Les prix sont proportionnels : toutes les balls coûtent autant par capture espérée.
    let cost = |chance: &BallChance<'_>| f64::from(chance.ball.price) / chance.probability;
    close(cost(&balls[1]), cost(&balls[0]));
    close(cost(&balls[2]), cost(&balls[0]));
    // La Master Ball n'est pas bradée face à un légendaire à taux 10.
    let expected = f64::from(normal.balls.poke.price) / catch_probability(&normal, 10, 1.0);
    assert!(f64::from(normal.balls.master.price) > expected * 0.5);
}

#[test]
fn the_master_ball_price_grows_with_each_purchase() {
    let balls = Capture::default().balls;
    assert!(has_personal_price(&balls.master));
    assert!(!has_personal_price(&balls.poke));
    let prices: Vec<_> = (0..5)
        .map(|paid| price_after(&balls.master, paid))
        .collect();
    assert_eq!(prices, [10_000, 12_000, 14_400, 17_280, 20_736]);
    let steep = Ball {
        price_growth: Some(1000.0),
        ..balls.master.clone()
    };
    assert_eq!(price_after(&steep, 500), 9_007_199_254_740_991);
    for growth in [None, Some(1.0), Some(0.5)] {
        let fixed = Ball {
            price: 100,
            price_growth: growth,
            ..Ball::default()
        };
        assert_eq!(price_after(&fixed, 7), 100, "{growth:?}");
    }
}

#[test]
fn difficulty_cuts_at_the_announced_thresholds() {
    let normal = Capture::default();
    let label = |rate| difficulty_of(&normal, rate).label;
    for (rate, expected) in [
        (255, "Très facile"),
        (190, "Très facile"),
        (189, "Facile"),
        (120, "Facile"),
        (119, "Moyenne"),
        (60, "Moyenne"),
        (45, "Difficile"),
        (40, "Difficile"),
        (39, "Très difficile"),
        (10, "Très difficile"),
        (3, "Très difficile"),
    ] {
        assert_eq!(label(rate), expected, "{rate}");
    }
    assert_eq!(difficulty_of(&normal, 255).level, 0);
    let unfloored = capture(1.0, 0);
    assert_eq!(difficulty_of(&unfloored, 3).label, "Extrême");
    assert_eq!(difficulty_of(&unfloored, 1).level, 5);
}

#[test]
fn rarity_follows_the_stage_a_starter_line_starts_one_step_higher() {
    let config = Pokemon::default();
    let rarity = |name| rarity_of(named(name), &config);
    assert_eq!(rarity("Mewtwo"), Rarity::Legendary);
    assert_eq!(rarity("Mew"), Rarity::Legendary);
    assert_eq!(rarity("Roucarnage"), Rarity::Rare);
    assert_eq!(rarity("Roucoups"), Rarity::Uncommon);
    assert_eq!(rarity("Roucool"), Rarity::Common);
    assert_eq!(rarity("Salamèche"), Rarity::Uncommon);
    assert_eq!(rarity("Reptincel"), Rarity::Rare);
    assert_eq!(rarity("Dracaufeu"), Rarity::VeryRare);
    assert_eq!(
        rarity_of(species::get(152).expect("152"), &config),
        Rarity::Uncommon
    );
    assert_eq!(
        rarity_of(species::get(157).expect("157"), &config),
        Rarity::VeryRare
    );
    // Un bébé compte dans le stade.
    assert_eq!(rarity("Pichu"), Rarity::Common);
    assert_eq!(rarity("Pikachu"), Rarity::Uncommon);
    assert_eq!(rarity("Raichu"), Rarity::Rare);
    assert_eq!(rarity("Celebi"), Rarity::Legendary);
}

#[test]
fn shiny_for_everyone_under_1_and_for_charm_holders_up_to_its_factor() {
    let config = Pokemon::default();
    let roll = |odds, value| roll_shiny(&config, odds, value);
    let none = ShinyRoll {
        shiny: false,
        charm: false,
    };
    assert_eq!(
        roll(500, 0.0),
        ShinyRoll {
            shiny: true,
            ..none
        }
    );
    assert_eq!(
        roll(500, 1.5 / 500.0),
        ShinyRoll {
            charm: true,
            ..none
        }
    );
    assert_eq!(roll(500, 0.5), none);
    // Une chance sur 1 rend tout shiny : `/admin config` refuse de descendre sous 1.
    assert!(roll(1, 0.999).shiny);
    assert!(!roll(2, 0.999).shiny);
    let charmander = named("Salamèche");
    assert_eq!(charm_factor(&config, charmander, &[1]), 2.0);
    assert_eq!(charm_factor(&config, charmander, &[2]), 1.0);
}

#[test]
fn a_special_ball_bonus_needs_its_condition() {
    let config = Pokemon::default();
    let special = &config.capture.special_balls;
    let lure = special.appat.multiplier;
    assert_eq!(
        special_ball_multiplier(&special.appat, &config, false, 129),
        lure
    );
    assert_eq!(
        special_ball_multiplier(&special.appat, &config, true, 129),
        lure * special.appat.bonus.multiplier
    );
    let moon = special.catalyseur.multiplier;
    assert_eq!(
        special_ball_multiplier(&special.catalyseur, &config, false, 95),
        moon * special.catalyseur.bonus.multiplier
    );
    assert_eq!(
        special_ball_multiplier(&special.catalyseur, &config, false, 1),
        moon
    );
}

#[test]
fn shinies_and_legendaries_arrive_locked() {
    let config = Pokemon::default();
    assert!(crate::pokemon::locked_by_default(
        &config,
        named("Mewtwo"),
        false
    ));
    assert!(crate::pokemon::locked_by_default(
        &config,
        named("Salamèche"),
        true
    ));
    assert!(!crate::pokemon::locked_by_default(
        &config,
        named("Salamèche"),
        false
    ));
}
