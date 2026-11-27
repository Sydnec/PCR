//! `GameConfig` : tous les réglages de jeu, avec les valeurs par défaut de la v1.
//!
//! Comme en v1, les valeurs par défaut sont aussi le schéma : un réglage absent d'ici n'existe pas,
//! et le type de son défaut impose celui qu'on peut écrire. Les surcharges (`/admin config`, le
//! site) ne contiennent que ce qui diffère, sous le chemin pointé de la v1
//! (« pokemon.spawn.shinyOdds ») ; `edit` les applique et les valide. Aucun identifiant Discord ici :
//! une copie prod → dev reste inerte (les emoji serveur des balls ne s'affichent simplement pas).

mod bounds;
mod community;
pub mod edit;
mod items;
mod pokemon;
pub mod render;
mod safari;
mod section;

pub use community::{
    Advent, Birthday, Cotd, Links, MessagePoints, MessagePointsRules, PublicMessages, PurgeMember,
    Randomizabaise, Redistribution, Reminders, Translation, Web, Week,
};
pub use items::{Charm, EvolutionItem, Item, Items, Rod};
pub use pokemon::{
    Ball, Balls, Bonus, ByRarity, Capture, Eggs, Evolution, Fishing, LockByDefault, Lottery,
    PageSize, Pc, Pokemon, Range, SeasonRecap, Sell, ShinyCharm, Showcase, Spawn, SpecialBall,
    SpecialBalls, StageCost, Stages, StarterReward, Starters, Trade, UnownText,
};
pub use safari::{Safari, SafariBall};
use section::section;

section! {
    /// La configuration de jeu complète, telle que la lisent les cas d'usage.
    pub struct GameConfig {
        message_points_distribution "messagePointsDistribution": MessagePoints = MessagePoints::default(),
        /// Propre à la v2 (absent du `DEFAULTS` v1).
        message_points "messagePoints": MessagePointsRules = MessagePointsRules::default(),
        pokemon "pokemon": Pokemon = Pokemon::default(),
        web "web": Web = Web::default(),
        public_messages "publicMessages": PublicMessages = PublicMessages::default(),
        links "links": Links = Links::default(),
        redistribution "redistribution": Redistribution = Redistribution::default(),
        purge_member "purgeMember": PurgeMember = PurgeMember::default(),
        birthday "birthday": Birthday = Birthday::default(),
        /// Propres à la v2 (absents du `DEFAULTS` v1).
        reminders "reminders": Reminders = Reminders::default(),
        week "week": Week = Week::default(),
        randomizabaise "randomizabaise": Randomizabaise = Randomizabaise::default(),
        cotd "cotd": Cotd = Cotd::default(),
        advent "advent": Advent = Advent::default(),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::Value;

    use super::*;

    /// Le `DEFAULTS` de la v1, écrit par la v1 elle-même (`JSON.stringify`).
    const V1_DEFAULTS: &str = include_str!("v1_defaults.json");
    /// Les branches que la v2 ajoute : la v1 codait ces règles en dur, avec la même valeur.
    const V2_ONLY: &[&str] = &[
        "messagePoints",
        "reminders",
        "week",
        "randomizabaise",
        "cotd",
        "advent",
    ];

    /// JavaScript ne distingue pas 1 de 1.0 : on compare les nombres en flottants.
    fn normalize(value: Value) -> Value {
        match value {
            Value::Number(n) => n
                .as_f64()
                .and_then(serde_json::Number::from_f64)
                .map_or(Value::Null, Value::Number),
            Value::Array(items) => Value::Array(items.into_iter().map(normalize).collect()),
            Value::Object(map) => {
                Value::Object(map.into_iter().map(|(k, v)| (k, normalize(v))).collect())
            }
            other => other,
        }
    }

    #[test]
    fn defaults_are_exactly_the_v1_defaults() {
        let v1: Value = serde_json::from_str(V1_DEFAULTS).expect("v1 defaults");
        let mut v2 = serde_json::to_value(GameConfig::default()).expect("serialize");
        for key in V2_ONLY {
            v2.as_object_mut().expect("tree").remove(*key);
        }
        assert_eq!(normalize(v2), normalize(v1));
    }
}
