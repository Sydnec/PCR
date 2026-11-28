//! Ce qu'un Pokémon laisse tomber en partant. En temps normal il part avec celui qui l'attrape ; de
//! temps en temps (`spawn.itemDropChance`) il le lâche par terre, et c'est une seconde course, ouverte
//! à tous sauf à celui qui vient de gagner la première. C'est aussi la seule chose qu'un Pokémon enfui
//! laisse derrière lui : une raison de suivre une apparition qu'on sait perdue.

use crate::{config::Spawn, ids};

/// Le ramasseur est celui qui vient de capturer le Pokémon.
pub const CAPTOR: &str = "🙅 Tu viens de le capturer : ce qu'il a lâché revient aux autres.";
/// Quelqu'un l'a ramassé avant.
pub const TOO_LATE: &str = "💨 Trop tard, quelqu'un a été plus rapide !";

/// Le tirage du lâcher (`roll` dans [0, 1)), et lui seul : les appelants décident quoi en faire.
pub fn leaves_item_behind(config: &Spawn, roll: f64) -> bool {
    let chance = config.item_drop_chance;
    chance > 0.0 && roll < chance
}

/// Le bouton du message d'un objet au sol : `poke_drop|<objet>` (gravé dans les messages v1).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Button {
    pub drop: i64,
}

impl Button {
    pub fn parse(custom_id: &str) -> Option<Self> {
        let parsed = ids::Parsed::new(custom_id);
        (parsed.action == "poke_drop").then_some(())?;
        Some(Self {
            drop: parsed.id(0)?,
        })
    }

    pub fn encode(self) -> String {
        ids::encode("poke_drop", &[&self.drop])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_drop_follows_the_configured_chance() {
        let config = Spawn::default();
        let chance = config.item_drop_chance;
        assert!(leaves_item_behind(&config, 0.0));
        assert!(!leaves_item_behind(&config, 0.999));
        assert!(leaves_item_behind(&config, chance - 0.001));
        assert!(!leaves_item_behind(&config, chance + 0.001));
        let never = Spawn {
            item_drop_chance: 0.0,
            ..Spawn::default()
        };
        assert!(!leaves_item_behind(&never, 0.0));
    }

    #[test]
    fn the_button_keeps_its_v1_name() {
        assert_eq!(Button::parse("poke_drop|12"), Some(Button { drop: 12 }));
        assert_eq!(Button { drop: 12 }.encode(), "poke_drop|12");
        assert_eq!(Button::parse("poke_drop|0"), None);
        assert_eq!(Button::parse("poke_owned|12"), None);
    }
}
