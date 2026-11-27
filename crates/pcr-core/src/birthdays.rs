//! Anniversaires : la date tapée, le jour fêté (le 29 février se fête le 28 les années communes), la
//! prochaine fête et le message de vœux. Valeurs de référence : `test/birthdays.test.js` de la v1.
//!
//! L'année est facultative : sans elle, pas d'âge, et le 29 février est accepté.

use jiff::civil::Date;

/// Une date d'anniversaire.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Birthday {
    pub day: i8,
    pub month: i8,
    pub year: Option<i16>,
}

/// La plus ancienne année plausible : une borne de saisie, pas un réglage de jeu.
const OLDEST: i16 = 1900;

pub const NONE_YET: &str =
    "Aucun anniversaire enregistré pour l'instant. Ajoute le tien avec `/birthday add` !";
pub const NOTHING_TO_REMOVE: &str =
    "Tu n'as pas d'anniversaire enregistré. Ajoute-le avec `/birthday add` !";
pub const REMOVED: &str = "✅ Ton anniversaire a bien été supprimé.";

/// Le refus d'une saisie, qui la cite.
pub fn bad_date(raw: &str) -> String {
    format!(
        "❌ `{raw}` n'est pas une date valable. Utilise le format `JJ/MM` (ex : `24/07`) ou `JJ/MM/AAAA` (ex : `24/07/1998`)."
    )
}

/// La confirmation, avec la date telle qu'elle sera affichée.
pub fn saved(birthday: Birthday) -> String {
    format!(
        "✅ Anniversaire enregistré : **{}**.{}",
        format(birthday),
        if birthday.year.is_none() {
            " (sans ton âge)"
        } else {
            ""
        }
    )
}

fn is_leap(year: i16) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

/// Jours du mois ; année inconnue : février en compte 29.
fn days_in_month(year: Option<i16>, month: i8) -> i8 {
    match month {
        2 if year.is_none_or(is_leap) => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

/// « JJ/MM » ou « JJ/MM/AAAA » ; une date qui n'existe pas, ou une année future ou avant 1900, est
/// une faute de frappe. `today` borne l'année.
pub fn parse(raw: &str, today: Date) -> Option<Birthday> {
    let mut fields = raw.trim().split('/');
    let day = digits(fields.next()?, 1..=2)?;
    let month = digits(fields.next()?, 1..=2)?;
    let year = match fields.next() {
        Some(year) => Some(digits(year, 4..=4)?),
        None => None,
    };
    if fields.next().is_some() {
        return None;
    }
    let day = i8::try_from(day).ok()?;
    let month = i8::try_from(month).ok()?;
    let year = year.map(i16::try_from).transpose().ok()?;
    if !(1..=12).contains(&month) || day < 1 || day > days_in_month(year, month) {
        return None;
    }
    if year.is_some_and(|year| year < OLDEST || year > today.year()) {
        return None;
    }
    Some(Birthday { day, month, year })
}

fn digits(text: &str, len: std::ops::RangeInclusive<usize>) -> Option<u32> {
    if !len.contains(&text.len()) || !text.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    text.parse().ok()
}

/// « 24/07 » ou « 24/07/1998 », complété à deux chiffres.
pub fn format(birthday: Birthday) -> String {
    match birthday.year {
        Some(year) => format!("{:02}/{:02}/{year}", birthday.day, birthday.month),
        None => format!("{:02}/{:02}", birthday.day, birthday.month),
    }
}

/// Le jour fêté une année donnée : le 29 février tombe le 28 les années communes.
pub fn celebration_day(birthday: Birthday, year: i16) -> i8 {
    if birthday.month == 2 && birthday.day == 29 && !is_leap(year) {
        28
    } else {
        birthday.day
    }
}

/// La date de la fête une année donnée.
fn celebration(birthday: Birthday, year: i16) -> Option<Date> {
    Date::new(year, birthday.month, celebration_day(birthday, year)).ok()
}

/// La prochaine fête : aujourd'hui si c'est le jour, sinon la prochaine date.
pub fn next_occurrence(birthday: Birthday, today: Date) -> Option<Date> {
    let this_year = celebration(birthday, today.year())?;
    if this_year >= today {
        Some(this_year)
    } else {
        celebration(birthday, today.year() + 1)
    }
}

/// Jours avant la prochaine fête (0 : aujourd'hui).
pub fn days_until(birthday: Birthday, today: Date) -> Option<i32> {
    let next = next_occurrence(birthday, today)?;
    Some((next - today).get_days())
}

/// Est-ce le jour de la fête ?
pub fn is_today(birthday: Birthday, today: Date) -> bool {
    birthday.month == today.month() && celebration_day(birthday, today.year()) == today.day()
}

/// Le message de vœux réglé : `{user}` devient la mention, `{name}` le pseudo (première occurrence
/// de chacun, comme `String.replace` de la v1).
pub fn wish(template: &str, mention: &str, name: &str) -> String {
    template
        .replacen("{user}", mention, 1)
        .replacen("{name}", name, 1)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn date(text: &str) -> Date {
        text.parse().expect("date")
    }

    fn bd(day: i8, month: i8, year: Option<i16>) -> Birthday {
        Birthday { day, month, year }
    }

    #[test]
    fn typed_dates_are_checked_like_v1() {
        let today = date("2026-11-09");
        assert_eq!(parse("24/07", today), Some(bd(24, 7, None)));
        assert_eq!(parse(" 4/7 ", today), Some(bd(4, 7, None)));
        assert_eq!(parse("29/02/2000", today), Some(bd(29, 2, Some(2000))));
        assert_eq!(parse("29/02", today), Some(bd(29, 2, None)));
        for bad in [
            "31/04",
            "29/02/2001",
            "0/5",
            "32/1",
            "24/13",
            "demain",
            "24/7/98",
            "",
            "01/01/1899",
            "01/01/2999",
        ] {
            assert_eq!(parse(bad, today), None, "{bad}");
        }
    }

    #[test]
    fn dates_display_and_the_29th_of_february_moves_on_common_years() {
        assert_eq!(format(bd(4, 7, None)), "04/07");
        assert_eq!(format(bd(29, 2, Some(2000))), "29/02/2000");
        let leapling = bd(29, 2, None);
        assert_eq!(celebration_day(leapling, 2000), 29);
        assert_eq!(celebration_day(leapling, 2001), 28);
        assert!(is_today(leapling, date("2024-02-29")));
        assert!(is_today(leapling, date("2025-02-28")));
    }

    #[test]
    fn the_next_birthday_is_today_or_ahead() {
        let today = date("2026-11-09");
        assert_eq!(
            next_occurrence(bd(24, 7, None), today),
            Some(date("2027-07-24"))
        );
        assert_eq!(days_until(bd(24, 7, None), today), Some(257));
        assert_eq!(days_until(bd(9, 11, None), today), Some(0));
    }

    #[test]
    fn the_wish_fills_its_placeholders_once() {
        assert_eq!(
            wish("🎂 Bravo {user} ({name}) ! {user}", "<@1>", "Sam"),
            "🎂 Bravo <@1> (Sam) ! {user}"
        );
    }
}
