//! Gains de messages : au plus un message récompensé par carence (`messagePoints.cooldownMinutes`),
//! payé selon son rang dans la journée de Paris du dresseur (`messagePointsDistribution`). Minuit
//! remet le rang à 1 et lève la carence, même pour un message envoyé à 23 h 59.
//!
//! Le compte à rebours de `/solde` se calcule ici avec les mêmes fonctions que le gain : il ne peut
//! pas annoncer un gain que le message suivant ne toucherait pas.

use jiff::{Timestamp, civil::Date};

use crate::{
    clock::{next_paris_midnight, paris_date},
    config::{MessagePoints, MessagePointsRules},
};

/// Ce que la base retient des gains de messages d'un dresseur.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct MessageState {
    /// Dernier message récompensé (ms), 0 si aucun.
    pub last_rewarded_at: i64,
    /// Messages récompensés pendant `day`.
    pub rewarded_today: u32,
    /// Le jour de Paris de ces gains ; un autre jour, tout repart de zéro.
    pub day: Option<Date>,
}

/// Le gain d'un message : son rang dans la journée et ce qu'il rapporte.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Reward {
    pub rank: u32,
    pub points: u32,
}

/// Les points du message de rang `rank`. Comme en v1, un rang réglé à 0 retombe sur le tarif par
/// défaut : seul un tarif par défaut nul fait qu'un rang ne paie rien.
pub fn points_for_rank(distribution: &MessagePoints, rank: u32) -> u32 {
    let explicit = match rank {
        1 => distribution.first,
        2 => distribution.second,
        3 => distribution.third,
        4 => distribution.fourth,
        5 => distribution.fifth,
        6 => distribution.sixth,
        _ => 0,
    };
    if explicit > 0 {
        explicit
    } else {
        distribution.rest
    }
}

fn cooldown_ms(rules: &MessagePointsRules) -> i64 {
    i64::from(rules.cooldown_minutes) * 60_000
}

/// Le dernier gain et le nombre de gains du jour de `now` : ceux d'un autre jour ne comptent plus.
fn today(state: &MessageState, now: Timestamp) -> (i64, u32) {
    if state.day == Some(paris_date(now)) {
        (state.last_rewarded_at, state.rewarded_today)
    } else {
        (0, 0)
    }
}

/// Ce que rapporte un message envoyé à `now`. `None` : rien à payer, et rien à consigner (la carence
/// court encore, ou le rang ne paie rien).
pub fn message_reward(
    state: &MessageState,
    now: Timestamp,
    distribution: &MessagePoints,
    rules: &MessagePointsRules,
) -> Option<Reward> {
    let (last, count) = today(state, now);
    if last != 0 && now.as_millisecond() - last < cooldown_ms(rules) {
        return None;
    }
    let rank = count + 1;
    let points = points_for_rank(distribution, rank);
    (points > 0).then_some(Reward { rank, points })
}

/// Quand un message pourra de nouveau rapporter : `None` dès maintenant (ou jamais, si le barème ne
/// paie plus rien, pas même le premier message du jour).
pub fn next_points_at(
    state: &MessageState,
    now: Timestamp,
    distribution: &MessagePoints,
    rules: &MessagePointsRules,
) -> Option<Timestamp> {
    let (last, count) = today(state, now);
    let midnight = next_paris_midnight(now);
    // Le rang suivant ne paie rien : on attend le premier message de demain, s'il paie.
    if points_for_rank(distribution, count + 1) == 0 {
        return (points_for_rank(distribution, 1) > 0).then_some(midnight);
    }
    if last == 0 {
        return None;
    }
    let ready = last + cooldown_ms(rules);
    if now.as_millisecond() < ready {
        let ready = Timestamp::from_millisecond(ready).unwrap_or(midnight);
        return Some(ready.min(midnight));
    }
    None
}

#[cfg(test)]
mod tests {
    use jiff::civil::date;

    use super::*;

    const MINUTE: i64 = 60_000;

    fn at(s: &str) -> Timestamp {
        s.parse().expect("RFC 3339")
    }

    fn ms(t: Timestamp) -> i64 {
        t.as_millisecond()
    }

    fn state(last: i64, count: u32, day: Date) -> MessageState {
        MessageState {
            last_rewarded_at: last,
            rewarded_today: count,
            day: Some(day),
        }
    }

    fn defaults() -> (MessagePoints, MessagePointsRules) {
        (MessagePoints::default(), MessagePointsRules::default())
    }

    fn only_first_pays() -> MessagePoints {
        MessagePoints {
            first: 10,
            second: 0,
            third: 0,
            fourth: 0,
            fifth: 0,
            sixth: 0,
            rest: 0,
        }
    }

    #[test]
    fn each_rank_pays_less_then_the_default_rate() {
        // Reprise de « chaque heure écoulée donne le rang suivant » (test/messages.test.js).
        let (distribution, rules) = defaults();
        let now = at("2026-10-06T12:00:00Z");
        let paid: Vec<u32> = (0..8)
            .map(|count| {
                let earlier = ms(now) - 61 * MINUTE;
                message_reward(
                    &state(earlier, count, date(2026, 10, 6)),
                    now,
                    &distribution,
                    &rules,
                )
                .expect("paid")
                .points
            })
            .collect();
        assert_eq!(paid, [750, 600, 500, 400, 350, 300, 300, 300]);
        let first = message_reward(&MessageState::default(), now, &distribution, &rules);
        assert_eq!(
            first,
            Some(Reward {
                rank: 1,
                points: 750
            })
        );
    }

    #[test]
    fn the_cooldown_ends_exactly_one_hour_after_the_last_reward() {
        let (distribution, rules) = defaults();
        let now = at("2026-10-06T12:00:00Z");
        let day = date(2026, 10, 6);
        let early = state(ms(now) - 59 * MINUTE, 1, day);
        assert_eq!(message_reward(&early, now, &distribution, &rules), None);
        let sharp = state(ms(now) - 60 * MINUTE, 1, day);
        assert_eq!(
            message_reward(&sharp, now, &distribution, &rules),
            Some(Reward {
                rank: 2,
                points: 600
            })
        );
    }

    #[test]
    fn paris_midnight_restarts_at_rank_one_even_within_the_hour() {
        let (distribution, rules) = defaults();
        // 0 h 05 à Paris le 7, dernier gain à 23 h 55 le 6.
        let now = at("2026-10-06T22:05:00Z");
        let late = state(ms(now) - 10 * MINUTE, 5, date(2026, 10, 6));
        assert_eq!(
            message_reward(&late, now, &distribution, &rules),
            Some(Reward {
                rank: 1,
                points: 750
            })
        );
    }

    #[test]
    fn a_rank_at_zero_falls_back_to_the_default_and_a_zero_default_pays_nothing() {
        let rules = MessagePointsRules::default();
        let now = at("2026-10-06T12:00:00Z");
        let first = message_reward(&MessageState::default(), now, &only_first_pays(), &rules);
        assert_eq!(
            first,
            Some(Reward {
                rank: 1,
                points: 10
            })
        );
        let second = state(ms(now) - 61 * MINUTE, 1, date(2026, 10, 6));
        assert_eq!(
            message_reward(&second, now, &only_first_pays(), &rules),
            None
        );
        let with_default = MessagePoints {
            rest: 7,
            ..only_first_pays()
        };
        assert_eq!(points_for_rank(&with_default, 2), 7);
    }

    #[test]
    fn next_points_reference_values() {
        // Reprises de test/economy.test.js (`calculateNextPointsAt`), minuit UTC devenu minuit de Paris.
        let (distribution, rules) = defaults();
        let day = date(2026, 10, 6);
        let next = |state: &MessageState, now: &str, distribution: &MessagePoints| {
            next_points_at(state, at(now), distribution, &rules)
        };
        // Sans ligne, ou sans message récompensé : disponible.
        assert_eq!(
            next(
                &MessageState::default(),
                "2026-10-06T12:30:00Z",
                &distribution
            ),
            None
        );
        // Vingt minutes après un gain : une heure après lui.
        let now = at("2026-10-06T12:30:00Z");
        let recent = state(ms(now) - 20 * MINUTE, 1, day);
        assert_eq!(
            next(&recent, "2026-10-06T12:30:00Z", &distribution),
            Timestamp::from_millisecond(ms(now) + 40 * MINUTE).ok()
        );
        // Plus d'une heure après : disponible.
        let now = at("2026-10-06T13:15:00Z");
        let old = state(ms(now) - 65 * MINUTE, 1, day);
        assert_eq!(next(&old, "2026-10-06T13:15:00Z", &distribution), None);
        // Un gain de la veille ne retient rien.
        let now = at("2026-10-06T00:15:00Z");
        let yesterday = state(ms(now) - 30 * MINUTE, 5, date(2026, 10, 5));
        assert_eq!(
            next(&yesterday, "2026-10-06T00:15:00Z", &distribution),
            None
        );
        // 23 h 45 à Paris, gain à 23 h 35 : borné à minuit (22 h UTC en octobre).
        let now = at("2026-10-06T21:45:00Z");
        let late = state(ms(now) - 10 * MINUTE, 1, day);
        assert_eq!(
            next(&late, "2026-10-06T21:45:00Z", &distribution),
            Some(at("2026-10-06T22:00:00Z"))
        );
        // Barème épuisé pour la journée : minuit.
        let now = at("2026-10-06T15:00:00Z");
        let spent = state(ms(now) - 70 * MINUTE, 1, day);
        assert_eq!(
            next(&spent, "2026-10-06T15:00:00Z", &only_first_pays()),
            Some(at("2026-10-06T22:00:00Z"))
        );
        // Un barème qui ne paie plus rien : jamais.
        let nothing = MessagePoints {
            first: 0,
            ..only_first_pays()
        };
        assert_eq!(next(&spent, "2026-10-06T15:00:00Z", &nothing), None);
    }
}
