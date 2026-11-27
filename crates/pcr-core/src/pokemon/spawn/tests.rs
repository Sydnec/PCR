//! Valeurs de référence des tests v1 (`test/spawn.test.js`, `test/spawn-lifecycle.test.js`).

use rand::{SeedableRng as _, rngs::StdRng};

use super::*;
use crate::config::{Pokemon, Range};

const MINUTE: i64 = 60_000;
const NOW: i64 = 1_000_000_000;

fn named(name: &str) -> &'static Species {
    crate::pokemon::species::all_data()
        .iter()
        .find(|s| s.name == name)
        .unwrap_or_else(|| panic!("{name}"))
}

fn spawn_config(min: u32, max: u32, multiplier: f64) -> Spawn {
    Spawn {
        flee_after_minutes: Range { min, max },
        legendary_flee_multiplier: multiplier,
        ..Spawn::default()
    }
}

/// La durée de vie en minutes, pour un tirage `roll`.
#[allow(clippy::cast_precision_loss)] // Quelques heures en millisecondes : exact en f64.
fn minutes(roll: f64, rarity: Rarity, config: &Spawn) -> f64 {
    flee_deadline(0, config, rarity, roll) as f64 / 60_000.0
}

#[test]
fn the_lifetime_falls_in_the_range_bounds_included() {
    let config = spawn_config(45, 90, 2.0);
    assert!((minutes(0.0, Rarity::Common, &config) - 45.0).abs() < 1e-9);
    assert!((minutes(0.999_999, Rarity::Common, &config) - 90.0).abs() < 0.001);
    assert!((minutes(0.5, Rarity::Rare, &config) - 67.5).abs() < 1e-9);
    // Elle part de l'instant de l'apparition.
    assert_eq!(
        flee_deadline(1_000_000, &config, Rarity::Common, 0.0),
        1_000_000 + 45 * MINUTE
    );
}

#[test]
fn a_legendary_stays_longer_but_never_shorter() {
    let twice = spawn_config(45, 90, 2.0);
    assert!((minutes(0.0, Rarity::Legendary, &twice) - 90.0).abs() < 1e-9);
    assert!((minutes(0.999_999, Rarity::Legendary, &twice) - 180.0).abs() < 0.001);
    let thrice = spawn_config(45, 90, 3.0);
    assert!((minutes(0.0, Rarity::Legendary, &thrice) - 135.0).abs() < 1e-9);
    assert!((minutes(0.999_999, Rarity::Legendary, &thrice) - 270.0).abs() < 0.001);
    for bad in [0.0, 0.5, -2.0, f64::NAN] {
        let config = spawn_config(45, 90, bad);
        assert!(
            (minutes(0.0, Rarity::Legendary, &config) - 45.0).abs() < 1e-9,
            "facteur {bad}"
        );
    }
    // Avec les réglages du jeu, un légendaire dépasse toujours la durée minimale d'un autre.
    let defaults = Spawn::default();
    assert!(
        flee_deadline(0, &defaults, Rarity::Legendary, 0.0)
            > flee_deadline(0, &defaults, Rarity::Common, 0.0)
    );
}

#[test]
fn a_range_given_backwards_reads_forwards() {
    let config = spawn_config(90, 45, 2.0);
    assert!((minutes(0.0, Rarity::Common, &config) - 45.0).abs() < 1e-9);
    assert!((minutes(0.999_999, Rarity::Common, &config) - 90.0).abs() < 0.001);
}

/// Le seuil de messages et le délai sont atteints, sauf ce que le scénario précise.
fn channel() -> Channel {
    Channel {
        message_count: 1000,
        last_spawn_at: NOW - 60 * MINUTE,
        paused_until: 0,
        active: None,
        last_end: None,
    }
}

fn by_message(channel: &Channel) -> bool {
    claims(Cause::Message, channel, NOW, &Spawn::default())
}

#[test]
fn a_message_fills_an_empty_channel_or_replaces_an_ordinary_pokemon() {
    let fresh = Channel {
        message_count: 1,
        last_spawn_at: NOW,
        ..channel()
    };
    assert!(by_message(&fresh), "un salon vide reçoit un Pokémon");
    let common = Channel {
        active: Some(Rarity::Common),
        ..channel()
    };
    assert!(by_message(&common), "seuil et délai atteints : remplacé");

    let needed = i64::from(Spawn::default().messages_per_spawn);
    let under = Channel {
        message_count: needed - 1,
        ..common
    };
    assert!(!by_message(&under), "sous le seuil, rien ne bouge");
    let at = Channel {
        message_count: needed,
        ..common
    };
    assert!(by_message(&at), "le seuil atteint, ce message remplace");
    let young = Channel {
        last_spawn_at: NOW,
        ..common
    };
    assert!(
        !by_message(&young),
        "le délai minimum protège un nouveau venu"
    );
}

#[test]
fn messages_never_chase_a_legendary() {
    let legendary = Channel {
        message_count: 50_000,
        active: Some(Rarity::Legendary),
        ..channel()
    };
    assert!(!by_message(&legendary));
    // Parti, le message suivant fait apparaître le prochain.
    let gone = Channel {
        active: None,
        last_end: Some(NOW - 1000),
        ..legendary
    };
    assert!(by_message(&gone));
}

#[test]
fn a_safari_park_pauses_everything_but_the_administrator() {
    let paused = Channel {
        message_count: 1,
        last_spawn_at: NOW,
        paused_until: NOW + 60 * MINUTE,
        ..channel()
    };
    assert!(!by_message(&paused));
    assert!(!claims(Cause::Capture, &paused, NOW, &Spawn::default()));
    assert!(claims(Cause::Forced, &paused, NOW, &Spawn::default()));
    let over = Channel {
        paused_until: NOW - 1,
        ..paused
    };
    assert!(by_message(&over), "la pause finie, sans attendre le seuil");
}

#[test]
fn a_capture_calls_the_next_one_unless_the_floor_delay_holds() {
    let caught = Channel {
        message_count: 3,
        last_spawn_at: NOW,
        last_end: Some(NOW),
        ..channel()
    };
    assert!(claims(Cause::Capture, &caught, NOW, &Spawn::default()));
    let floor = Spawn {
        min_delay_after_end_minutes: 5,
        messages_per_spawn: 1_000_000,
        ..Spawn::default()
    };
    assert!(
        !claims(Cause::Capture, &caught, NOW, &floor),
        "pas avant le délai"
    );
    assert!(
        !claims(Cause::Message, &caught, NOW, &floor),
        "un message non plus"
    );
    let later = Channel {
        last_end: Some(NOW - 6 * MINUTE),
        ..caught
    };
    assert!(claims(Cause::Message, &later, NOW, &floor));
    // Un Pokémon encore là n'est jamais remplacé par une capture (c'en serait une autre).
    let active = Channel {
        active: Some(Rarity::Common),
        ..channel()
    };
    assert!(!claims(Cause::Capture, &active, NOW, &Spawn::default()));
}

#[test]
fn an_encounter_rolls_once_and_honours_what_the_administrator_forces() {
    let config = Pokemon::default();
    let draw = Draw::new(&config, 2);
    let mut rng = StdRng::seed_from_u64(7);
    let mewtwo = named("Mewtwo");
    let forced = Forced {
        species: Some(mewtwo),
        shiny: Some(true),
    };
    let encounter = roll(&draw, forced, &mut rng).expect("forced");
    assert_eq!(encounter.species.id, mewtwo.id);
    assert_eq!(encounter.rarity, Rarity::Legendary);
    assert_eq!(
        encounter.shiny,
        ShinyRoll {
            shiny: true,
            charm: false
        }
    );
    assert_eq!(encounter.sex, None, "un légendaire est asexué");
    for _ in 0..200 {
        let wild = roll(&draw, Forced::default(), &mut rng).expect("a wild one");
        assert!(draw.weight(wild.species, Pool::spawn(&config)) > 0.0);
        assert_eq!(wild.form.is_some(), !wild.species.forms.is_empty());
        if let Some(key) = wild.held_item {
            assert!(crate::pokemon::items::get(&config, key).is_some());
        }
    }
}

#[test]
fn rare_legendary_and_shiny_ones_mention_the_role_unless_forced() {
    let config = Spawn::default();
    assert!(!pings_role(&config, Rarity::Common, false, None));
    assert!(!pings_role(&config, Rarity::Rare, false, None));
    assert!(pings_role(&config, Rarity::VeryRare, false, None));
    assert!(pings_role(&config, Rarity::Legendary, false, None));
    assert!(pings_role(&config, Rarity::Common, true, None));
    assert!(!pings_role(&config, Rarity::Legendary, true, Some(false)));
    assert!(pings_role(&config, Rarity::Common, false, Some(true)));
}

#[test]
fn the_buttons_keep_their_v1_names() {
    assert_eq!(
        Button::parse("poke_throw|12|super"),
        Some(Button::Throw {
            spawn: 12,
            ball: "super"
        })
    );
    // Le panneau de la v1 ajoutait `|item` : ignoré ici, l'annonce n'offre jamais de ball.
    assert_eq!(
        Button::parse("poke_throw|12|poke|item"),
        Some(Button::Throw {
            spawn: 12,
            ball: "poke"
        })
    );
    assert_eq!(
        Button::parse("poke_special|3"),
        Some(Button::Special { spawn: 3 })
    );
    assert_eq!(
        Button::parse("poke_owned|3"),
        Some(Button::Info { spawn: 3 })
    );
    assert_eq!(Button::parse("poke_throw|12"), None);
    assert_eq!(Button::parse("poke_owned|0"), None);
    assert_eq!(Button::parse("poke_drop|3"), None);
    for button in [
        Button::Throw {
            spawn: 9,
            ball: "hyper",
        },
        Button::Special { spawn: 9 },
        Button::Info { spawn: 9 },
    ] {
        assert_eq!(Button::parse(&button.encode()), Some(button));
    }
}
