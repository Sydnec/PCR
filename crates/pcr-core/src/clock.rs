//! L'unique source de temps du bot.
//!
//! Chaque « jour » du jeu (gains quotidiens, loterie, quota de boutique, anniversaires) est un jour
//! calendaire à Paris : les remises à zéro tombent à minuit pour les joueurs. Lire l'horloge ailleurs
//! est interdit par `clippy.toml`.

use std::sync::LazyLock;

use jiff::{Timestamp, civil::Date, tz::TimeZone};

/// La base de fuseaux embarquée connaît toujours Europe/Paris, quoi que l'hôte ait installé.
static PARIS: LazyLock<TimeZone> =
    LazyLock::new(|| TimeZone::get("Europe/Paris").expect("bundled tzdb has Europe/Paris"));

pub trait Clock: Send + Sync + std::fmt::Debug {
    fn now(&self) -> Timestamp;

    fn now_ms(&self) -> i64 {
        self.now().as_millisecond()
    }

    /// La date du jour à Paris.
    fn today(&self) -> Date {
        paris_date(self.now())
    }
}

pub fn paris() -> &'static TimeZone {
    &PARIS
}

/// La date calendaire à Paris d'un instant.
pub fn paris_date(at: Timestamp) -> Date {
    PARIS.to_datetime(at).date()
}

/// Le prochain minuit à Paris après `at` : la remise à zéro des compteurs du jour. Minuit existe
/// toujours à Paris (les changements d'heure tombent entre 2 h et 3 h).
pub fn next_paris_midnight(at: Timestamp) -> Timestamp {
    paris_date(at)
        .tomorrow()
        .and_then(|day| PARIS.to_timestamp(day.at(0, 0, 0, 0)))
        .expect("Paris midnight exists and stays in range")
}

#[derive(Debug, Default, Clone, Copy)]
pub struct SystemClock;

impl Clock for SystemClock {
    #[allow(clippy::disallowed_methods)] // Le seul endroit autorisé à lire l'horloge.
    fn now(&self) -> Timestamp {
        Timestamp::now()
    }
}

/// Une horloge figée pour les tests.
#[derive(Debug, Clone, Copy)]
pub struct FixedClock(pub Timestamp);

impl Clock for FixedClock {
    fn now(&self) -> Timestamp {
        self.0
    }
}

#[cfg(test)]
mod tests {
    use jiff::civil::date;

    use super::*;

    fn at(s: &str) -> Timestamp {
        s.parse().expect("valid RFC 3339")
    }

    #[test]
    fn day_changes_at_paris_midnight_in_winter_and_summer() {
        // Hiver (UTC+1) : 23 h UTC, c'est déjà minuit le lendemain à Paris.
        assert_eq!(paris_date(at("2026-01-14T22:59:59Z")), date(2026, 1, 14));
        assert_eq!(paris_date(at("2026-01-14T23:00:00Z")), date(2026, 1, 15));
        // Été (UTC+2) : la limite passe à 22 h UTC.
        assert_eq!(paris_date(at("2026-07-14T21:59:59Z")), date(2026, 7, 14));
        assert_eq!(paris_date(at("2026-07-14T22:00:00Z")), date(2026, 7, 15));
    }

    #[test]
    fn next_midnight_is_paris_midnight() {
        assert_eq!(
            next_paris_midnight(at("2026-01-14T22:59:59Z")),
            at("2026-01-14T23:00:00Z")
        );
        assert_eq!(
            next_paris_midnight(at("2026-01-14T23:00:00Z")),
            at("2026-01-15T23:00:00Z")
        );
        // La veille du passage à l'heure d'été : le jour suivant n'a que 23 heures.
        assert_eq!(
            next_paris_midnight(at("2026-03-29T12:00:00Z")),
            at("2026-03-29T22:00:00Z")
        );
    }

    #[test]
    fn dst_switch_nights_keep_a_single_day_boundary() {
        // Passage à l'heure d'été (29 mars 2026, 2 h → 3 h à Paris).
        assert_eq!(paris_date(at("2026-03-28T22:59:59Z")), date(2026, 3, 28));
        assert_eq!(paris_date(at("2026-03-29T01:30:00Z")), date(2026, 3, 29));
        // Retour à l'heure d'hiver (25 octobre 2026, 3 h → 2 h à Paris).
        assert_eq!(paris_date(at("2026-10-24T21:59:59Z")), date(2026, 10, 24));
        assert_eq!(paris_date(at("2026-10-25T01:30:00Z")), date(2026, 10, 25));
    }
}
