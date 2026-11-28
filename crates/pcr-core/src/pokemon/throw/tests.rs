//! Valeurs de référence des tests v1 (`test/throws.test.js`, `test/special-balls.test.js`).

use super::*;

fn label() -> String {
    "Poké Ball".to_owned()
}

#[test]
fn every_outcome_is_told_in_full_like_v1() {
    let cases = [
        (Outcome::UnknownBall, "❌ Ball inconnue."),
        (
            Outcome::Cooldown { remaining: 2 },
            "⏳ Doucement ! Attends encore **2s** avant de relancer.",
        ),
        (Outcome::UnknownSpecies, "❌ Espèce inconnue."),
        (
            Outcome::NoItem { ball: label() },
            "❌ Tu n'as plus de **Poké Ball** dans ton inventaire. Rien n'a été débité.",
        ),
        (
            Outcome::Insufficient {
                ball: "Master Ball".to_owned(),
                price: 12_000,
                balance: 50,
            },
            "❌ Solde insuffisant : une **Master Ball** coûte **12\u{202f}000** points, tu en as **50**.",
        ),
        (
            Outcome::PriceChanged {
                ball: "Master Ball".to_owned(),
                price: 12_000,
            },
            "❌ Le prix de ta **Master Ball** est passé à **12\u{202f}000** points depuis ta \
             confirmation. Rien n'a été débité.",
        ),
        (
            Outcome::Miss {
                ball: label(),
                paid: Paid::Points(100),
                name: "Roucool ♂".to_owned(),
                probability: 0.333,
            },
            "❌ Raté ! **Roucool ♂** s'est dégagé de ta Poké Ball. (**-100** points, 33,3 % de réussite)",
        ),
        (
            Outcome::Catch {
                paid: Paid::Offered { label: label() },
                name: "✨ Pikachu ♀".to_owned(),
                charm: Some(("🌟".to_owned(), "Charme Chroma (1re gén.)".to_owned())),
            },
            "🎉 Bravo ! **✨ Pikachu ♀** rejoint ton Pokédex ! (Poké Ball offerte)\n🌟 Il brillait \
             pour toi, grâce à ton **Charme Chroma (1re gén.)** !",
        ),
    ];
    for (outcome, text) in cases {
        assert_eq!(outcome.message(), text);
    }
    assert!(
        Outcome::NoUnit {
            ball: "Appât Ball".to_owned(),
            held: 2
        }
        .message()
        .contains(
            "tu en as 2, mais une ball achetée ne sert qu'aux Pokémon qui apparaissent après"
        )
    );
}

#[test]
fn only_a_finished_encounter_ends_the_panel() {
    let caught = Outcome::Catch {
        paid: Paid::Points(1),
        name: String::new(),
        charm: None,
    };
    for outcome in [
        Outcome::Gone,
        Outcome::NotYours,
        Outcome::UnknownSpecies,
        caught,
    ] {
        assert!(outcome.is_final(), "{outcome:?}");
    }
    let missed = Outcome::Miss {
        ball: label(),
        paid: Paid::Points(1),
        name: String::new(),
        probability: 0.5,
    };
    for outcome in [
        missed,
        Outcome::Cooldown { remaining: 1 },
        Outcome::NoItem { ball: label() },
        Outcome::PriceChanged {
            ball: label(),
            price: 1,
        },
    ] {
        assert!(!outcome.is_final(), "{outcome:?}");
    }
}

#[test]
fn the_cooldown_rounds_the_wait_up_and_vanishes_at_zero() {
    assert_eq!(cooldown_remaining(None, 10_000, 3.0), None);
    assert_eq!(cooldown_remaining(Some(9_000), 10_000, 3.0), Some(2));
    assert_eq!(cooldown_remaining(Some(9_999), 10_000, 3.0), Some(3));
    assert_eq!(cooldown_remaining(Some(7_000), 10_000, 3.0), None);
    assert_eq!(cooldown_remaining(Some(9_900), 10_000, 1.5), Some(2));
    assert_eq!(cooldown_remaining(Some(10_000), 10_000, 0.0), None);
}

#[test]
fn a_shop_ball_exists_from_its_generation_and_carries_its_bonus() {
    let config = Pokemon::default();
    assert!(ball(&config, 1, "appat").is_none(), "génération fermée");
    assert!(ball(&config, 1, "fantome").is_none());
    let master = ball(&config, 1, "master").expect("master");
    assert!(master.guaranteed() && !master.is_special());
    assert!((master.probability(&config, 3, false, 150) - 1.0).abs() < f64::EPSILON);
    // L'Appât Ball vaut ×3 sur un Pokémon pêché, ×1 sinon (taux 45 : 45 / 765 par point de multiplicateur).
    let appat = ball(&config, 2, "appat").expect("appât");
    assert!(appat.is_special());
    let base = 45.0 / 765.0;
    assert!((appat.probability(&config, 45, false, 129) - base).abs() < 1e-12);
    assert!((appat.probability(&config, 45, true, 129) - 3.0 * base).abs() < 1e-12);
    let names: Vec<&str> = open_specials(&config, 2).map(|(key, _)| key).collect();
    assert_eq!(names, ["appat", "catalyseur"]);
}

#[test]
fn the_panel_buttons_keep_their_v1_names() {
    let cases = [
        (
            "poke_rethrow|4|poke|item",
            Button::Rethrow {
                spawn: 4,
                ball: "poke",
                item: true,
            },
        ),
        (
            "poke_rethrow|4|appat",
            Button::Rethrow {
                spawn: 4,
                ball: "appat",
                item: false,
            },
        ),
        ("poke_respecial|4", Button::Respecial { spawn: 4 }),
        ("poke_reback|4", Button::Reback { spawn: 4 }),
        ("poke_master|4", Button::Master { spawn: 4 }),
        ("poke_remaster|4", Button::Remaster { spawn: 4 }),
        (
            "poke_master_ok|4|item",
            Button::MasterOk {
                spawn: 4,
                promise: Promise::Offered,
            },
        ),
        (
            "poke_master_ok|4|12000",
            Button::MasterOk {
                spawn: 4,
                promise: Promise::Price(12_000),
            },
        ),
        (
            "poke_master_ok|4",
            Button::MasterOk {
                spawn: 4,
                promise: Promise::Unspecified,
            },
        ),
        (
            "poke_master_cancel|4",
            Button::MasterCancel { spawn: Some(4) },
        ),
        ("poke_master_cancel", Button::MasterCancel { spawn: None }),
    ];
    for (custom_id, button) in cases {
        assert_eq!(Button::parse(custom_id), Some(button), "{custom_id}");
        assert_eq!(button.encode(), custom_id);
    }
    assert_eq!(Button::parse("poke_rethrow|4"), None);
    assert_eq!(Button::parse("poke_owned|4"), None);
}
