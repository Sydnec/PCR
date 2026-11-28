//! Les lancers, règles pures : quelle ball se lance, avec quelle chance contre une apparition, le délai
//! entre deux lancers, et ce qu'un lancer a donné, dit en toutes lettres (le panneau Discord et le
//! site affichent la même phrase). Les boutons du panneau de relance (`poke_rethrow`…) sont ici aussi.

use std::fmt::Write as _;

use super::capture;
use crate::{
    config::{Ball, Pokemon, SpecialBall},
    format, ids,
};

/// Une ball qu'on peut lancer : ordinaire (Poké, Super, Hyper, Master) ou de la boutique.
#[derive(Debug, Clone, Copy)]
pub struct ThrowBall<'a> {
    pub key: &'static str,
    pub label: &'a str,
    pub emoji: &'a str,
    pub kind: Kind<'a>,
}

#[derive(Debug, Clone, Copy)]
pub enum Kind<'a> {
    Capture(&'a Ball),
    /// Achetée en boutique : elle se prend dans la poche, jamais payée au lancer.
    Special(&'a SpecialBall),
}

impl ThrowBall<'_> {
    pub fn is_special(&self) -> bool {
        matches!(self.kind, Kind::Special(_))
    }

    /// La Master Ball : capture garantie.
    pub fn guaranteed(&self) -> bool {
        matches!(self.kind, Kind::Capture(ball) if ball.guaranteed == Some(true))
    }

    /// La chance contre CETTE apparition : son taux figé, et le bonus d'une ball de la boutique si la
    /// pêche ou l'espèce le déclenche. Le lancer tire ce nombre, le panneau et le site l'affichent.
    pub fn probability(
        &self,
        config: &Pokemon,
        catch_rate: u32,
        fished: bool,
        species: u16,
    ) -> f64 {
        let multiplier = match self.kind {
            Kind::Capture(ball) if ball.guaranteed == Some(true) => return 1.0,
            Kind::Capture(ball) => ball.multiplier,
            Kind::Special(ball) => capture::special_ball_multiplier(ball, config, fished, species),
        };
        capture::catch_probability(&config.capture, catch_rate, multiplier)
    }
}

/// La ball qui capture à coup sûr (la Master Ball), reconnue par la config et non par sa clé.
pub fn guaranteed(config: &Pokemon) -> Option<(&'static str, &Ball)> {
    config
        .capture
        .balls
        .entries()
        .into_iter()
        .find(|(_, ball)| ball.guaranteed == Some(true))
}

/// Les balls de la boutique en jeu à cette génération, dans l'ordre du catalogue.
pub fn open_specials(
    config: &Pokemon,
    generation: u8,
) -> impl Iterator<Item = (&'static str, &SpecialBall)> {
    config
        .capture
        .special_balls
        .entries()
        .into_iter()
        .filter(move |(_, ball)| ball.generation <= generation)
}

/// La ball `key`, si elle se lance à cette génération : une ball de la boutique dont la génération
/// est fermée n'existe pas.
pub fn ball<'a>(config: &'a Pokemon, generation: u8, key: &str) -> Option<ThrowBall<'a>> {
    if let Some((key, special)) = open_specials(config, generation).find(|(k, _)| *k == key) {
        return Some(ThrowBall {
            key,
            label: &special.label,
            emoji: &special.emoji,
            kind: Kind::Special(special),
        });
    }
    config
        .capture
        .balls
        .entries()
        .into_iter()
        .find(|(k, _)| *k == key)
        .map(|(key, ball)| ThrowBall {
            key,
            label: &ball.label,
            emoji: &ball.emoji,
            kind: Kind::Capture(ball),
        })
}

/// Les secondes qu'il faut encore attendre (arrondies vers le haut), ou `None` : le lancer peut
/// partir. Le même délai pour Discord et le site : alterner les deux ne fait pas lancer plus vite.
pub fn cooldown_remaining(last_ms: Option<i64>, now_ms: i64, seconds: f64) -> Option<u64> {
    #[allow(clippy::cast_possible_truncation)] // Un délai de quelques secondes, saturé au pire.
    let cooldown = (seconds * 1000.0) as i64;
    let elapsed = now_ms - last_ms?;
    if cooldown <= 0 || elapsed >= cooldown {
        return None;
    }
    let remaining = cooldown - elapsed;
    u64::try_from((remaining + 999) / 1000).ok()
}

/// Ce qu'un lancer a coûté, dit comme le dresseur l'a vécu.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Paid {
    /// Une ball en poche : elle part avant les points.
    Offered {
        label: String,
    },
    /// Une ball de la boutique, achetée avant l'apparition.
    Used {
        label: String,
    },
    Points(i64),
}

impl Paid {
    fn mention(&self) -> String {
        match self {
            Self::Offered { label } => format!("{label} offerte"),
            Self::Used { label } => format!("{label} utilisée"),
            Self::Points(points) => format!("**-{}** points", format::number(*points)),
        }
    }

    /// Les points réellement pris : zéro pour une ball offerte, ce qui garde honnête le compte des
    /// points brûlés.
    pub fn points(&self) -> i64 {
        match self {
            Self::Points(points) => *points,
            _ => 0,
        }
    }
}

/// Ce qu'a donné un lancer.
#[derive(Debug, Clone, PartialEq)]
pub enum Outcome {
    UnknownBall,
    Cooldown {
        remaining: u64,
    },
    /// Capturé, enfui ou disparu : un Pokémon déjà parti ne coûte rien, même battu de peu.
    Gone,
    /// La touche de pêche d'un autre dresseur.
    NotYours,
    UnknownSpecies,
    /// Promise offerte (confirmation de la Master Ball), la ball n'est plus dans le sac.
    NoItem {
        ball: String,
    },
    /// Aucune ball de la boutique achetée avant cette apparition.
    NoUnit {
        ball: String,
        held: i64,
    },
    Insufficient {
        ball: String,
        price: i64,
        balance: i64,
    },
    /// Le prix annoncé à la confirmation a monté entre-temps.
    PriceChanged {
        ball: String,
        price: i64,
    },
    Miss {
        ball: String,
        paid: Paid,
        /// Le nom de l'apparition (shiny, sexe, forme).
        name: String,
        probability: f64,
    },
    Catch {
        paid: Paid,
        /// Le nom de l'individu qui rejoint la boîte.
        name: String,
        /// Il brillait pour son vainqueur, porteur du Charme Chroma : l'icône et le nom du charme.
        charm: Option<(String, String)>,
    },
}

impl Outcome {
    /// Plus rien à relancer : le panneau perd ses boutons.
    pub fn is_final(&self) -> bool {
        matches!(
            self,
            Self::Gone | Self::NotYours | Self::UnknownSpecies | Self::Catch { .. }
        )
    }

    /// L'issue en toutes lettres, textes de la v1.
    pub fn message(&self) -> String {
        match self {
            Self::UnknownBall => "❌ Ball inconnue.".to_owned(),
            Self::Cooldown { remaining } => {
                format!("⏳ Doucement ! Attends encore **{remaining}s** avant de relancer.")
            }
            Self::Gone => "💨 Ce Pokémon n'est plus là !".to_owned(),
            Self::NotYours => {
                "❌ Ce Pokémon a mordu à la ligne d'un autre dresseur : il n'est pas pour toi."
                    .to_owned()
            }
            Self::UnknownSpecies => "❌ Espèce inconnue.".to_owned(),
            Self::NoItem { ball } => {
                format!("❌ Tu n'as plus de **{ball}** dans ton inventaire. Rien n'a été débité.")
            }
            Self::NoUnit { ball, held } => format!(
                "❌ Aucune **{ball}** ne peut servir ici : tu en as {held}, mais une ball achetée \
                 ne sert qu'aux Pokémon qui apparaissent après son achat. Rien n'a été débité."
            ),
            Self::Insufficient {
                ball,
                price,
                balance,
            } => format!(
                "❌ Solde insuffisant : une **{ball}** coûte **{}** points, tu en as **{}**.",
                format::number(*price),
                format::number(*balance)
            ),
            Self::PriceChanged { ball, price } => format!(
                "❌ Le prix de ta **{ball}** est passé à **{}** points depuis ta confirmation. \
                 Rien n'a été débité.",
                format::number(*price)
            ),
            Self::Miss {
                ball,
                paid,
                name,
                probability,
            } => format!(
                "❌ Raté ! **{name}** s'est dégagé de ta {ball}. ({}, {} de réussite)",
                paid.mention(),
                format::percent(*probability, 1)
            ),
            Self::Catch { paid, name, charm } => {
                let mut text = format!(
                    "🎉 Bravo ! **{name}** rejoint ton Pokédex ! ({})",
                    paid.mention()
                );
                if let Some((emoji, label)) = charm {
                    let _ = write!(
                        text,
                        "\n{emoji} Il brillait pour toi, grâce à ton **{label}** !"
                    );
                }
                text
            }
        }
    }
}

/// Ce que porte la confirmation de la Master Ball : la promesse faite au dresseur. Offerte, le lancer
/// refuse si elle a disparu au lieu de se rabattre sur un prix jamais affiché ; payante, il refuse si
/// le prix a monté depuis.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Promise {
    Offered,
    Price(i64),
    /// Un bouton posté avant que le prix ne s'y inscrive : sans garde.
    Unspecified,
}

/// Les boutons des panneaux de lancer (éphémères) : relance, balls spéciales, Master Ball.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Button<'a> {
    /// `poke_rethrow|<apparition>|<ball>[|item]` : relance depuis le panneau ; `item` : annoncée
    /// offerte, elle ne se paie jamais en points.
    Rethrow {
        spawn: i64,
        ball: &'a str,
        item: bool,
    },
    /// `poke_respecial|<apparition>` : le menu des balls spéciales, dans le panneau.
    Respecial { spawn: i64 },
    /// `poke_reback|<apparition>` : retour aux balls ordinaires.
    Reback { spawn: i64 },
    /// `poke_master|<apparition>` : la confirmation, depuis le menu ouvert par l'annonce.
    Master { spawn: i64 },
    /// `poke_remaster|<apparition>` : la confirmation, dans le panneau.
    Remaster { spawn: i64 },
    /// `poke_master_ok|<apparition>|<item|prix>`.
    MasterOk { spawn: i64, promise: Promise },
    /// `poke_master_cancel|<apparition>` (sans apparition sur les plus anciens).
    MasterCancel { spawn: Option<i64> },
}

impl<'a> Button<'a> {
    pub fn parse(custom_id: &'a str) -> Option<Self> {
        let parsed = ids::Parsed::new(custom_id);
        if parsed.action == "poke_master_cancel" {
            return Some(Self::MasterCancel {
                spawn: parsed.id(0),
            });
        }
        let spawn = parsed.id(0)?;
        Some(match parsed.action {
            "poke_rethrow" => Self::Rethrow {
                spawn,
                ball: parsed.arg(1).filter(|ball| !ball.is_empty())?,
                item: parsed.arg(2) == Some("item"),
            },
            "poke_respecial" => Self::Respecial { spawn },
            "poke_reback" => Self::Reback { spawn },
            "poke_master" => Self::Master { spawn },
            "poke_remaster" => Self::Remaster { spawn },
            "poke_master_ok" => Self::MasterOk {
                spawn,
                promise: match parsed.arg(1) {
                    Some("item") => Promise::Offered,
                    Some(price)
                        if !price.is_empty() && price.bytes().all(|b| b.is_ascii_digit()) =>
                    {
                        price.parse().map_or(Promise::Unspecified, Promise::Price)
                    }
                    _ => Promise::Unspecified,
                },
            },
            _ => return None,
        })
    }

    pub fn encode(self) -> String {
        match self {
            Self::Rethrow { spawn, ball, item } if item => {
                ids::encode("poke_rethrow", &[&spawn, &ball, &"item"])
            }
            Self::Rethrow { spawn, ball, .. } => ids::encode("poke_rethrow", &[&spawn, &ball]),
            Self::Respecial { spawn } => ids::encode("poke_respecial", &[&spawn]),
            Self::Reback { spawn } => ids::encode("poke_reback", &[&spawn]),
            Self::Master { spawn } => ids::encode("poke_master", &[&spawn]),
            Self::Remaster { spawn } => ids::encode("poke_remaster", &[&spawn]),
            Self::MasterOk { spawn, promise } => match promise {
                Promise::Offered => ids::encode("poke_master_ok", &[&spawn, &"item"]),
                Promise::Price(price) => ids::encode("poke_master_ok", &[&spawn, &price]),
                Promise::Unspecified => ids::encode("poke_master_ok", &[&spawn]),
            },
            Self::MasterCancel { spawn: Some(spawn) } => {
                ids::encode("poke_master_cancel", &[&spawn])
            }
            Self::MasterCancel { spawn: None } => "poke_master_cancel".to_owned(),
        }
    }
}

#[cfg(test)]
mod tests;
