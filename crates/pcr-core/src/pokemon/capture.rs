//! Les chances de capture, la difficulté, le prix personnel de la Master Ball et le shiny. Le
//! lancer, le site et chaque fiche passent par ces fonctions : ce qui s'affiche est ce qui se tire.

use super::{lineage, species::Species};
use crate::config::{Ball, Capture, Pokemon, SpecialBall};

/// Le dénominateur de la formule de la génération 3 à PV pleins, sans altération d'état :
/// a = taux × ball / 3, et P = (b / 65536)⁴ se simplifie exactement en a / 255.
const FORMULA_DENOMINATOR: f64 = 765.0;

/// Le taux réellement appliqué : celui de l'espèce, relevé au plancher `capture.minCatchRate`
/// (on ne peut pas affaiblir un Pokémon avant de lancer, et un légendaire à taux 3 n'aurait jamais
/// été attrapé). Tout ce qui se tire ou s'affiche passe par ici.
pub fn effective_catch_rate(capture: &Capture, catch_rate: u32) -> u32 {
    catch_rate.max(capture.min_catch_rate)
}

/// La formule officielle de la génération 3. `capture.globalMultiplier` rend tout le jeu plus ou
/// moins dur sans toucher à la hiérarchie entre espèces.
pub fn catch_probability(capture: &Capture, catch_rate: u32, ball_multiplier: f64) -> f64 {
    let rate = f64::from(effective_catch_rate(capture, catch_rate));
    (rate * ball_multiplier * capture.global_multiplier / FORMULA_DENOMINATOR).clamp(0.0, 1.0)
}

/// La chance d'une ball de capture, telle que l'annoncent les fiches.
#[derive(Debug, Clone, Copy)]
pub struct BallChance<'a> {
    pub key: &'static str,
    pub ball: &'a Ball,
    pub probability: f64,
}

/// Les quatre balls dans l'ordre du catalogue, la Master Ball garantie.
pub fn probabilities_by_ball(capture: &Capture, catch_rate: u32) -> Vec<BallChance<'_>> {
    capture
        .balls
        .entries()
        .into_iter()
        .map(|(key, ball)| BallChance {
            key,
            ball,
            probability: if ball.guaranteed == Some(true) {
                1.0
            } else {
                catch_probability(capture, catch_rate, ball.multiplier)
            },
        })
        .collect()
}

/// Le multiplicateur d'une ball spéciale face à cette apparition : celui de son bonus quand la
/// condition est remplie (le Pokémon vient d'une pêche, ou son espèce évolue grâce à l'objet).
pub fn special_ball_multiplier(
    ball: &SpecialBall,
    config: &Pokemon,
    fished: bool,
    species: u16,
) -> f64 {
    let bonus = &ball.bonus;
    let met = (bonus.fished == Some(true) && fished)
        || bonus
            .item
            .as_deref()
            .is_some_and(|item| lineage::species_evolving_with(config, item).contains(&species));
    if met {
        ball.multiplier * bonus.multiplier
    } else {
        ball.multiplier
    }
}

/// Une ball dont le prix monte à chaque achat (la Master Ball) : il dépend de celui qui la paie.
pub fn has_personal_price(ball: &Ball) -> bool {
    ball.price_growth.is_some_and(|growth| growth > 1.0)
}

/// Le plus grand entier qu'un nombre JavaScript représente exactement : le plafond v1 d'un prix
/// qui monte, pour qu'un facteur réglé très haut ne donne jamais un prix infini.
const MAX_PRICE: i64 = 9_007_199_254_740_991;

/// Le prix de la ball quand son dresseur en a déjà payé `purchases` en points, calculé depuis le
/// prix de base (l'arrondi ne s'accumule pas d'un achat à l'autre).
pub fn price_after(ball: &Ball, purchases: u32) -> i64 {
    let Some(growth) = ball.price_growth.filter(|_| has_personal_price(ball)) else {
        return i64::from(ball.price);
    };
    let exponent = i32::try_from(purchases).unwrap_or(i32::MAX);
    let price = (f64::from(ball.price) * growth.powi(exponent)).round();
    #[allow(clippy::cast_possible_truncation, clippy::cast_precision_loss)] // Plafonné juste avant.
    if price >= MAX_PRICE as f64 {
        MAX_PRICE
    } else {
        price as i64
    }
}

/// La difficulté d'une espèce, du plus facile (0) au plus dur (5) : le rang sert au site, qui la
/// colore ; Discord n'en affiche que le libellé.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Difficulty {
    pub level: u8,
    pub label: &'static str,
}

const DIFFICULTIES: [(u32, &str); 5] = [
    (190, "Très facile"),
    (120, "Facile"),
    (60, "Moyenne"),
    (40, "Difficile"),
    (10, "Très difficile"),
];

/// Passe par le plancher : un légendaire n'est plus « Extrême ».
pub fn difficulty_of(capture: &Capture, catch_rate: u32) -> Difficulty {
    let rate = effective_catch_rate(capture, catch_rate);
    let found = DIFFICULTIES
        .iter()
        .zip(0..)
        .find(|((min, _), _)| rate >= *min);
    match found {
        Some(((_, label), level)) => Difficulty { level, label },
        None => Difficulty {
            level: 5,
            label: "Extrême",
        },
    }
}

/// Le shiny d'une apparition, commun à tout le salon.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ShinyRoll {
    /// Shiny pour tout le monde.
    pub shiny: bool,
    /// Shiny pour les seuls porteurs du Charme Chroma de sa génération.
    pub charm: bool,
}

/// Combien de fois plus de shiny voit un porteur du Charme Chroma (jamais moins).
pub fn charm_multiplier(config: &Pokemon) -> f64 {
    let multiplier = config.shiny_charm.multiplier;
    if multiplier.is_finite() {
        multiplier.max(1.0)
    } else {
        1.0
    }
}

/// Le facteur de shiny d'un dresseur pour une espèce : seul le charme de sa génération compte.
pub fn charm_factor(config: &Pokemon, species: &Species, charms: &[u8]) -> f64 {
    if charms.contains(&species.generation) {
        charm_multiplier(config)
    } else {
        1.0
    }
}

/// Un seul nombre tiré (`roll` dans [0, 1)) pour tout le salon : sous 1/odds l'apparition brille
/// pour tout le monde, entre 1/odds et multiplicateur/odds pour les porteurs du charme. Chacun
/// d'eux a ainsi exactement `multiplier` fois plus de chances, et les autres, les mêmes.
pub fn roll_shiny(config: &Pokemon, odds: u32, roll: f64) -> ShinyRoll {
    let position = roll * f64::from(odds.max(1));
    ShinyRoll {
        shiny: position < 1.0,
        charm: (1.0..charm_multiplier(config)).contains(&position),
    }
}

#[cfg(test)]
mod tests;
