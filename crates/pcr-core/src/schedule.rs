//! Échéances des tâches planifiées, en heure de Paris.
//!
//! Une tâche de calendrier (saints du jour, anniversaires, récap annuel…) a une échéance par période :
//! un jour, ou une année. Chaque période porte une clé (« 2026-11-26 », « 2026 ») : c'est elle que
//! `job_runs` revendique, si bien qu'une échéance ne s'exécute jamais deux fois, et qu'une échéance
//! manquée (bot arrêté à l'heure dite) se rattrape au démarrage, tant que sa période dure. Hors de sa
//! période, elle est perdue : des vœux d'anniversaire envoyés le lendemain seraient faux. Une échéance
//! annuelle se rattrape donc jusqu'au 31 décembre : c'est voulu pour le récap de l'année, qui reste
//! valable en février ; une tâche qui ne vaut que le jour J est quotidienne et vérifie sa date.
//!
//! Aucune échéance entre 2 h et 3 h : la nuit du changement d'heure, cette heure-là n'existe pas ou
//! existe deux fois à Paris.

use jiff::{Timestamp, civil::Date};

use crate::clock::{paris, paris_date};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Schedule {
    /// Chaque jour à `hour:minute`, heure de Paris.
    Daily { hour: i8, minute: i8 },
    /// Chaque année le `day`/`month` à `hour:minute`, heure de Paris.
    Yearly {
        month: i8,
        day: i8,
        hour: i8,
        minute: i8,
    },
}

impl Schedule {
    /// Vrai si l'échéance tombe hors de l'heure du changement d'heure et désigne un instant réel.
    pub fn is_valid(self) -> bool {
        let (hour, minute) = match self {
            Self::Daily { hour, minute } | Self::Yearly { hour, minute, .. } => (hour, minute),
        };
        let date_ok = match self {
            Self::Daily { .. } => true,
            // Le 29 février n'existe pas chaque année : une échéance annuelle y serait sautée.
            Self::Yearly { month, day, .. } => {
                Date::new(2025, month, day).is_ok() && Date::new(2024, month, day).is_ok()
            }
        };
        (0..24).contains(&hour) && hour != 2 && (0..60).contains(&minute) && date_ok
    }

    /// L'échéance de la période en cours, si elle est passée à `now` : la clé de la période et
    /// l'instant de l'échéance. `None` tant qu'elle est à venir.
    pub fn due(self, now: Timestamp) -> Option<(String, Timestamp)> {
        let today = paris_date(now);
        let (date, key) = match self {
            Self::Daily { .. } => (today, today.to_string()),
            Self::Yearly { month, day, .. } => (
                Date::new(today.year(), month, day).ok()?,
                today.year().to_string(),
            ),
        };
        let (hour, minute) = match self {
            Self::Daily { hour, minute } | Self::Yearly { hour, minute, .. } => (hour, minute),
        };
        let at = paris().to_timestamp(date.at(hour, minute, 0, 0)).ok()?;
        (now >= at).then_some((key, at))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(s: &str) -> Timestamp {
        s.parse().expect("RFC 3339")
    }

    #[test]
    fn a_daily_deadline_is_due_from_its_paris_time_until_paris_midnight() {
        let birthdays = Schedule::Daily { hour: 9, minute: 0 };
        // Hiver : 9 h à Paris = 8 h UTC.
        assert_eq!(birthdays.due(at("2026-01-14T07:59:59Z")), None);
        assert_eq!(
            birthdays.due(at("2026-01-14T08:00:00Z")),
            Some(("2026-01-14".to_owned(), at("2026-01-14T08:00:00Z")))
        );
        // Été : 9 h à Paris = 7 h UTC ; à 23 h 30 UTC on est déjà le lendemain à Paris, avant 9 h.
        assert_eq!(
            birthdays
                .due(at("2026-07-14T07:00:00Z"))
                .map(|(key, _)| key),
            Some("2026-07-14".to_owned())
        );
        assert_eq!(birthdays.due(at("2026-07-14T23:30:00Z")), None);
    }

    #[test]
    fn a_yearly_deadline_belongs_to_its_year() {
        let recap = Schedule::Yearly {
            month: 1,
            day: 1,
            hour: 0,
            minute: 5,
        };
        // 31 décembre 23 h 10 UTC : à Paris, c'est le 1er janvier 0 h 10.
        assert_eq!(
            recap.due(at("2026-12-31T23:10:00Z")).map(|(key, _)| key),
            Some("2027".to_owned())
        );
        assert_eq!(
            recap.due(at("2026-12-31T22:59:00Z")).map(|(key, _)| key),
            Some("2026".to_owned())
        );
    }

    #[test]
    fn deadlines_in_the_clock_change_hour_or_on_february_29_are_refused() {
        assert!(
            !Schedule::Daily {
                hour: 2,
                minute: 30
            }
            .is_valid()
        );
        assert!(
            !Schedule::Yearly {
                month: 2,
                day: 29,
                hour: 9,
                minute: 0
            }
            .is_valid()
        );
        assert!(Schedule::Daily { hour: 3, minute: 0 }.is_valid());
    }
}
