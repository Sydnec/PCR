//! `/randomizabaise` : deux membres tirés au sort, et parfois (une fois sur `shinyOdds`) trois.

use rand::{Rng, RngExt as _, seq::index};

pub const TOO_FEW: &str = "Pas assez de membres éligibles pour faire un ship !";

/// Un ship.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Ship {
    pub members: Vec<i64>,
    pub shiny: bool,
}

/// Tire le ship parmi `members` : `None` s'il y en a moins de deux. Un ship shiny demande un
/// troisième membre (la v1 écrivait sinon « <@undefined> »).
pub fn draw(members: &[i64], shiny_odds: u32, rng: &mut (impl Rng + ?Sized)) -> Option<Ship> {
    if members.len() < 2 {
        return None;
    }
    let shiny = members.len() >= 3 && shiny_odds > 0 && rng.random_range(0..shiny_odds) == 0;
    let count = if shiny { 3 } else { 2 };
    let picked = index::sample(rng, members.len(), count)
        .into_iter()
        .map(|i| members[i])
        .collect();
    Some(Ship {
        members: picked,
        shiny,
    })
}

/// Le message de la v1.
pub fn message(ship: &Ship) -> String {
    let mentions: Vec<String> = ship.members.iter().map(|id| format!("<@{id}>")).collect();
    match mentions.as_slice() {
        [a, b, c] => {
            format!("✨ **SHINY RANDOMIZABAISE!** ✨\n💞 Aujourd'hui, je ship {a}, {b} et {c} !")
        }
        [a, b] => format!("💞 Aujourd'hui, je ship {a} et {b} !"),
        _ => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use rand::{SeedableRng as _, rngs::StdRng};

    use super::*;

    #[test]
    fn a_ship_takes_two_distinct_members_and_three_when_shiny() {
        let mut rng = StdRng::seed_from_u64(7);
        assert_eq!(draw(&[1], 1024, &mut rng), None);
        let ship = draw(&[1, 2], 1, &mut rng).expect("ship");
        // Pas de troisième membre : jamais shiny.
        assert!(!ship.shiny);
        assert_ne!(ship.members[0], ship.members[1]);
        let shiny = draw(&[1, 2, 3, 4], 1, &mut rng).expect("ship");
        assert!(shiny.shiny);
        assert_eq!(shiny.members.len(), 3);
        assert_eq!(
            message(&Ship {
                members: vec![1, 2],
                shiny: false
            }),
            "💞 Aujourd'hui, je ship <@1> et <@2> !"
        );
        assert_eq!(
            message(&Ship {
                members: vec![1, 2, 3],
                shiny: true
            }),
            "✨ **SHINY RANDOMIZABAISE!** ✨\n💞 Aujourd'hui, je ship <@1>, <@2> et <@3> !"
        );
    }
}
