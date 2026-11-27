//! Pot commun : chacun cotise une part de sa fortune, la cagnotte repart en parts égales entre tous
//! les porteurs du rôle par défaut.
//!
//! Deux propriétés comptables tiennent le calcul :
//! - le mouvement de chacun est un net (part reçue moins cotisation) : une seule écriture par membre,
//!   aucun solde qui plonge le temps du calcul ;
//! - la somme des mouvements fait exactement zéro : le reste de la division entière part, un point
//!   chacun, à des membres tirés au sort, au lieu d'être brûlé.

use rand::{Rng, seq::index};

/// Un membre dans le pot.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Entry {
    pub user: i64,
    pub balance: i64,
    pub contribution: i64,
    pub received: i64,
}

impl Entry {
    /// Le mouvement net appliqué au solde.
    pub fn delta(&self) -> i64 {
        self.received - self.contribution
    }
}

/// Le pot complet, sans aucune écriture : c'est aussi ce que montre la simulation.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Plan {
    pub participants: i64,
    pub contributors: i64,
    pub pot: i64,
    pub share: i64,
    pub entries: Vec<Entry>,
}

impl Plan {
    /// Les plus grosses cotisations, de la plus grosse à la plus petite.
    pub fn top_contributors(&self, count: usize) -> Vec<Entry> {
        let mut top: Vec<Entry> = self
            .entries
            .iter()
            .filter(|entry| entry.contribution > 0)
            .copied()
            .collect();
        top.sort_by_key(|entry| std::cmp::Reverse(entry.contribution));
        top.truncate(count);
        top
    }

    /// Les membres qui y gagnent.
    pub fn gainers(&self) -> i64 {
        self.entries
            .iter()
            .filter(|entry| entry.delta() > 0)
            .count()
            .try_into()
            .unwrap_or(i64::MAX)
    }
}

/// La cotisation d'un solde. Arrondie vers le bas : on ne prélève jamais plus que le pourcentage
/// annoncé. Le calcul flottant est celui de la v1, dans le même ordre, pour les mêmes arrondis. Un
/// solde nul ou négatif ne cotise pas : créditer une dette reviendrait à récompenser le découvert.
#[allow(clippy::cast_precision_loss, clippy::cast_possible_truncation)]
pub fn contribution(balance: i64, percent: f64) -> i64 {
    if balance > 0 {
        (balance as f64 * percent / 100.0).floor() as i64
    } else {
        0
    }
}

/// Calcule le pot de `balances` (membre, solde) au taux `percent`.
pub fn plan(balances: &[(i64, i64)], percent: f64, rng: &mut (impl Rng + ?Sized)) -> Plan {
    if balances.is_empty() {
        return Plan::default();
    }
    let mut entries: Vec<Entry> = balances
        .iter()
        .map(|&(user, balance)| Entry {
            user,
            balance,
            contribution: contribution(balance, percent),
            received: 0,
        })
        .collect();
    let participants = i64::try_from(entries.len()).unwrap_or(i64::MAX);
    let pot: i64 = entries.iter().map(|entry| entry.contribution).sum();
    let share = pot / participants;
    let remainder = usize::try_from(pot - share * participants).unwrap_or(0);
    for entry in &mut entries {
        entry.received = share;
    }
    for lucky in index::sample(rng, entries.len(), remainder) {
        entries[lucky].received += 1;
    }
    Plan {
        participants,
        contributors: i64::try_from(entries.iter().filter(|e| e.contribution > 0).count())
            .unwrap_or(i64::MAX),
        pot,
        share,
        entries,
    }
}

/// L'intervalle entre deux pots ; une heure au moins, comme en v1.
pub fn interval_ms(interval_hours: u32) -> i64 {
    i64::from(interval_hours.max(1)) * 3_600_000
}

/// L'échéance qui suit `previous`, échue à `now`. Calculée à partir de l'ancienne et non de
/// l'instant présent : le pot ne dérive pas d'un tour à l'autre, et une panne de trois semaines ne
/// donne qu'un pot de rattrapage, l'échéance repartant dans le futur.
pub fn next_due(previous: i64, now: i64, interval_ms: i64) -> i64 {
    previous + ((now - previous) / interval_ms + 1) * interval_ms
}

#[cfg(test)]
mod tests {
    use rand::{RngExt as _, SeedableRng, rngs::StdRng};

    use super::*;

    const HOUR: i64 = 3_600_000;

    fn balances(amounts: &[i64]) -> Vec<(i64, i64)> {
        amounts
            .iter()
            .enumerate()
            .map(|(i, &balance)| (i64::try_from(i).expect("small"), balance))
            .collect()
    }

    fn run(amounts: &[i64], percent: f64) -> Plan {
        plan(&balances(amounts), percent, &mut StdRng::seed_from_u64(7))
    }

    fn total(plan: &Plan, field: fn(&Entry) -> i64) -> i64 {
        plan.entries.iter().map(field).sum()
    }

    // Valeurs de référence reprises de test/redistribution.test.js.

    #[test]
    fn levies_the_percentage_rounded_down_and_shares_equally() {
        let plan = run(&[1000, 500, 0, 0], 5.0);
        let contributions: Vec<i64> = plan.entries.iter().map(|e| e.contribution).collect();
        assert_eq!(contributions, [50, 25, 0, 0]);
        assert_eq!((plan.pot, plan.share), (75, 18));
        assert_eq!((plan.participants, plan.contributors), (4, 2));
        assert_eq!(run(&[1000, 500, 0], 10.0).pot, 150);
    }

    #[test]
    fn the_money_supply_is_kept_to_the_point() {
        for percent in [1.0, 5.0, 7.0, 33.0, 100.0, 2.5] {
            let plan = run(&[1001, 777, 13, 5, 0, -40, 99_999], percent);
            assert_eq!(total(&plan, Entry::delta), 0, "{percent} %");
            assert_eq!(total(&plan, |e| e.received), plan.pot, "{percent} %");
        }
    }

    #[test]
    fn the_remainder_goes_one_point_each_to_as_many_members() {
        let plan = run(&[1003, 700, 11], 5.0);
        let remainder = plan.pot - plan.share * plan.participants;
        let lucky = plan
            .entries
            .iter()
            .filter(|e| e.received == plan.share + 1)
            .count();
        assert_eq!(i64::try_from(lucky).expect("small"), remainder);
        assert!(
            plan.entries
                .iter()
                .all(|e| e.received == plan.share || e.received == plan.share + 1)
        );
    }

    #[test]
    fn anyone_can_draw_the_remainder() {
        let mut lucky = std::collections::HashSet::new();
        for seed in 0..64 {
            let plan = plan(
                &balances(&[1000, 1000, 1000, 1020]),
                5.0,
                &mut StdRng::seed_from_u64(seed),
            );
            lucky.extend(
                plan.entries
                    .iter()
                    .filter(|e| e.received > plan.share)
                    .map(|e| e.user),
            );
        }
        assert_eq!(lucky.len(), 4);
    }

    #[test]
    fn empty_or_negative_balances_do_not_contribute_but_receive() {
        let plan = run(&[2000, 0, -500], 10.0);
        let contributions: Vec<i64> = plan.entries.iter().map(|e| e.contribution).collect();
        assert_eq!(contributions, [200, 0, 0]);
        let debtor = plan.entries[2];
        assert!(debtor.received >= plan.share && debtor.delta() > 0);
        assert_eq!(plan.contributors, 1);
        // Un membre sans ligne de solde (0) touche sa part : 50 du pot de 100.
        assert_eq!(run(&[1000, 0], 10.0).entries[1].received, 50);
    }

    #[test]
    fn never_below_zero_and_never_more_than_announced() {
        for entry in run(&[500, 300, 0], 100.0).entries {
            assert!(entry.balance + entry.delta() >= 0, "{entry:?}");
        }
        for entry in run(&[999, 1, 17], 5.0).entries {
            assert!(entry.contribution * 100 <= entry.balance * 5);
        }
    }

    #[test]
    fn nothing_to_compute_at_zero_percent_or_without_members() {
        let plan = run(&[1000, 500], 0.0);
        assert_eq!((plan.pot, plan.contributors), (0, 0));
        assert!(plan.entries.iter().all(|e| e.delta() == 0));
        assert_eq!(run(&[], 5.0), Plan::default());
    }

    #[test]
    fn conservation_holds_for_random_balances() {
        let mut rng = StdRng::seed_from_u64(20_261_018);
        for round in 0..300 {
            let size = rng.random_range(1..=40);
            let list: Vec<(i64, i64)> = (0..size)
                .map(|i| (i, rng.random_range(-2000..18_000)))
                .collect();
            let percent = f64::from(rng.random_range(0..=100_u32));
            let plan = plan(&list, percent, &mut rng);
            assert_eq!(total(&plan, Entry::delta), 0, "round {round}");
            assert_eq!(total(&plan, |e| e.received), plan.pot, "round {round}");
            for entry in &plan.entries {
                assert!(entry.balance <= 0 || entry.balance + entry.delta() >= 0);
            }
        }
    }

    #[test]
    fn the_summary_names_the_biggest_contributors_and_the_gainers() {
        let plan = run(&[1000, 5000, 0, 3000, 2000], 10.0);
        let top: Vec<i64> = plan.top_contributors(3).iter().map(|e| e.user).collect();
        assert_eq!(top, [1, 3, 4]);
        // Part de 220 : gagnent ceux qui cotisent moins (100, 0, 200).
        assert_eq!(plan.gainers(), 3);
    }

    #[test]
    fn the_next_deadline_follows_the_previous_one_without_drift() {
        let now = 1_000 * HOUR;
        let interval = interval_ms(168);
        assert_eq!(
            next_due(now - 2 * HOUR, now, interval),
            now - 2 * HOUR + interval
        );
        let late = now - 3 * interval - HOUR;
        let next = next_due(late, now, interval);
        assert!(next > now && next <= now + interval);
        assert_eq!((next - late) % interval, 0);
        assert_eq!(interval_ms(0), HOUR);
    }
}
