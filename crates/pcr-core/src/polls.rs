//! Sondages : chaque ligne d'un sondage reçoit sa réaction, l'emoji qui l'ouvre ou, à défaut, un
//! numéro (`autoAddEmojis` de la v1), et `/week` liste les jours d'une période.
//!
//! Une ligne qui commence par `#` est un titre : ni numéro ni réaction. Un emoji serveur que le bot
//! ne peut pas utiliser (d'un autre serveur) est remplacé par le numéro de la ligne.

use std::fmt::Write as _;

use jiff::{ToSpan as _, civil::Date};

use crate::{refusal::Refusal, stats::emoji};

/// Les numéros des lignes sans emoji. La v1 s'arrêtait à 🔟 et écrivait « undefined » au-delà ; les
/// lettres prennent la suite jusqu'à 20, le nombre de réactions qu'un message peut porter.
const NUMBERS: [&str; 20] = [
    "1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟", "🇦", "🇧", "🇨", "🇩", "🇪", "🇫", "🇬",
    "🇭", "🇮", "🇯",
];

/// Ce que devient un sondage.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Numbered {
    /// Le texte réécrit (numéros ajoutés), à poster si `rewritten`.
    pub text: String,
    /// Les réactions à poser, ligne par ligne.
    pub reactions: Vec<String>,
    /// Au moins une ligne a reçu un numéro : le texte change.
    pub rewritten: bool,
}

/// Numérote les lignes d'un sondage. `usable` dit si un emoji serveur (`<:nom:id>`) appartient au
/// serveur, donc peut servir de réaction.
pub fn number(content: &str, usable: impl Fn(&str) -> bool) -> Numbered {
    let mut text = String::new();
    let mut reactions = Vec::new();
    let mut rewritten = false;
    let mut index = 0;
    for line in content.split('\n') {
        if line.starts_with('#') {
            text.push(' ');
            text.push_str(line);
            text.push('\n');
            continue;
        }
        let number = NUMBERS.get(index).copied();
        let first = emoji(line).into_iter().next();
        match first {
            Some(first) if !first.starts_with("<:") || usable(&first) => {
                text.push(' ');
                text.push_str(line);
                reactions.push(first);
            }
            Some(_) => {
                // L'emoji inutilisable disparaît : la v1 gardait ce qui suit son premier `>`.
                let rest = line.split('>').nth(1).unwrap_or_default();
                push_numbered(&mut text, number, rest, &mut reactions);
                rewritten = true;
            }
            None => {
                push_numbered(&mut text, number, line, &mut reactions);
                rewritten = true;
            }
        }
        text.push('\n');
        index += 1;
    }
    Numbered {
        text,
        reactions,
        rewritten,
    }
}

fn push_numbered(text: &mut String, number: Option<&str>, line: &str, reactions: &mut Vec<String>) {
    if let Some(number) = number {
        text.push_str(number);
        reactions.push(number.to_owned());
    }
    text.push(' ');
    text.push_str(line);
}

/// `/poll` sans aucune option : Discord refuse un message vide.
pub const NO_OPTIONS: &str = "❌ Ajoute au moins une option au sondage.";
/// Au-delà, Discord coupe le nom du fil.
pub const THREAD_NAME_MAX: usize = 99;

/// Les jours de la semaine, du lundi au dimanche (l'ordre de `jiff`).
const DAYS: [&str; 7] = [
    "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche",
];

pub const BAD_START: &str = "❌ Format de date de début invalide. Utilisez JJ/MM ou JJ/MM/AAAA";
pub const BAD_END: &str = "❌ Format de date de fin invalide. Utilisez JJ/MM ou JJ/MM/AAAA";
pub const START_AFTER_END: &str = "❌ La date de début doit être avant ou égale à la date de fin !";

/// Le jour choisi dans `/week jour` (`lundi`…`dimanche`), du lundi (0) au dimanche (6).
pub fn weekday(choice: &str) -> Option<i8> {
    DAYS.iter()
        .position(|day| day.eq_ignore_ascii_case(choice))
        .and_then(|index| i8::try_from(index).ok())
}

/// « JJ/MM » (année de `today`) ou « JJ/MM/AAAA ». Une date qui n'existe pas est refusée (la v1
/// glissait le 31/02 au 3 mars).
pub fn parse_date(text: &str, today: Date) -> Option<Date> {
    let mut fields = text.trim().split('/');
    let day = fields.next()?.parse().ok()?;
    let month = fields.next()?.parse().ok()?;
    let year = match fields.next() {
        Some(year) => year.parse().ok()?,
        None => today.year(),
    };
    if fields.next().is_some() {
        return None;
    }
    Date::new(year, month, day).ok()
}

/// La période de `/week` : un jour de la semaine (sa prochaine occurrence, jamais aujourd'hui) puis
/// sept jours ; des dates (la fin vaut le début plus six jours, le début vaut aujourd'hui) ; sinon
/// les sept jours à partir de demain. `max_days` borne la période.
pub fn period(
    today: Date,
    day: Option<i8>,
    start: Option<&str>,
    end: Option<&str>,
    max_days: u32,
) -> Result<(Date, Date), Refusal> {
    let week = |first: Date| -> Result<(Date, Date), Refusal> {
        Ok((
            first,
            first
                .checked_add(6.days())
                .map_err(|_| Refusal::new(BAD_END))?,
        ))
    };
    let (first, last) = match (day, start, end) {
        (Some(day), None, None) => {
            let current = today.weekday().to_monday_zero_offset();
            let mut ahead = (day - current).rem_euclid(7);
            if ahead == 0 {
                ahead = 7;
            }
            week(
                today
                    .checked_add(i64::from(ahead).days())
                    .map_err(|_| Refusal::new(BAD_START))?,
            )?
        }
        (_, None, None) => week(today.tomorrow().map_err(|_| Refusal::new(BAD_START))?)?,
        (_, start, end) => {
            let first = match start {
                Some(text) => parse_date(text, today).ok_or_else(|| Refusal::new(BAD_START))?,
                None => today,
            };
            let last = match end {
                Some(text) => parse_date(text, today).ok_or_else(|| Refusal::new(BAD_END))?,
                None => week(first)?.1,
            };
            (first, last)
        }
    };
    if first > last {
        return Err(Refusal::new(START_AFTER_END));
    }
    let span = (last - first).get_days() + 1;
    if u32::try_from(span).unwrap_or(u32::MAX) > max_days {
        return Err(Refusal::new(format!(
            "❌ La période demandée fait {span} jours : {max_days} au maximum."
        )));
    }
    Ok((first, last))
}

/// Le sondage de `/week` : le titre, puis un jour par ligne (« Lundi 01/12 »).
pub fn week_poll(question: &str, first: Date, last: Date) -> String {
    let mut text = format!("# {question} :\n");
    let mut day = first;
    while day <= last {
        let name = DAYS[usize::try_from(day.weekday().to_monday_zero_offset()).unwrap_or(0)];
        let _ = writeln!(text, "{name} {:02}/{:02}", day.day(), day.month());
        match day.tomorrow() {
            Ok(next) => day = next,
            Err(_) => break,
        }
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    fn date(text: &str) -> Date {
        text.parse().expect("date")
    }

    #[test]
    fn lines_without_a_usable_emoji_get_a_number() {
        let numbered = number(
            "# Où manger ?\n🍕 Pizza\nSushi\n<:local:1> Burger\n<:ailleurs:2> Tacos",
            |emoji| emoji == "<:local:1>",
        );
        assert_eq!(
            numbered.text,
            " # Où manger ?\n 🍕 Pizza\n2️⃣ Sushi\n <:local:1> Burger\n4️⃣  Tacos\n"
        );
        assert_eq!(numbered.reactions, ["🍕", "2️⃣", "<:local:1>", "4️⃣"]);
        assert!(numbered.rewritten);

        let ready = number("👍 Oui\n👎 Non", |_| false);
        assert!(!ready.rewritten);
        assert_eq!(ready.reactions, ["👍", "👎"]);
    }

    #[test]
    fn a_week_lists_each_day_of_its_period() {
        // Jeudi 27 novembre 2026.
        let today = date("2026-11-27");
        assert_eq!(
            period(today, None, None, None, 31),
            Ok((date("2026-11-28"), date("2026-12-04")))
        );
        // Lundi prochain ; un jeudi choisi un jeudi : celui de la semaine suivante.
        assert_eq!(
            period(today, weekday("lundi"), None, None, 31),
            Ok((date("2026-11-30"), date("2026-12-06")))
        );
        assert_eq!(
            period(today, weekday("jeudi"), None, None, 31).map(|(first, _)| first),
            Ok(date("2026-12-03"))
        );
        assert_eq!(
            period(today, None, Some("24/12"), None, 31),
            Ok((date("2026-12-24"), date("2026-12-30")))
        );
        assert_eq!(
            period(today, None, None, Some("30/11"), 31),
            Ok((today, date("2026-11-30")))
        );
        assert_eq!(
            period(today, None, Some("31/02"), None, 31),
            Err(Refusal::new(BAD_START))
        );
        assert_eq!(
            period(today, None, Some("10/12"), Some("01/12"), 31),
            Err(Refusal::new(START_AFTER_END))
        );
        assert_eq!(
            period(today, None, Some("01/12"), Some("01/02/2027"), 31),
            Err(Refusal::new(
                "❌ La période demandée fait 63 jours : 31 au maximum."
            ))
        );
        assert_eq!(
            week_poll("Ciné ?", date("2026-11-30"), date("2026-12-01")),
            "# Ciné ? :\nLundi 30/11\nMardi 01/12\n"
        );
    }
}
