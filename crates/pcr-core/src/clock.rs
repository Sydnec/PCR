//! The only time source of the bot.
//!
//! Every game "day" (daily rewards, lottery, shop quota, birthdays) is a calendar day in
//! Europe/Paris, so resets happen at midnight for players. Reading the wall clock anywhere else
//! is forbidden by `clippy.toml`.

use std::sync::LazyLock;

use jiff::{Timestamp, civil::Date, tz::TimeZone};

/// The bundled tz database always knows Europe/Paris, whatever the host has installed.
static PARIS: LazyLock<TimeZone> =
    LazyLock::new(|| TimeZone::get("Europe/Paris").expect("bundled tzdb has Europe/Paris"));

pub trait Clock: Send + Sync + std::fmt::Debug {
    fn now(&self) -> Timestamp;

    fn now_ms(&self) -> i64 {
        self.now().as_millisecond()
    }

    /// Today's date in Paris.
    fn today(&self) -> Date {
        paris_date(self.now())
    }
}

pub fn paris() -> &'static TimeZone {
    &PARIS
}

/// The Paris calendar date of an instant.
pub fn paris_date(at: Timestamp) -> Date {
    PARIS.to_datetime(at).date()
}

#[derive(Debug, Default, Clone, Copy)]
pub struct SystemClock;

impl Clock for SystemClock {
    #[allow(clippy::disallowed_methods)] // The single place allowed to read the wall clock.
    fn now(&self) -> Timestamp {
        Timestamp::now()
    }
}

/// A frozen clock for tests.
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
        // Winter (UTC+1): 23:00 UTC is already midnight the next day in Paris.
        assert_eq!(paris_date(at("2026-01-14T22:59:59Z")), date(2026, 1, 14));
        assert_eq!(paris_date(at("2026-01-14T23:00:00Z")), date(2026, 1, 15));
        // Summer (UTC+2): the boundary moves to 22:00 UTC.
        assert_eq!(paris_date(at("2026-07-14T21:59:59Z")), date(2026, 7, 14));
        assert_eq!(paris_date(at("2026-07-14T22:00:00Z")), date(2026, 7, 15));
    }

    #[test]
    fn dst_switch_nights_keep_a_single_day_boundary() {
        // Spring forward (29 March 2026, 02:00 → 03:00 Paris).
        assert_eq!(paris_date(at("2026-03-28T22:59:59Z")), date(2026, 3, 28));
        assert_eq!(paris_date(at("2026-03-29T01:30:00Z")), date(2026, 3, 29));
        // Fall back (25 October 2026, 03:00 → 02:00 Paris).
        assert_eq!(paris_date(at("2026-10-24T21:59:59Z")), date(2026, 10, 24));
        assert_eq!(paris_date(at("2026-10-25T01:30:00Z")), date(2026, 10, 25));
    }
}
