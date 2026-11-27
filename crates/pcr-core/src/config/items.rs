//! Le catalogue des objets : un objet n'est qu'une clé et ce que la config en dit (nom, icône,
//! poids de tirage, effet). Le code donne l'effet, le catalogue ses chiffres. Valeurs de la v1.
//!
//! Chaque champ est facultatif : un objet n'en porte que quelques-uns (une ball offerte n'a pas de
//! prix de revente, une canne pas de poids de loterie), et un champ absent ne paraît pas dans l'arbre
//! des réglages, comme en v1.

use std::collections::BTreeMap;

use super::{pokemon::Range, section::section};

section! {
    pub struct Items {
        ball_poke "ball_poke": Item = Item {
            drop_weight: Some(400.0),
            lottery_weight: Some(640.0),
            lot: Some(Range { min: 1, max: 5 }),
            ..Item::free_ball("poke")
        },
        ball_super "ball_super": Item = Item {
            drop_weight: Some(200.0),
            lottery_weight: Some(330.0),
            lot: Some(Range { min: 1, max: 3 }),
            ..Item::free_ball("super")
        },
        super_bonbon "super_bonbon": Item = Item {
            sell_value: Some(300),
            drop_weight: Some(120.0),
            evolution: Some(EvolutionItem { copies: 1, quantity: 3, ..EvolutionItem::default() }),
            lot: Some(Range { min: 1, max: 3 }),
            ..Item::named("Super Bonbon", "🍬", "rare-candy",
                "Trois d'entre eux tiennent lieu d'un sacrifice dans une évolution.")
        },
        ball_hyper "ball_hyper": Item = Item {
            drop_weight: Some(80.0),
            lot: Some(Range { min: 1, max: 2 }),
            ..Item::free_ball("hyper")
        },
        evolyte "evolyte": Item = Item {
            sell_value: Some(500),
            drop_weight: Some(20.0),
            evolution: Some(EvolutionItem {
                copies: 1,
                quantity: 1,
                choose: Some(vec![133]),
                free_points: Some(true),
                targets: None,
            }),
            ..Item::named("Évolyte", "🔮", "eviolite",
                "Un Évoli qui évolue avec lui prend la forme de ton choix, sans payer de points. Il tient lieu d'un sacrifice.")
        },
        pierre_soleil "pierre_soleil": Item = Item::evolution_stone(
            Item::named("Pierre Soleil", "☀️", "sun-stone",
                "Un Ortide qui évolue avec elle devient Joliflor plutôt que Rafflesia. Elle tient lieu d'un sacrifice."),
            &[(44, 182)],
        ),
        roche_royale "roche_royale": Item = Item::evolution_stone(
            Item::named("Roche Royale", "👑", "kings-rock",
                "Têtarte devient Tarpaud plutôt que Tartard, Ramoloss devient Roigada plutôt que Flagadoss. Elle tient lieu d'un sacrifice."),
            &[(61, 186), (79, 199)],
        ),
        catalyseur "catalyseur": Item = Item::evolution_stone(
            Item::named("Catalyseur", "⚙️", "up-grade",
                "Sans lui, Onix, Insécateur, Hypocéan et Porygon n'évoluent pas. Il tient lieu d'un sacrifice."),
            &[(95, 208), (123, 212), (117, 230), (137, 233)],
        ),
        pepite "pepite": Item = Item {
            sell_value: Some(4000),
            drop_weight: Some(50.0),
            ..Item::named("Pépite", "💎", "nugget", "Ça brille, et ça ne sert qu'à ça : se revendre.")
        },
        ticket_safari "ticket_safari": Item = Item {
            drop_weight: Some(20.0),
            ..Item::named("Ticket Safari", "🎟️", "pass", "Une entrée pour le parc safari.")
        },
        ball_master "ball_master": Item = Item {
            description: Some(
                "La capture garantie, offerte. Autant dire qu'elle ne se trouve pas.".into(),
            ),
            lottery_weight: Some(2.0),
            max_held: Some(1),
            overflow_value: Some(10_000),
            ..Item::free_ball("master")
        },
        canne "canne": Item = Item {
            rod: Some(Rod { pool: "old".into(), price: 100, base: Some(true) }),
            ..Item::named("Canne", "🎣", "old-rod", "La canne de base : surtout des Magicarpe.")
        },
        super_canne "super_canne": Item = Item {
            drop_weight: Some(20.0),
            lottery_weight: Some(60.0),
            lot: Some(Range { min: 1, max: 1 }),
            max_held: Some(1),
            overflow_value: Some(500),
            upgrades_to: Some("mega_canne".into()),
            rod: Some(Rod { pool: "good".into(), price: 100, base: None }),
            ..Item::named("Super Canne", "🎣", "good-rod", "Des prises plus variées.")
        },
        mega_canne "mega_canne": Item = Item {
            drop_weight: Some(8.0),
            lottery_weight: Some(25.0),
            lot: Some(Range { min: 1, max: 1 }),
            max_held: Some(1),
            overflow_value: Some(1000),
            rod: Some(Rod { pool: "super".into(), price: 100, base: None }),
            ..Item::named("Méga Canne", "🎣", "super-rod", "Les prises les plus rares.")
        },
        charme_chroma_1 "charme_chroma_1": Item = Item {
            charm: Some(Charm { generation: 1 }),
            ..Item::named("Charme Chroma (1re gén.)", "🌟", "shiny-charm",
                "Pokédex de la 1re génération complété : chances de shiny doublées sur ses Pokémon.")
        },
        charme_chroma_2 "charme_chroma_2": Item = Item {
            charm: Some(Charm { generation: 2 }),
            ..Item::named("Charme Chroma (2e gén.)", "🌟", "shiny-charm",
                "Pokédex de la 2e génération complété : chances de shiny doublées sur ses Pokémon.")
        },
    }
}

impl Items {
    /// Le catalogue dans l'ordre de déclaration, celui de la v1 : le sac, les tables de tirage et
    /// les menus le suivent (un tri par clé mettrait « `ball_hyper` » avant « `ball_poke` »).
    pub fn entries(&self) -> [(&'static str, &Item); 16] {
        [
            ("ball_poke", &self.ball_poke),
            ("ball_super", &self.ball_super),
            ("super_bonbon", &self.super_bonbon),
            ("ball_hyper", &self.ball_hyper),
            ("evolyte", &self.evolyte),
            ("pierre_soleil", &self.pierre_soleil),
            ("roche_royale", &self.roche_royale),
            ("catalyseur", &self.catalyseur),
            ("pepite", &self.pepite),
            ("ticket_safari", &self.ticket_safari),
            ("ball_master", &self.ball_master),
            ("canne", &self.canne),
            ("super_canne", &self.super_canne),
            ("mega_canne", &self.mega_canne),
            ("charme_chroma_1", &self.charme_chroma_1),
            ("charme_chroma_2", &self.charme_chroma_2),
        ]
    }
}

section! {
    pub struct Item {
        /// Une ball offerte : elle prend nom, icône et image de la ball de capture.
        #[serde(skip_serializing_if = "Option::is_none")]
        ball "ball": Option<String> = None,
        #[serde(skip_serializing_if = "Option::is_none")]
        label "label": Option<String> = None,
        #[serde(skip_serializing_if = "Option::is_none")]
        emoji "emoji": Option<String> = None,
        #[serde(skip_serializing_if = "Option::is_none")]
        sprite "sprite": Option<String> = None,
        #[serde(skip_serializing_if = "Option::is_none")]
        description "description": Option<String> = None,
        #[serde(skip_serializing_if = "Option::is_none")]
        sell_value "sellValue": Option<u32> = None,
        #[serde(skip_serializing_if = "Option::is_none")]
        drop_weight "dropWeight": Option<f64> = None,
        #[serde(skip_serializing_if = "Option::is_none")]
        lottery_weight "lotteryWeight": Option<f64> = None,
        /// Combien en donne un lot de loterie.
        #[serde(skip_serializing_if = "Option::is_none")]
        lot "lot": Option<Range> = None,
        /// Trouvable à partir de cette génération.
        #[serde(skip_serializing_if = "Option::is_none")]
        generation "generation": Option<u8> = None,
        /// Au-delà, un exemplaire de plus se change en `overflowValue` points.
        #[serde(skip_serializing_if = "Option::is_none")]
        max_held "maxHeld": Option<u32> = None,
        #[serde(skip_serializing_if = "Option::is_none")]
        overflow_value "overflowValue": Option<u32> = None,
        #[serde(skip_serializing_if = "Option::is_none")]
        upgrades_to "upgradesTo": Option<String> = None,
        #[serde(skip_serializing_if = "Option::is_none")]
        evolution "evolution": Option<EvolutionItem> = None,
        #[serde(skip_serializing_if = "Option::is_none")]
        rod "rod": Option<Rod> = None,
        #[serde(skip_serializing_if = "Option::is_none")]
        charm "charm": Option<Charm> = None,
    }
}

impl Item {
    fn named(label: &str, emoji: &str, sprite: &str, description: &str) -> Self {
        Self {
            label: Some(label.into()),
            emoji: Some(emoji.into()),
            sprite: Some(sprite.into()),
            description: Some(description.into()),
            ..Self::default()
        }
    }

    fn free_ball(ball: &str) -> Self {
        Self {
            ball: Some(ball.into()),
            description: Some(
                "Un lancer offert : tu la tiens déjà, elle ne te coûtera rien.".into(),
            ),
            ..Self::default()
        }
    }

    /// Une pierre d'évolution de 2e génération : vaut 500 à la revente, tient lieu d'un sacrifice,
    /// et change la cible de l'évolution des espèces de `targets` (espèce → nouvelle cible).
    fn evolution_stone(named: Self, targets: &[(u16, u16)]) -> Self {
        Self {
            sell_value: Some(500),
            drop_weight: Some(20.0),
            generation: Some(2),
            evolution: Some(EvolutionItem {
                copies: 1,
                quantity: 1,
                targets: Some(targets.iter().copied().collect()),
                ..EvolutionItem::default()
            }),
            ..named
        }
    }
}

section! {
    /// Un objet qui tient lieu de `copies` sacrifices, par `quantity` exemplaires.
    pub struct EvolutionItem {
        copies "copies": u32 = 1,
        quantity "quantity": u32 = 1,
        /// Espèces dont l'évolution laisse choisir la forme (Évoli).
        #[serde(skip_serializing_if = "Option::is_none")]
        choose "choose": Option<Vec<u16>> = None,
        #[serde(skip_serializing_if = "Option::is_none")]
        free_points "freePoints": Option<bool> = None,
        #[serde(skip_serializing_if = "Option::is_none")]
        targets "targets": Option<BTreeMap<u16, u16>> = None,
    }
}

section! {
    pub struct Rod {
        /// La table de pêche (`data/fishing.json`) de la canne.
        pool "pool": String = String::new(),
        price "price": u32 = 0,
        #[serde(skip_serializing_if = "Option::is_none")]
        base "base": Option<bool> = None,
    }
}

section! {
    pub struct Charm {
        generation "generation": u8 = 1,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Un objet ajouté au catalogue sans passer par `entries` n'existerait pour aucun tirage.
    #[test]
    fn entries_follow_the_declared_catalogue() {
        let items = Items::default();
        let tree = serde_json::to_value(&items).expect("serialize");
        let declared: Vec<&str> = tree
            .as_object()
            .expect("tree")
            .keys()
            .map(String::as_str)
            .collect();
        let listed: Vec<&str> = items.entries().iter().map(|(key, _)| *key).collect();
        assert_eq!(listed, declared);
    }
}
