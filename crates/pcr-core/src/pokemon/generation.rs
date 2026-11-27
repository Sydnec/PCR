//! La génération jouable : le réglage `pokemon.generation`, ou une génération dont la date
//! d'ouverture (`pokemon.generationOpenings`) est passée, la plus haute des deux. Relue à chaque
//! instant : la 2ᵉ s'ouvre d'elle-même à son heure, sans release ni redémarrage.

use jiff::Timestamp;

use super::species::MAX_GENERATION;
use crate::config::Pokemon;

/// La dernière génération jouable à `now`. Une date illisible est ignorée ; le résultat reste dans
/// les données (une faute de frappe ne promet pas d'espèces absentes du jeu).
pub fn active(config: &Pokemon, now: Timestamp) -> u8 {
    let opened = config
        .generation_openings
        .iter()
        .filter(|(_, date)| date.parse::<Timestamp>().is_ok_and(|at| at <= now))
        .map(|(generation, _)| *generation);
    opened
        .fold(config.generation, u8::max)
        .clamp(1, MAX_GENERATION)
}

/// « 1re », « 2e » : l'ordinal d'une génération, pour les messages.
pub fn ordinal(generation: u8) -> String {
    if generation == 1 {
        "1re".to_owned()
    } else {
        format!("{generation}e")
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;

    fn at(s: &str) -> Timestamp {
        s.parse().expect("RFC 3339")
    }

    fn config(generation: u8, opening: &str) -> Pokemon {
        Pokemon {
            generation,
            generation_openings: BTreeMap::from([(2, opening.to_owned())]),
            ..Pokemon::default()
        }
    }

    #[test]
    fn the_second_generation_opens_by_itself_at_its_date() {
        let config = config(1, "2026-10-30T18:00:00+01:00");
        assert_eq!(active(&config, at("2026-10-30T17:59:59+01:00")), 1);
        assert_eq!(active(&config, at("2026-10-30T18:00:00+01:00")), 2);
        assert_eq!(active(&config, at("2027-01-01T00:00:00+01:00")), 2);
    }

    #[test]
    fn the_setting_opens_at_once_and_the_highest_wins() {
        let far = "2999-01-01T00:00:00+01:00";
        assert_eq!(active(&config(2, far), at("2026-01-01T00:00:00Z")), 2);
        assert_eq!(active(&config(1, far), at("2026-01-01T00:00:00Z")), 1);
    }

    #[test]
    fn a_typo_neither_empties_the_pokedex_nor_promises_missing_species() {
        let now = at("2026-01-01T00:00:00Z");
        let far = "2999-01-01T00:00:00+01:00";
        assert_eq!(active(&config(99, far), now), MAX_GENERATION);
        assert_eq!(active(&config(0, far), now), 1);
        assert_eq!(active(&config(1, "n'importe quoi"), now), 1);
    }

    #[test]
    fn names_generations_in_french() {
        assert_eq!(ordinal(1), "1re");
        assert_eq!(ordinal(2), "2e");
    }
}
