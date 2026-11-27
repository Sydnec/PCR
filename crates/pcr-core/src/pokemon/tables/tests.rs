//! Valeurs de référence des tests v1 (`test/generation2.test.js`).

use super::{text::one_in, *};
use crate::config::{Fishing, Pokemon};

fn close(actual: f64, expected: f64) {
    assert!((actual - expected).abs() < 1e-9, "{actual} ≠ {expected}");
}

/// La 2ᵉ génération, sans la rareté des espèces pêchables : ces tables ne parlent que des générations.
fn gen2() -> Pokemon {
    Pokemon {
        fishing: Fishing {
            wild_rarity_factor: 1.0,
            ..Fishing::default()
        },
        ..Pokemon::default()
    }
}

fn labels(table: &WeightTable) -> Vec<&str> {
    table.rows.iter().map(|r| r.label.as_str()).collect()
}

#[test]
fn the_spawn_table_splits_generations_with_the_weights_really_drawn() {
    let config = gen2();
    let draw = Draw::new(&config, 2);
    let table = spawn_pool(&draw);
    let first = config.spawn.weights_by_stage.first;
    let stage_1: Vec<(&str, f64)> = table
        .rows
        .iter()
        .filter(|r| r.label.starts_with("Stade 1"))
        .map(|r| (r.label.as_str(), r.weight))
        .collect();
    assert_eq!(
        stage_1,
        [
            ("Stade 1 (1re gén.)", first),
            ("Stade 1 (2e gén.)", 2.0 * first)
        ]
    );
    let counted: u32 = table.rows.iter().map(|r| r.count).sum();
    assert_eq!(counted, 251, "chaque espèce est dans une ligne");
    let drawn: f64 = species::all(2)
        .map(|s| draw.weight(s, Pool::spawn(&config)))
        .sum();
    close(table.total, drawn);
    close(table.rows.iter().map(|r| r.share).sum(), 1.0);
    let unown = table.rows.iter().find(|r| r.label == "Zarbi (×2)");
    assert_eq!(unown.map(|r| r.count), Some(1));
}

#[test]
fn without_boost_or_at_the_park_one_line_per_category() {
    let mut flat = gen2();
    flat.spawn.generation_boost = 1.0;
    let draw = Draw::new(&flat, 2);
    assert!(
        spawn_pool(&draw)
            .rows
            .iter()
            .all(|r| !r.label.contains("gén."))
    );
    let config = gen2();
    assert_eq!(
        labels(&safari_pool(&Draw::new(&config, 2))),
        [
            "Stade 1",
            "Stade 2",
            "Stade 3",
            "Starters, stade 1",
            "Starters, stade 2",
            "Starters, stade 3",
            "Zarbi (×2)",
            "Légendaires",
            "Hors pool (échange, objet)",
            "Hors pool (œuf)",
        ]
    );
}

#[test]
fn item_tables_name_what_is_out_of_the_draw() {
    let config = Pokemon::default();
    let draw = Draw::new(&config, 1);
    let held_table = held_pool(&draw);
    let intro = held_table.intro();
    assert!(
        intro.starts_with(
            "*L'objet que tient un Pokémon, quand il en tient un.* — **15 %** en tiennent un"
        ),
        "{intro}"
    );
    // Fermés en 1ʳᵉ génération ou sans poids : hors tirage, pas dans le tableau.
    assert!(
        intro.contains("Hors tirage : ") && intro.contains("Pierre Soleil"),
        "{intro}"
    );
    let (head, body) = held_table.lines();
    assert!(
        head.starts_with("objet") && head.ends_with("soit"),
        "{head}"
    );
    assert!(body.iter().all(|line| !line.starts_with("Pierre Soleil")));
    assert!(body.last().is_some_and(|line| line.starts_with("TOTAL")));
    let lottery = lottery_pool(&draw);
    assert!(
        lottery
            .note
            .ends_with("Chaque exemplaire de plus est 2 fois moins probable.")
    );
    let (head, body) = lottery.lines();
    assert!(head.contains(" lot "), "{head}");
    let poke = body.iter().find(|line| line.starts_with("Poké Ball"));
    assert!(poke.is_some_and(|line| line.contains("1-5")), "{poke:?}");
}

#[test]
fn columns_line_up_and_rare_events_read_as_one_in_n() {
    let config = Pokemon::default();
    let draw = Draw::new(&config, 2);
    // Les chiffres sont alignés à droite : chaque ligne d'objet a la largeur de l'en-tête.
    let (head, body) = held_pool(&draw).lines();
    for line in &body {
        assert_eq!(line.chars().count(), head.chars().count(), "{line}");
        assert!(!line.contains('\u{202f}'), "{line}");
    }
    let (_, body) = held_pool(&draw).lines();
    let master = body.iter().find(|line| line.starts_with("Méga Canne"));
    assert!(master.is_some_and(|line| line.contains("1/")), "{master:?}");
    assert_eq!(one_in(0.75), "—");
    assert_eq!(one_in(0.001), "1/1 000");
}
