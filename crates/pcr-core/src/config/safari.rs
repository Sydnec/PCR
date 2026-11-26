//! Réglages du parc safari. Valeurs par défaut de la v1.

use std::collections::BTreeMap;

use super::{pokemon::Stages, section::section};

section! {
    pub struct Safari {
        enabled "enabled": bool = true,
        /// Chance qu'un parc public ouvre, à chaque tirage horaire.
        random_chance_per_hour "randomChancePerHour": f64 = 0.04,
        min_hours_between_parks "minHoursBetweenParks": u32 = 24,
        park_duration_hours "parkDurationHours": u32 = 24,
        /// Les apparitions du salon se taisent ce temps-là quand un parc ouvre.
        spawn_pause_hours "spawnPauseHours": u32 = 4,
        session_min_duration_minutes "sessionMinDurationMinutes": u32 = 60,
        actions_per_session "actionsPerSession": u32 = 25,
        live_recent_actions "liveRecentActions": u32 = 5,
        live_refresh_ms "liveRefreshMs": u32 = 1000,
        live_settle_ms "liveSettleMs": u32 = 3000,
        entry_price "entryPrice": u32 = 5000,
        entry_cooldown_hours "entryCooldownHours": u32 = 12,
        ball "ball": SafariBall = SafariBall::default(),
        bait_multiplier "baitMultiplier": f64 = 2.0,
        bait_max_multiplier "baitMaxMultiplier": f64 = 4.0,
        flee_fail_chance "fleeFailChance": f64 = 0.1,
        wild_flee_chance "wildFleeChance": f64 = 0.05,
        wild_flee_chance_per_bait "wildFleeChancePerBait": f64 = 0.03,
        shiny_odds "shinyOdds": u32 = 250,
        weights_by_stage "weightsByStage": Stages = Stages { first: 50, second: 60, third: 40 },
        very_rare_weight "veryRareWeight": u32 = 30,
        legendary_weight "legendaryWeight": u32 = 24,
        species_factors "speciesFactors": BTreeMap<u16, f64> = BTreeMap::from([(201, 2.0)]),
    }
}

section! {
    pub struct SafariBall {
        label "label": String = "Safari Ball".into(),
        emoji "emoji": String = "<:safariball:1552972083909234811>".into(),
        sprite "sprite": String = "safari-ball".into(),
        multiplier "multiplier": f64 = 1.5,
    }
}
