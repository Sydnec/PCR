//! Paris : `custom_id`, saisies, partage de la cagnotte, plus proche estimation, refus.
//!
//! Un pari classique propose de 2 à 5 options ; chacun mise sur une seule, peut y rajouter des points,
//! et les gagnants se partagent toute la cagnotte au prorata de leur mise. Un pari d'estimation
//! demande un nombre : les plus proches du résultat se partagent la cagnotte de la même façon. Ce que
//! la division laisse (et la cagnotte entière quand personne n'a gagné) revient à la banque, comme en
//! v1.

use crate::{
    ids::{self, Parsed},
    refusal::Refusal,
};

/// Bornes des options d'un pari classique : celles des options de `/bet`.
pub const MIN_OPTIONS: usize = 2;
pub const MAX_OPTIONS: usize = 5;

pub const NOT_FOUND: &str = "Pari introuvable.";
pub const TOO_FEW_OPTIONS: &str = "Il faut au moins 2 options pour créer un pari.";
pub const CLOSED_TO_STAKES: &str = "❌ Ce pari est fermé, les mises ne sont plus acceptées.";
pub const CLOSED_TO_ESTIMATES: &str =
    "❌ Ce pari est clos, les estimations ne sont plus acceptées.";
pub const OWN_BET: &str = "❌ Tu ne peux pas parier sur ton propre pari !";
pub const OWN_ESTIMATE: &str = "❌ Tu ne peux pas parier sur ta propre estimation !";
/// Une modale de mise envoyée après la fermeture.
pub const STAKE_CLOSED: &str = "Ce pari est fermé.";
pub const ESTIMATE_CLOSED: &str = "❌ Ce pari est clos, ton estimation n'a pas été enregistrée.";
pub const INVALID_OPTION: &str = "Option invalide.";
pub const BAD_AMOUNT: &str = "La mise doit être un nombre positif.";
pub const BAD_PREDICTION: &str = "L'estimation doit être un nombre entier.";
pub const BAD_RESULT: &str = "La réponse doit être un nombre entier.";
pub const NOT_CREATOR: &str = "Seul le créateur peut terminer le pari.";
pub const FINISHED: &str = "Ce pari est déjà terminé.";
/// Une résolution qui en croise une autre : seule la première a payé.
pub const JUST_FINISHED: &str = "Ce pari vient d'être terminé.";
pub const NO_OPTIONS: &str = "Options introuvables.";
pub const BAD_WINNER: &str = "Option gagnante invalide.";

/// On ne change pas de camp : une mise s'ajoute à la précédente, sur la même option.
pub fn other_option(label: &str) -> Refusal {
    Refusal::new(format!(
        "Tu as déjà parié sur **{label}**. Tu ne peux pas changer d'option."
    ))
}

/// Une mise que le solde ne couvre pas.
pub fn not_enough(balance: &str) -> Refusal {
    Refusal::new(format!("Tu n'as pas assez de points. Solde: {balance}"))
}

/// Une estimation revue à la hausse que le solde ne couvre pas : ce qui manque pour la différence.
pub fn short_by(missing: &str) -> Refusal {
    Refusal::new(format!("Solde insuffisant. Manque {missing} points."))
}

/// Les composants des messages de pari, et ce qu'ils déclenchent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    /// `bet_join|<pari>|<option>` : bouton d'une option, ouvre la modale de mise.
    Join { bet: i64, option: i64 },
    /// `bet_estimate_join|<pari>` : ouvre la modale d'estimation.
    EstimateJoin { bet: i64 },
    /// `bet_modal|<pari>|<option>` : la modale de mise envoyée.
    Stake { bet: i64, option: i64 },
    /// `bet_estimate_modal|<pari>` : la modale d'estimation envoyée.
    Estimate { bet: i64 },
    /// `bet_resolve_modal|<pari>` : « Déclarer le résultat ».
    ResolveForm { bet: i64 },
    /// `bet_resolve_select|<pari>` : le menu de résolution d'un pari classique.
    ResolveSelect { bet: i64 },
    /// `bet_estimate_resolve_submit|<pari>` : la modale du résultat d'une estimation.
    ResolveEstimate { bet: i64 },
}

impl Action {
    /// Décode un `custom_id` de pari. Le message du pari que la v1 ajoutait aux deux derniers est
    /// ignoré : la ligne `public_messages` du pari le connaît.
    pub fn parse(custom_id: &str) -> Option<Self> {
        let parsed = Parsed::new(custom_id);
        let bet = parsed.id(0)?;
        Some(match parsed.action {
            "bet_join" => Self::Join {
                bet,
                option: parsed.id(1)?,
            },
            "bet_estimate_join" => Self::EstimateJoin { bet },
            "bet_modal" => Self::Stake {
                bet,
                option: parsed.id(1)?,
            },
            "bet_estimate_modal" => Self::Estimate { bet },
            "bet_resolve_modal" => Self::ResolveForm { bet },
            "bet_resolve_select" => Self::ResolveSelect { bet },
            "bet_estimate_resolve_submit" => Self::ResolveEstimate { bet },
            _ => return None,
        })
    }

    pub fn encode(self) -> String {
        match self {
            Self::Join { bet, option } => ids::encode("bet_join", &[&bet, &option]),
            Self::EstimateJoin { bet } => ids::encode("bet_estimate_join", &[&bet]),
            Self::Stake { bet, option } => ids::encode("bet_modal", &[&bet, &option]),
            Self::Estimate { bet } => ids::encode("bet_estimate_modal", &[&bet]),
            Self::ResolveForm { bet } => ids::encode("bet_resolve_modal", &[&bet]),
            Self::ResolveSelect { bet } => ids::encode("bet_resolve_select", &[&bet]),
            Self::ResolveEstimate { bet } => ids::encode("bet_estimate_resolve_submit", &[&bet]),
        }
    }
}

/// Un nombre entier tapé dans une modale. Les espaces sont ignorées, pour qu'un « 1 000 » vaille
/// mille : le `parseInt` de la v1 s'arrêtait au premier blanc (et misait 1 point). Le reste doit être
/// un entier, signe compris : « 12abc » ou « 1e3 », que la v1 lisait 12 et 1, sont refusés.
pub fn whole_number(text: &str) -> Option<i64> {
    let compact: String = text.chars().filter(|c| !c.is_whitespace()).collect();
    let digits = compact
        .strip_prefix('-')
        .or_else(|| compact.strip_prefix('+'))
        .unwrap_or(&compact);
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    compact.parse().ok()
}

/// Une mise saisie : un entier strictement positif.
pub fn amount(text: &str) -> Result<i64, Refusal> {
    whole_number(text)
        .filter(|amount| *amount > 0)
        .ok_or_else(|| Refusal::new(BAD_AMOUNT))
}

/// Une mise gagnante.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Stake {
    pub user: i64,
    pub amount: i64,
}

/// Le gain de chaque gagnant : sa part de la mise gagnante, appliquée à toute la cagnotte, arrondie
/// vers le bas. La v1 calculait `floor((mise / total gagnant) * cagnotte)` en flottant ; le quotient
/// entier exact donne le même gain sauf quand la part tombe juste, où le flottant perdait un point
/// (29 et 71 points seuls sur l'option gagnante : la v1 rendait 28 et 71). Jamais plus que la
/// cagnotte, au point près.
pub fn payouts(pool: i64, winners: &[Stake]) -> Vec<(i64, i64)> {
    let total: i128 = winners.iter().map(|w| i128::from(w.amount)).sum();
    if total <= 0 {
        return Vec::new();
    }
    winners
        .iter()
        .map(|winner| {
            let share = i128::from(winner.amount) * i128::from(pool) / total;
            (winner.user, i64::try_from(share).unwrap_or(i64::MAX))
        })
        .collect()
}

/// Une estimation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Guess {
    pub user: i64,
    pub amount: i64,
    pub prediction: i64,
}

impl Guess {
    /// L'écart au résultat.
    pub fn diff(&self, result: i64) -> u64 {
        self.prediction.abs_diff(result)
    }
}

/// Les estimations les plus proches de `result` (ex æquo compris), dans l'ordre reçu.
pub fn closest(guesses: &[Guess], result: i64) -> Vec<Guess> {
    let Some(best) = guesses.iter().map(|g| g.diff(result)).min() else {
        return Vec::new();
    };
    guesses
        .iter()
        .filter(|g| g.diff(result) == best)
        .copied()
        .collect()
}

/// La part d'une option dans la cagnotte, en pourcentage arrondi (une demie vers le haut, comme
/// `Math.round`) ; 0 tant que rien n'est misé.
pub fn percent(amount: i64, total: i64) -> i64 {
    if total <= 0 {
        return 0;
    }
    let rounded = (i128::from(amount) * 200 + i128::from(total)) / (2 * i128::from(total));
    i64::try_from(rounded).unwrap_or(0)
}

/// Cases pleines de la barre de 10 qui illustre un pourcentage.
pub const BAR_CELLS: i64 = 10;

pub fn filled_cells(percent: i64) -> i64 {
    ((percent + 5) / 10).clamp(0, BAR_CELLS)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stakes(list: &[(i64, i64)]) -> Vec<Stake> {
        list.iter()
            .map(|&(user, amount)| Stake { user, amount })
            .collect()
    }

    #[test]
    fn custom_ids_round_trip_and_read_the_v1_ones() {
        for action in [
            Action::Join { bet: 4, option: 2 },
            Action::EstimateJoin { bet: 4 },
            Action::Stake { bet: 4, option: 5 },
            Action::Estimate { bet: 4 },
            Action::ResolveForm { bet: 4 },
            Action::ResolveSelect { bet: 4 },
            Action::ResolveEstimate { bet: 4 },
        ] {
            assert_eq!(Action::parse(&action.encode()), Some(action));
        }
        // Les deux derniers portaient le message du pari en v1.
        assert_eq!(
            Action::parse("bet_resolve_select|7|1310000000000000000"),
            Some(Action::ResolveSelect { bet: 7 })
        );
        assert_eq!(
            Action::parse("bet_estimate_resolve_submit|7|1310000000000000000"),
            Some(Action::ResolveEstimate { bet: 7 })
        );
        assert_eq!(Action::parse("bet_join|7"), None);
        assert_eq!(Action::parse("poke_throw|7"), None);
    }

    #[test]
    fn payouts_match_the_v1_reference_values() {
        // Sorties du code v1 (events/client/interactionCreate.js) sous Node 22.
        assert_eq!(
            payouts(1000, &stakes(&[(1, 100), (2, 300)])),
            [(1, 250), (2, 750)]
        );
        assert_eq!(
            payouts(4, &stakes(&[(1, 1), (2, 1), (3, 1)])),
            [(1, 1), (2, 1), (3, 1)]
        );
        assert_eq!(payouts(100, &stakes(&[(1, 7), (2, 3)])), [(1, 70), (2, 30)]);
        assert_eq!(
            payouts(
                1_666_666_665,
                &stakes(&[(1, 123_456_789), (2, 987_654_321)])
            ),
            [(1, 185_185_183), (2, 1_481_481_481)]
        );
        assert_eq!(
            payouts(250, &stakes(&[(1, 50), (2, 150)])),
            [(1, 62), (2, 187)]
        );
        assert!(payouts(50, &[]).is_empty());
        // Écart voulu : la v1 rendait 28 (0,29 × 100 = 28,999… en flottant).
        assert_eq!(
            payouts(100, &stakes(&[(1, 29), (2, 71)])),
            [(1, 29), (2, 71)]
        );
    }

    #[test]
    fn the_closest_guesses_win_ties_included() {
        let guesses = [
            Guess {
                user: 1,
                amount: 50,
                prediction: 100,
            },
            Guess {
                user: 2,
                amount: 150,
                prediction: 120,
            },
            Guess {
                user: 3,
                amount: 10,
                prediction: 80,
            },
            Guess {
                user: 4,
                amount: 40,
                prediction: 300,
            },
        ];
        let winners = closest(&guesses, 110);
        assert_eq!(winners, [guesses[0], guesses[1]]);
        assert_eq!(winners[0].diff(110), 10);
        assert!(closest(&[], 3).is_empty());
        let extreme = Guess {
            user: 1,
            amount: 1,
            prediction: i64::MIN,
        };
        assert_eq!(extreme.diff(i64::MAX), u64::MAX);
    }

    #[test]
    fn percentages_and_bars_match_the_v1_display() {
        // (montant, total, pourcentage, cases pleines) relevés dans les messages de la v1.
        for (amount, total, expected, cells) in [
            (400, 1000, 40, 4),
            (600, 1000, 60, 6),
            (3, 4, 75, 8),
            (1, 4, 25, 3),
            (10, 100, 10, 1),
            (90, 100, 90, 9),
            (100, 100, 100, 10),
            (0, 100, 0, 0),
            (1_111_111_110, 1_666_666_665, 67, 7),
            (555_555_555, 1_666_666_665, 33, 3),
            (0, 0, 0, 0),
        ] {
            assert_eq!(percent(amount, total), expected, "{amount}/{total}");
            assert_eq!(filled_cells(expected), cells, "{expected} %");
        }
    }

    #[test]
    fn typed_numbers_are_whole_or_refused() {
        assert_eq!(whole_number("1 000"), Some(1000));
        assert_eq!(whole_number(" 42\u{202f}000 "), Some(42_000));
        assert_eq!(whole_number("-15"), Some(-15));
        assert_eq!(whole_number("+3"), Some(3));
        for bad in [
            "",
            "-",
            "12abc",
            "1e3",
            "1,5",
            "0x10",
            "99999999999999999999",
        ] {
            assert_eq!(whole_number(bad), None, "{bad}");
        }
        assert_eq!(amount("250"), Ok(250));
        assert_eq!(amount("0"), Err(Refusal::new(BAD_AMOUNT)));
        assert_eq!(amount("-5"), Err(Refusal::new(BAD_AMOUNT)));
    }
}
