//! Les apparitions du salon, règles pures : quand un message, une capture ou un administrateur en
//! revendique une, ce qu'elle tire à sa naissance, combien de temps elle reste, qui son annonce
//! appelle, et les boutons de son message public (`custom_id` v1 `poke_*`).
//!
//! Tout ce qui fait la rencontre est tiré une fois, à la naissance, puis figé en base : retoucher la
//! config ne change pas une partie en cours, et l'individu capturé est celui que l'annonce a montré.

use rand::{Rng, RngExt as _};

use super::{
    capture::{self, ShinyRoll},
    items,
    rarity::{Rarity, rarity_of},
    species::{Sex, Species},
    weights::{Draw, Pool},
};
use crate::{config::Spawn, ids};

const MINUTE_MS: i64 = 60_000;

/// Le bouton d'une apparition qui n'existe plus (ou jamais) en base.
pub const GONE: &str = "❌ Ce Pokémon est introuvable.";
/// `/admin pokespawn` sans salon des apparitions.
pub const NO_CHANNEL: &str = "❌ `pokemon_channel_id` n'est pas configuré.";
/// `/admin pokespawn` sur une saisie qui ne désigne aucune espèce.
pub const UNKNOWN_SPECIES: &str = "❌ Espèce inconnue.";
/// Aucune espèce à tirer (tous les poids à zéro).
pub const EMPTY_POOL: &str = "❌ Aucune espèce disponible pour le spawn.";

/// `/admin pokespawn` sur une espèce d'une génération encore fermée : un événement ne doit pas servir
/// à l'ouvrir en douce.
pub fn closed_generation(species: &Species, generation: u8) -> String {
    format!(
        "❌ **{}** est de génération {}, et le jeu s'arrête pour l'instant à la génération {generation}.",
        species.name, species.generation
    )
}

/// Ce qui pousse à revendiquer une apparition.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Cause {
    /// Un message d'un membre, déjà compté.
    Message,
    /// Une capture vient de vider le salon : le suivant n'attend pas de message.
    Capture,
    /// `/admin pokespawn` : sans condition. La pause d'un parc safari est ignorée, un administrateur
    /// doit pouvoir faire apparaître un Pokémon quoi qu'il arrive.
    Forced,
}

/// Le salon tel que la revendication le lit, dans sa transaction.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Channel {
    /// Les messages comptés depuis la dernière apparition, celui qui revendique compris.
    pub message_count: i64,
    pub last_spawn_at: i64,
    /// Un parc safari occupe le salon jusque-là (ms).
    pub paused_until: i64,
    /// La rareté du Pokémon encore là, s'il y en a un.
    pub active: Option<Rarity>,
    /// La fin de la dernière apparition du salon (capture ou fuite) ; une pêche n'occupe pas le salon.
    pub last_end: Option<i64>,
}

/// Le droit de faire apparaître un Pokémon maintenant.
///
/// - Salon vide (plus personne, délai plancher `minDelayAfterEndMinutes` écoulé) : le prochain
///   message en fait apparaître un, et une capture n'attend même pas de message.
/// - Un Pokémon est encore là : le seuil de messages et le délai minimum décident du moment où il
///   s'enfuit, remplacé par le suivant. Sauf un légendaire, que les messages ne chassent jamais.
/// - Un parc safari suspend tout, sauf l'administrateur. Les messages, eux, continuent de compter :
///   à la réouverture, le message suivant fait apparaître un Pokémon sans attendre le seuil.
pub fn claims(cause: Cause, channel: &Channel, now_ms: i64, config: &Spawn) -> bool {
    if cause == Cause::Forced {
        return true;
    }
    if channel.paused_until > now_ms {
        return false;
    }
    let after_end = i64::from(config.min_delay_after_end_minutes) * MINUTE_MS;
    let empty = channel.active.is_none() && channel.last_end.unwrap_or(0) <= now_ms - after_end;
    if cause == Cause::Capture {
        return empty;
    }
    let min_delay = i64::from(config.min_delay_minutes) * MINUTE_MS;
    let replaces = channel.message_count >= i64::from(config.messages_per_spawn)
        && channel.last_spawn_at <= now_ms - min_delay
        && channel.active != Some(Rarity::Legendary);
    empty || replaces
}

/// L'échéance de fuite (ms), tirée à la naissance (`roll` dans [0, 1)) et jamais recalculée : elle
/// survit aux redémarrages. Celle d'un légendaire multiplie les deux bornes par
/// `legendaryFleeMultiplier` (jamais sous 1) : la fourchette s'allonge sans se resserrer. Une
/// fourchette saisie à l'envers se lit à l'endroit.
pub fn flee_deadline(spawned_at: i64, config: &Spawn, rarity: Rarity, roll: f64) -> i64 {
    let range = &config.flee_after_minutes;
    let multiplier = config.legendary_flee_multiplier;
    let factor = if rarity == Rarity::Legendary && multiplier.is_finite() {
        multiplier.max(1.0)
    } else {
        1.0
    };
    let low = f64::from(range.min.min(range.max)) * factor;
    let span = f64::from(range.min.abs_diff(range.max)) * factor;
    #[allow(clippy::cast_possible_truncation, clippy::cast_precision_loss)]
    // Une conversion de flottant en entier sature : un facteur démesuré repousse l'échéance au plus
    // loin, sans déborder.
    let offset = ((low + roll * span) * MINUTE_MS as f64).round() as i64;
    spawned_at.saturating_add(offset)
}

/// Ce qu'un administrateur impose à une apparition (`/admin pokespawn`).
#[derive(Debug, Clone, Copy, Default)]
pub struct Forced {
    /// N'importe quelle espèce jouable, hors pool comprise : c'est l'intérêt d'un événement.
    pub species: Option<&'static Species>,
    /// Shiny (ou pas) pour tout le salon, sans Charme Chroma.
    pub shiny: Option<bool>,
}

/// Ce qu'une apparition tire à sa naissance.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Encounter {
    pub species: &'static Species,
    pub rarity: Rarity,
    /// Un seul tirage pour tout le salon : shiny pour tous, ou pour les porteurs du Charme Chroma.
    pub shiny: ShinyRoll,
    /// Ce qu'il tient : il l'emporte s'il s'enfuit.
    pub held_item: Option<&'static str>,
    /// Celui de l'individu qui rejoindra la boîte de son vainqueur, que l'annonce montre déjà.
    pub sex: Option<Sex>,
    /// La lettre d'un Zarbi.
    pub form: Option<&'static str>,
}

/// Tire une apparition dans le pool sauvage de la génération jouable ; `None` si le pool est vide.
pub fn roll(draw: &Draw<'_>, forced: Forced, rng: &mut (impl Rng + ?Sized)) -> Option<Encounter> {
    let species = match forced.species {
        Some(species) => species,
        None => draw.pick_at(Pool::spawn(draw.config), None, rng.random())?,
    };
    let shiny = match forced.shiny {
        Some(shiny) => ShinyRoll {
            shiny,
            charm: false,
        },
        None => capture::roll_shiny(draw.config, draw.config.spawn.shiny_odds, rng.random()),
    };
    let held_item = items::roll_held_item(draw.config, draw.generation, rng).map(|item| item.key);
    Some(Encounter {
        species,
        rarity: rarity_of(species, draw.config),
        shiny,
        held_item,
        sex: species.roll_sex(rng),
        form: species.roll_form(draw.generation, rng),
    })
}

/// L'annonce mentionne-t-elle le rôle Pokémon ? Pour un shiny (de tout le salon) et les raretés de
/// `pingRarities` ; l'administrateur peut forcer ou supprimer la mention.
pub fn pings_role(config: &Spawn, rarity: Rarity, shiny: bool, forced: Option<bool>) -> bool {
    forced.unwrap_or_else(|| shiny || config.ping_rarities.iter().any(|key| key == rarity.key()))
}

/// Les boutons du message public d'une apparition. Ils sont gravés dans les messages déjà postés,
/// v1 comprise : leurs noms ne changent pas.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Button<'a> {
    /// `poke_throw|<apparition>|<ball>` : lancer une ball ordinaire.
    Throw { spawn: i64, ball: &'a str },
    /// `poke_special|<apparition>` : la Master Ball et les balls de la boutique.
    Special { spawn: i64 },
    /// `poke_owned|<apparition>` : la fiche de l'espèce. Le nom date du bouton « Je l'ai déjà ? »
    /// que la fiche a remplacé.
    Info { spawn: i64 },
}

impl<'a> Button<'a> {
    pub fn parse(custom_id: &'a str) -> Option<Self> {
        let parsed = ids::Parsed::new(custom_id);
        let spawn = parsed.id(0)?;
        Some(match parsed.action {
            "poke_throw" => Self::Throw {
                spawn,
                ball: parsed.arg(1).filter(|ball| !ball.is_empty())?,
            },
            "poke_special" => Self::Special { spawn },
            "poke_owned" => Self::Info { spawn },
            _ => return None,
        })
    }

    pub fn encode(self) -> String {
        match self {
            Self::Throw { spawn, ball } => ids::encode("poke_throw", &[&spawn, &ball]),
            Self::Special { spawn } => ids::encode("poke_special", &[&spawn]),
            Self::Info { spawn } => ids::encode("poke_owned", &[&spawn]),
        }
    }
}

#[cfg(test)]
mod tests;
