//! Rappels : la date tapée dans `/rappel` (heure de Paris), le bouton « Me rappeler aussi » et ses
//! `custom_id`, refus.
//!
//! Le bouton de la v1 portait l'instant et le message (`rappel|<ms>|<message encodé>`), si bien
//! qu'un message un peu long dépassait les 100 caractères permis et faisait échouer `/rappel`. La v2
//! garde ce format quand il tient (les anciens boutons se décodent toujours) et, sinon, renvoie au
//! rappel d'origine par son numéro (`rappel|<ms>|#<id>`) : `encodeURIComponent` encode `#`, aucun
//! bouton v1 ne commence donc ainsi.

use jiff::{
    Timestamp,
    civil::{Date, Time},
};

use std::fmt::Write as _;

use crate::{clock::paris, ids::Parsed, refusal::Refusal};

/// Le message d'un rappel sans message.
pub const DEFAULT_MESSAGE: &str = "Rappel !";
pub const BAD_DATE: &str = "❌ Format de date invalide. Utilise :\n• `JJ/MM/AAAA HH:MM` (ex: 25/12/2024 15:30)\n• `JJ/MM HH:MM` (ex: 25/12 15:30)";
pub const IN_THE_PAST: &str = "❌ La date doit être dans le futur !";
/// Un clic sur le bouton d'un rappel dont l'heure est passée.
pub const ALREADY_PAST: &str = "❌ Ce rappel est déjà passé !";
/// Le rappel d'origine a été supprimé avant son heure : le bouton n'a plus de message à copier.
pub const SOURCE_GONE: &str = "❌ Ce rappel n'existe plus.";
pub const NOT_YOURS: &str = "❌ Ce rappel n'existe pas ou ne t'appartient pas.";

/// Les années qu'accepte la saisie, comme en v1 : au-delà, une faute de frappe.
const YEARS: std::ops::RangeInclusive<i16> = 2024..=2100;
/// Longueur maximale d'un `custom_id` pour Discord.
const CUSTOM_ID_MAX: usize = 100;
const ACTION: &str = "rappel";

/// Trop loin : `days` jours au plus (un an par défaut, le texte de la v1).
pub fn too_far(days: u32) -> Refusal {
    Refusal::new(if days == 365 {
        "❌ La date ne peut pas être à plus d'un an dans le futur !".to_owned()
    } else {
        format!("❌ La date ne peut pas être à plus de {days} jours dans le futur !")
    })
}

/// « JJ/MM/AAAA HH:MM » ou « JJ/MM HH:MM » (année en cours à Paris), heure de Paris. `None` si le
/// format ou la date sont invalides (le 31/02 n'existe pas). Une heure que le passage à l'heure d'été
/// saute (2 h 30 fin mars) devient l'heure qui suit.
pub fn parse_when(text: &str, now: Timestamp) -> Option<Timestamp> {
    let (date, time) = text.trim().split_once(char::is_whitespace)?;
    let mut fields = date.split('/');
    let day: i8 = number(fields.next()?, 2)?;
    let month: i8 = number(fields.next()?, 2)?;
    let year: i16 = match fields.next() {
        Some(year) if year.len() == 4 => number(year, 4)?,
        Some(_) => return None,
        None => crate::clock::paris_date(now).year(),
    };
    if fields.next().is_some() || !YEARS.contains(&year) {
        return None;
    }
    let (hour, minute) = time.trim().split_once(':')?;
    let hour: i8 = number(hour, 2)?;
    if minute.len() != 2 {
        return None;
    }
    let minute: i8 = number(minute, 2)?;
    let date = Date::new(year, month, day).ok()?;
    let time = Time::new(hour, minute, 0, 0).ok()?;
    paris().to_timestamp(date.to_datetime(time)).ok()
}

/// Un nombre d'au plus `max` chiffres, sans signe ni blanc.
fn number<T: std::str::FromStr>(text: &str, max: usize) -> Option<T> {
    if text.is_empty() || text.len() > max || !text.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    text.parse().ok()
}

/// Ce qu'emporte le bouton « Me rappeler aussi ».
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Button {
    /// L'instant (ms) et le message, dans le bouton : le format de la v1.
    Inline { at_ms: i64, message: String },
    /// L'instant et le rappel d'origine, dont on recopie le message.
    Copy { at_ms: i64, reminder: i64 },
}

impl Button {
    pub fn parse(custom_id: &str) -> Option<Self> {
        let parsed = Parsed::new(custom_id);
        if parsed.action != ACTION {
            return None;
        }
        let at_ms = parsed.arg(0)?.parse().ok()?;
        // Le message encodé ne contient jamais `|` (encodé en %7C) : un seul champ.
        let payload = parsed.arg(1)?;
        Some(match payload.strip_prefix('#') {
            Some(id) => Self::Copy {
                at_ms,
                reminder: id.parse().ok().filter(|id| *id > 0)?,
            },
            None => Self::Inline {
                at_ms,
                message: decode_uri_component(payload)?,
            },
        })
    }

    /// Le bouton d'un rappel tout juste créé : son message s'il tient, sinon son numéro.
    pub fn for_reminder(at_ms: i64, message: &str, reminder: i64) -> String {
        let inline = format!("{ACTION}|{at_ms}|{}", encode_uri_component(message));
        if inline.len() <= CUSTOM_ID_MAX {
            inline
        } else {
            format!("{ACTION}|{at_ms}|#{reminder}")
        }
    }
}

/// `encodeURIComponent` de JavaScript : tout sauf `A-Z a-z 0-9 - _ . ! ~ * ' ( )`, en UTF-8.
pub fn encode_uri_component(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
            out.push(char::from(byte));
        } else {
            let _ = write!(out, "%{byte:02X}");
        }
    }
    out
}

/// `decodeURIComponent` : `None` pour un encodage invalide, comme l'erreur de JavaScript.
pub fn decode_uri_component(text: &str) -> Option<String> {
    let mut bytes = Vec::with_capacity(text.len());
    let mut rest = text.as_bytes();
    while let Some((&byte, tail)) = rest.split_first() {
        if byte == b'%' {
            let hex = tail.get(..2)?;
            bytes.push(u8::from_str_radix(std::str::from_utf8(hex).ok()?, 16).ok()?);
            rest = &tail[2..];
        } else {
            bytes.push(byte);
            rest = tail;
        }
    }
    String::from_utf8(bytes).ok()
}

/// « Créé le 27/11/2026 14:30:00 » : `toLocaleString("fr-FR")` de la v1, en heure de Paris.
pub fn created_label(at: Timestamp) -> String {
    let local = paris().to_datetime(at);
    format!(
        "Créé le {:02}/{:02}/{} {:02}:{:02}:{:02}",
        local.day(),
        local.month(),
        local.year(),
        local.hour(),
        local.minute(),
        local.second()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(s: &str) -> Timestamp {
        s.parse().expect("RFC 3339")
    }

    #[test]
    fn dates_are_read_in_paris_time() {
        let now = at("2026-11-27T12:00:00Z");
        // Hiver : 15 h 30 à Paris = 14 h 30 UTC.
        assert_eq!(
            parse_when("25/12/2026 15:30", now),
            Some(at("2026-12-25T14:30:00Z"))
        );
        // Sans année : celle de Paris ; zéros facultatifs, blancs tolérés autour.
        assert_eq!(
            parse_when(" 1/7  9:05 ", now),
            Some(at("2026-07-01T07:05:00Z"))
        );
        for bad in [
            "31/02 10:00",
            "25/12/2023 10:00",
            "25/12/26 10:00",
            "25/12 24:00",
            "25/12 10:5",
            "25-12 10:00",
            "demain",
            "25/12",
        ] {
            assert_eq!(parse_when(bad, now), None, "{bad}");
        }
    }

    #[test]
    fn buttons_read_the_v1_format_and_fall_back_to_the_reminder() {
        // Un bouton de la v1, message accentué encodé par `encodeURIComponent`.
        assert_eq!(
            Button::parse("rappel|1767225600000|Ap%C3%A9ro%20%C3%A0%2018h%20!"),
            Some(Button::Inline {
                at_ms: 1_767_225_600_000,
                message: "Apéro à 18h !".to_owned()
            })
        );
        let short = Button::for_reminder(1_767_225_600_000, "Apéro (vite) !", 7);
        assert_eq!(short, "rappel|1767225600000|Ap%C3%A9ro%20(vite)%20!");
        let long = Button::for_reminder(1_767_225_600_000, &"é".repeat(30), 7);
        assert_eq!(long, "rappel|1767225600000|#7");
        assert_eq!(
            Button::parse(&long),
            Some(Button::Copy {
                at_ms: 1_767_225_600_000,
                reminder: 7
            })
        );
        assert_eq!(Button::parse("rappel|x|y"), None);
        assert_eq!(Button::parse("rappel|1|%E9"), None);
    }

    #[test]
    fn the_creation_date_reads_like_v1() {
        assert_eq!(
            created_label(at("2026-07-14T07:05:09Z")),
            "Créé le 14/07/2026 09:05:09"
        );
    }
}
