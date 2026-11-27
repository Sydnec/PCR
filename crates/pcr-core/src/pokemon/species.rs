//! Les espèces, telles que `data/pokemon.json` les décrit (tableaux produits par `build.rs`).
//!
//! Les données contiennent plus d'espèces que le jeu n'en montre : toutes celles jusqu'à la dernière
//! génération préparée, alors que seules les générations ouvertes sont jouables. Ouvrir une
//! génération n'est donc qu'un réglage (`generation::active`), jamais une régénération.

use rand::{Rng, RngExt as _};

/// Une forme d'apparence (les lettres de Zarbi) : un trait de l'individu, comme son sexe ou sa ball.
/// Une seule entrée de Pokédex pour toutes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Form {
    pub key: &'static str,
    pub name: &'static str,
    /// La génération qui la connaît (jamais avant celle de l'espèce).
    pub generation: u8,
}

// Les drapeaux des données, un par un : les regrouper ne dirait rien de plus.
#[allow(clippy::struct_excessive_bools)]
#[derive(Debug, PartialEq, Eq)]
pub struct Species {
    pub id: u16,
    /// Le nom français.
    pub name: &'static str,
    /// L'identifiant PokéAPI : Métamorph et Zarbi se retrouvent par lui, jamais par un numéro écrit ici.
    pub slug: &'static str,
    pub generation: u8,
    /// Le taux de capture des jeux, avant le plancher `capture.minCatchRate`.
    pub catch_rate: u8,
    /// 1 à 3 ; un bébé compte dans le stade (Pichu 1, Pikachu 2, Raichu 3).
    pub stage: u8,
    pub legendary: bool,
    pub mythical: bool,
    pub baby: bool,
    /// Part de femelles en huitièmes (0 : toujours mâle, 8 : toujours femelle), -1 : asexuée.
    pub gender_rate: i8,
    /// Marqué sur la cible d'une évolution par échange (Alakazam…), c'est elle qu'on exclut des tirages.
    pub trade_evolution: bool,
    pub types: &'static [&'static str],
    pub evolves_from: Option<u16>,
    pub evolves_into: &'static [u16],
    /// Vide pour une espèce sans formes ; la première est la forme par défaut.
    pub forms: &'static [Form],
}

include!(concat!(env!("OUT_DIR"), "/species.rs"));

/// Lecture brute, sans filtre de génération : une collection garde son espèce même si l'on referme
/// sa génération, et doit pouvoir l'afficher. Ce qui vient d'une saisie passe par [`available`].
pub fn get(id: u16) -> Option<&'static Species> {
    SPECIES
        .binary_search_by_key(&id, |species| species.id)
        .ok()
        .map(|index| &SPECIES[index])
}

/// Une espèce jouable à cette génération.
pub fn available(id: u16, generation: u8) -> Option<&'static Species> {
    get(id).filter(|species| species.is_available(generation))
}

/// Toutes les espèces des données, générations fermées comprises : réservé à ce qui traite les
/// données sans égard au jeu en cours. Tout ce que voient les joueurs passe par [`all`].
pub fn all_data() -> &'static [Species] {
    SPECIES
}

/// Les espèces jouables à cette génération, dans l'ordre du Pokédex : la porte de tout ce qui
/// énumère (apparitions, Pokédex, tables de poids), si bien qu'aucune espèce d'une génération
/// fermée ne s'y glisse. Une génération passée (le bilan d'une saison close) donne le Pokédex d'alors.
pub fn all(generation: u8) -> impl Iterator<Item = &'static Species> {
    SPECIES
        .iter()
        .filter(move |species| species.is_available(generation))
}

/// Métamorph, s'il est jouable : il remplace un parent d'œuf et comble un sacrifice qui manque.
pub fn ditto(generation: u8) -> Option<&'static Species> {
    all(generation).find(|species| species.is_ditto())
}

/// Zarbi, que sa génération soit ouverte ou non : ses lettres disent alors quand il arrive.
pub fn unown() -> Option<&'static Species> {
    SPECIES.iter().find(|species| species.slug == "unown")
}

/// Les espèces jouables dont le nom contient `query`, dans l'ordre du Pokédex : sans accents, casse ni
/// ponctuation, comme la v1 (« melo » trouve Mélo, « mmime » M. Mime). Une requête vide les donne
/// toutes.
pub fn search(query: &str, generation: u8) -> impl Iterator<Item = &'static Species> {
    let needle = search_key(query);
    all(generation).filter(move |species| search_key(species.name).contains(&needle))
}

/// Un nom réduit à ses lettres et chiffres ASCII, accents ôtés (ce que faisait la normalisation NFD).
fn search_key(text: &str) -> String {
    text.chars()
        .flat_map(char::to_lowercase)
        .filter_map(|c| match c {
            'a'..='z' | '0'..='9' => Some(c),
            'à' | 'â' | 'ä' | 'á' => Some('a'),
            'é' | 'è' | 'ê' | 'ë' => Some('e'),
            'î' | 'ï' | 'í' => Some('i'),
            'ô' | 'ö' | 'ó' => Some('o'),
            'û' | 'ù' | 'ü' | 'ú' => Some('u'),
            'ç' => Some('c'),
            'ÿ' => Some('y'),
            _ => None,
        })
        .collect()
}

impl Species {
    pub fn is_available(&self, generation: u8) -> bool {
        self.generation <= generation
    }

    /// Légendaire ou mythique : la même rareté, le même verrou d'office.
    pub fn is_legendary(&self) -> bool {
        self.legendary || self.mythical
    }

    pub fn is_ditto(&self) -> bool {
        self.slug == "ditto"
    }

    /// Les espèces asexuées des jeux (Magnéti, Porygon, les légendaires…) n'ont pas de sexe ici non plus.
    pub fn is_genderless(&self) -> bool {
        self.gender_rate < 0
    }

    /// La part de femelles, `None` pour une espèce asexuée : ce que la fiche affiche est ce que
    /// [`Species::roll_sex`] tire.
    pub fn female_share(&self) -> Option<f64> {
        (!self.is_genderless()).then(|| f64::from(self.gender_rate) / 8.0)
    }

    /// Les sexes qu'un individu peut avoir, mâle d'abord : aucun pour Magnéti, un seul pour Leveinard.
    pub fn possible_sexes(&self) -> Vec<Sex> {
        let Some(share) = self.female_share() else {
            return Vec::new();
        };
        [(share < 1.0, Sex::Male), (share > 0.0, Sex::Female)]
            .into_iter()
            .filter_map(|(possible, sex)| possible.then_some(sex))
            .collect()
    }

    /// Le sexe d'un nouvel individu, `None` pour une espèce asexuée.
    pub fn roll_sex(&self, rng: &mut (impl Rng + ?Sized)) -> Option<Sex> {
        let share = self.female_share()?;
        Some(if rng.random::<f64>() < share {
            Sex::Female
        } else {
            Sex::Male
        })
    }

    /// Le sexe d'un individu qui change d'espèce (évolution) : il garde le sien, sauf si la nouvelle
    /// espèce n'en a pas, n'en admet qu'un, ou s'il n'en avait pas. Aucune lignée des deux premières
    /// générations ne change de règle en chemin, mais rien ne doit produire un Magnéton femelle.
    pub fn sex_after_evolution(
        &self,
        sex: Option<Sex>,
        rng: &mut (impl Rng + ?Sized),
    ) -> Option<Sex> {
        match self.gender_rate {
            ..0 => None,
            0 => Some(Sex::Male),
            8 => Some(Sex::Female),
            _ => sex.or_else(|| self.roll_sex(rng)),
        }
    }

    /// Les formes que la génération jouable connaît.
    pub fn forms_in(&self, generation: u8) -> impl Iterator<Item = &'static Form> {
        self.forms
            .iter()
            .filter(move |form| form.generation <= generation)
    }

    /// La forme `key`, ou rien : une clé inconnue (lue en base ou dans un bouton) ne s'affiche pas et
    /// ne compose jamais une adresse d'image.
    pub fn form(&self, key: &str) -> Option<&'static Form> {
        self.forms.iter().find(|form| form.key == key)
    }

    /// Tirée à parts égales là où naît l'individu (apparition, parc, œuf) ; `None` sans formes.
    pub fn roll_form(&self, generation: u8, rng: &mut (impl Rng + ?Sized)) -> Option<&'static str> {
        let forms: Vec<_> = self.forms_in(generation).collect();
        (!forms.is_empty()).then(|| forms[rng.random_range(0..forms.len())].key)
    }

    /// La forme d'un individu qui change d'espèce : il garde la sienne si la nouvelle espèce la
    /// connaît, en prend une au hasard si elle en a, et n'en a plus sinon.
    pub fn form_after_evolution(
        &self,
        form: Option<&str>,
        generation: u8,
        rng: &mut (impl Rng + ?Sized),
    ) -> Option<&'static str> {
        match form.and_then(|key| self.form(key)) {
            Some(kept) => Some(kept.key),
            None => self.roll_form(generation, rng),
        }
    }

    /// Le nom de fichier d'une image : « 201 » pour la forme par défaut (Zarbi A), « 201-b » sinon.
    fn image_name(&self, form: Option<&str>) -> String {
        match form.and_then(|key| self.form(key)) {
            Some(form) if self.forms.first() != Some(form) => format!("{}-{}", self.id, form.key),
            _ => self.id.to_string(),
        }
    }

    /// L'illustration officielle.
    pub fn sprite_url(&self, shiny: bool, form: Option<&str>) -> String {
        let shiny = if shiny { "shiny/" } else { "" };
        format!("{SPRITE_BASE}/{shiny}{}.png", self.image_name(form))
    }

    /// La petite image (96 px) du même dépôt, pour les grilles : une illustration pèse cent fois plus.
    pub fn icon_url(&self, shiny: bool, form: Option<&str>) -> String {
        let shiny = if shiny { "shiny/" } else { "" };
        format!("{ICON_BASE}/{shiny}{}.png", self.image_name(form))
    }
}

const ICON_BASE: &str = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon";

/// Le sexe d'un individu, tel qu'il s'écrit en base (`M`, `F`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Sex {
    Male,
    Female,
}

impl Sex {
    pub fn code(self) -> &'static str {
        match self {
            Self::Male => "M",
            Self::Female => "F",
        }
    }

    pub fn from_code(code: &str) -> Option<Self> {
        match code {
            "M" => Some(Self::Male),
            "F" => Some(Self::Female),
            _ => None,
        }
    }

    pub fn symbol(self) -> &'static str {
        match self {
            Self::Male => "♂",
            Self::Female => "♀",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Male => "mâle",
            Self::Female => "femelle",
        }
    }
}

#[cfg(test)]
mod tests {
    use rand::{SeedableRng as _, rngs::StdRng};

    use super::*;

    fn named(name: &str) -> &'static Species {
        SPECIES
            .iter()
            .find(|s| s.name == name)
            .unwrap_or_else(|| panic!("{name}"))
    }

    #[test]
    fn the_data_hold_251_species_numbered_without_gap() {
        assert_eq!(MAX_GENERATION, 2);
        assert_eq!(all(2).count(), 251);
        assert!(all(2).zip(1..).all(|(s, id)| s.id == id));
        assert_eq!(all(2).filter(|s| s.generation == 2).count(), 100);
        assert_eq!(all(1).count(), 151);
        // Refermée, la 2ᵉ génération se lit encore : une collection garde Celebi.
        assert!(available(251, 1).is_none());
        assert_eq!(
            get(251).map(|s| (s.name, s.mythical)),
            Some(("Celebi", true))
        );
    }

    #[test]
    fn eight_babies_and_six_legendaries_arrive_with_the_second_generation() {
        let mut babies: Vec<_> = all(2).filter(|s| s.baby).map(|s| s.name).collect();
        babies.sort_unstable();
        assert_eq!(
            babies,
            [
                "Debugant",
                "Lippouti",
                "Magby",
                "Mélo",
                "Pichu",
                "Togepi",
                "Toudoudou",
                "Élekid"
            ]
        );
        assert!(
            all(2)
                .filter(|s| s.baby)
                .all(|s| s.stage == 1 && s.generation == 2)
        );
        assert!(all(1).all(|s| !s.baby));
        let mut legendaries: Vec<_> = all(2)
            .filter(|s| s.generation == 2 && s.is_legendary())
            .map(|s| s.name)
            .collect();
        legendaries.sort_unstable();
        assert_eq!(
            legendaries,
            ["Celebi", "Entei", "Ho-Oh", "Lugia", "Raikou", "Suicune"]
        );
    }

    #[test]
    fn sexes_follow_the_games_eighths() {
        let mut rng = StdRng::seed_from_u64(1);
        assert!(named("Magnéti").possible_sexes().is_empty());
        assert_eq!(named("Magnéti").roll_sex(&mut rng), None);
        assert_eq!(named("Leveinard").possible_sexes(), [Sex::Female]);
        assert_eq!(named("Nidoran♂").possible_sexes(), [Sex::Male]);
        assert_eq!(named("Pikachu").possible_sexes(), [Sex::Male, Sex::Female]);
        assert_eq!(named("Pikachu").female_share(), Some(0.5));
        // En évoluant, un individu garde son sexe si la nouvelle espèce l'admet.
        let female = named("Raichu").sex_after_evolution(Some(Sex::Female), &mut rng);
        assert_eq!(female, Some(Sex::Female));
        assert_eq!(
            named("Magnéton").sex_after_evolution(Some(Sex::Male), &mut rng),
            None
        );
    }

    #[test]
    fn a_search_ignores_accents_case_and_punctuation() {
        let found = |query: &str| search(query, 2).map(|s| s.name).collect::<Vec<_>>();
        assert_eq!(found("MELODELFE"), ["Mélodelfe"]);
        assert_eq!(found("mmime"), ["M. Mime"]);
        assert_eq!(found("ho oh"), ["Ho-Oh"]);
        assert_eq!(search("", 1).count(), 151);
        assert_eq!(found("celebi"), ["Celebi"]);
        assert!(search("celebi", 1).next().is_none(), "génération fermée");
        // Aucune lettre d'un nom ne se perd : un accent oublié ici rendrait l'espèce introuvable.
        for species in all_data() {
            let letters = species.name.chars().filter(|c| c.is_alphanumeric()).count();
            assert_eq!(search_key(species.name).len(), letters, "{}", species.name);
        }
    }

    #[test]
    fn unown_carries_26_letters_from_the_second_generation() {
        let unown = unown().expect("Zarbi");
        assert_eq!(unown.forms_in(2).count(), 26);
        assert_eq!(unown.forms_in(1).count(), 0);
        let mut rng = StdRng::seed_from_u64(1);
        let letter = unown.roll_form(2, &mut rng).expect("a letter");
        assert!(unown.form(letter).is_some());
        assert_eq!(named("Pikachu").roll_form(2, &mut rng), None);
        // La première lettre est l'image par défaut, les autres portent leur clé.
        let second = unown.forms[1].key;
        assert!(
            unown
                .sprite_url(false, Some(unown.forms[0].key))
                .ends_with("/201.png")
        );
        assert!(
            unown
                .icon_url(true, Some(second))
                .ends_with(&format!("/shiny/201-{second}.png"))
        );
        assert!(unown.sprite_url(false, Some("../x")).ends_with("/201.png"));
    }
}
