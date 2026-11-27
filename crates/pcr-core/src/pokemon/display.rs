//! Ce qui nomme et colore un Pokémon partout où il s'affiche : annonce, fiche, boîte, site. Une seule
//! écriture, pour qu'un Zarbi B ♀ ne s'appelle pas autrement d'un panneau à l'autre.

use super::species::{Sex, Species};

/// La couleur d'un shiny, quel que soit son type.
const SHINY_COLOR: u32 = 0xff_d7_00;
/// La couleur d'un type inconnu des données (le « blurple » de Discord).
const DEFAULT_COLOR: u32 = 0x58_65_f2;

/// Les couleurs des types, celles de la v1 (et du site).
const TYPE_COLORS: [(&str, u32); 18] = [
    ("Normal", 0xa8_a8_78),
    ("Combat", 0xc0_30_28),
    ("Vol", 0xa8_90_f0),
    ("Poison", 0xa0_40_a0),
    ("Sol", 0xe0_c0_68),
    ("Roche", 0xb8_a0_38),
    ("Insecte", 0xa8_b8_20),
    ("Spectre", 0x70_58_98),
    ("Acier", 0xb8_b8_d0),
    ("Feu", 0xf0_80_30),
    ("Eau", 0x68_90_f0),
    ("Plante", 0x78_c8_50),
    ("Électrik", 0xf8_d0_30),
    ("Psy", 0xf8_58_88),
    ("Glace", 0x98_d8_d8),
    ("Dragon", 0x70_38_f8),
    ("Ténèbres", 0x70_58_48),
    ("Fée", 0xee_99_ac),
];

/// La couleur d'un type, s'il est connu.
pub fn type_color(name: &str) -> Option<u32> {
    TYPE_COLORS
        .iter()
        .find_map(|(type_name, color)| (*type_name == name).then_some(*color))
}

/// La couleur d'un message : or pour un shiny, sinon celle de son premier type.
pub fn color(species: &Species, shiny: bool) -> u32 {
    if shiny {
        return SHINY_COLOR;
    }
    species
        .types
        .first()
        .and_then(|name| type_color(name))
        .unwrap_or(DEFAULT_COLOR)
}

/// Le numéro de Pokédex sur trois chiffres : « #025 ».
pub fn dex_number(species: &Species) -> String {
    format!("#{:03}", species.id)
}

/// Le nom d'un individu : la marque shiny, la forme comme dans les jeux (« Zarbi B ») et le symbole
/// du sexe, sauf pour les Nidoran dont le nom le porte déjà. Une espèce seule se nomme sans sexe.
pub fn display_name(
    species: &Species,
    shiny: bool,
    sex: Option<Sex>,
    form: Option<&str>,
) -> String {
    let mut name = String::new();
    if shiny {
        name.push_str("✨ ");
    }
    name.push_str(species.name);
    if let Some(form) = form.and_then(|key| species.form(key)) {
        name.push(' ');
        name.push_str(form.name);
    }
    if let Some(symbol) = sex
        .map(Sex::symbol)
        .filter(|symbol| !species.name.ends_with(symbol))
    {
        name.push(' ');
        name.push_str(symbol);
    }
    name
}

/// Une chance de capture en pourcentage, une décimale de plus à mesure qu'elle baisse : « 33 % »,
/// « 5,9 % », « 0,52 % ». Écrit comme `toLocaleString("fr-FR")` en v1.
pub fn chance(probability: f64) -> String {
    let percent = probability * 100.0;
    let decimals = if percent >= 10.0 {
        0
    } else if percent >= 1.0 {
        1
    } else {
        2
    };
    crate::format::percent(probability, decimals)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pokemon::species;

    fn named(name: &str) -> &'static Species {
        species::all_data()
            .iter()
            .find(|s| s.name == name)
            .unwrap_or_else(|| panic!("{name}"))
    }

    #[test]
    fn names_carry_shiny_form_and_sex_like_v1() {
        let pikachu = named("Pikachu");
        assert_eq!(display_name(pikachu, false, None, None), "Pikachu");
        assert_eq!(
            display_name(pikachu, true, Some(Sex::Female), None),
            "✨ Pikachu ♀"
        );
        // Le nom d'un Nidoran porte déjà son sexe.
        let nidoran = named("Nidoran♀");
        assert_eq!(
            display_name(nidoran, false, Some(Sex::Female), None),
            "Nidoran♀"
        );
        let unown = species::unown().expect("Zarbi");
        let b = unown.forms[1];
        assert_eq!(
            display_name(unown, false, None, Some(b.key)),
            format!("Zarbi {}", b.name)
        );
        assert_eq!(display_name(unown, false, None, Some("inconnue")), "Zarbi");
    }

    #[test]
    fn colors_and_numbers() {
        assert_eq!(color(named("Salamèche"), false), 0xf0_80_30);
        assert_eq!(color(named("Salamèche"), true), SHINY_COLOR);
        assert_eq!(dex_number(named("Pikachu")), "#025");
        assert_eq!(dex_number(named("Celebi")), "#251");
    }

    #[test]
    fn a_chance_gains_a_decimal_as_it_shrinks() {
        assert_eq!(chance(1.0), "100 %");
        assert_eq!(chance(0.333), "33 %");
        assert_eq!(chance(0.0588), "5,9 %");
        assert_eq!(chance(0.0052), "0,52 %");
    }
}
