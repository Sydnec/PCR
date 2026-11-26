//! Réglages du jeu Pokémon (hors parc safari et catalogue d'objets). Valeurs par défaut de la v1.

use std::collections::BTreeMap;

use super::{items::Items, safari::Safari, section::section};

section! {
    pub struct Pokemon {
        enabled "enabled": bool = true,
        /// La dernière génération ouverte.
        generation "generation": u8 = 1,
        /// Date d'ouverture (ISO 8601 avec fuseau) de chaque génération à venir.
        generation_openings "generationOpenings": BTreeMap<u8, String> =
            BTreeMap::from([(2, "2026-10-30T18:00:00+01:00".into())]),
        spawn "spawn": Spawn = Spawn::default(),
        capture "capture": Capture = Capture::default(),
        evolution "evolution": Evolution = Evolution::default(),
        trade "trade": Trade = Trade::default(),
        /// Verrouillés dès leur arrivée : un shiny ou un légendaire ne part pas sur un clic distrait.
        lock_by_default "lockByDefault": LockByDefault = LockByDefault::default(),
        shiny_charm "shinyCharm": ShinyCharm = ShinyCharm::default(),
        /// Les premières espèces des lignées de starter.
        starter_lines "starterLines": Vec<u16> = vec![1, 4, 7, 152, 155, 158],
        starters "starters": Starters = Starters::default(),
        fishing "fishing": Fishing = Fishing::default(),
        eggs "eggs": Eggs = Eggs::default(),
        pokedex "pokedex": PageSize = PageSize { page_size: 30 },
        box_ "box": PageSize = PageSize { page_size: 15 },
        showcase "showcase": Showcase = Showcase::default(),
        unown_text "unownText": UnownText = UnownText::default(),
        pc "pc": Pc = Pc::default(),
        items "items": Items = Items::default(),
        sell "sell": Sell = Sell::default(),
        lottery "lottery": Lottery = Lottery::default(),
        safari "safari": Safari = Safari::default(),
        season_recap "seasonRecap": SeasonRecap = SeasonRecap::default(),
    }
}

section! {
    pub struct Spawn {
        messages_per_spawn "messagesPerSpawn": u32 = 20,
        min_delay_minutes "minDelayMinutes": u32 = 1,
        /// Délai minimal après la fin (capture ou fuite) de la précédente apparition.
        min_delay_after_end_minutes "minDelayAfterEndMinutes": u32 = 0,
        flee_after_minutes "fleeAfterMinutes": Range = Range { min: 45, max: 90 },
        legendary_flee_multiplier "legendaryFleeMultiplier": f64 = 2.0,
        /// Une chance sur `shinyOdds`.
        shiny_odds "shinyOdds": u32 = 500,
        weights_by_stage "weightsByStage": Stages = Stages { first: 70, second: 60, third: 25 },
        very_rare_weight "veryRareWeight": u32 = 18,
        legendary_weight "legendaryWeight": u32 = 8,
        /// Multiplie le poids des espèces de la dernière génération ouverte.
        generation_boost "generationBoost": f64 = 2.0,
        /// Facteur de poids par espèce (Zarbi, 201 : ses 26 formes se partagent une seule entrée).
        species_factors "speciesFactors": BTreeMap<u16, f64> = BTreeMap::from([(201, 2.0)]),
        /// Raretés dont l'apparition mentionne le rôle à prévenir.
        ping_rarities "pingRarities": Vec<String> = vec!["TRES_RARE".into(), "LEGENDAIRE".into()],
        throw_log_size "throwLogSize": u32 = 8,
        held_item_chance "heldItemChance": f64 = 0.15,
        item_drop_chance "itemDropChance": f64 = 0.2,
        embed_refresh_ms "embedRefreshMs": u32 = 2000,
    }
}

section! {
    pub struct Range {
        min "min": u32 = 0,
        max "max": u32 = 0,
    }
}

section! {
    /// Un poids par stade d'évolution (1 : base).
    pub struct Stages {
        first "1": u32 = 0,
        second "2": u32 = 0,
        third "3": u32 = 0,
    }
}

section! {
    pub struct Capture {
        /// Le seul levier global pour durcir (sous 1) ou faciliter les captures.
        global_multiplier "globalMultiplier": f64 = 1.0,
        min_catch_rate "minCatchRate": u32 = 10,
        throw_cooldown_seconds "throwCooldownSeconds": u32 = 3,
        balls "balls": Balls = Balls::default(),
        special_balls "specialBalls": SpecialBalls = SpecialBalls::default(),
    }
}

section! {
    pub struct Balls {
        poke "poke": Ball = Ball::new("Poké Ball", "<:pokeball:1551325915160514690>", "poke-ball", 100, 1.0),
        super_ "super": Ball =
            Ball::new("Super Ball", "<:superball:1551325951361679411>", "great-ball", 200, 2.0),
        hyper "hyper": Ball =
            Ball::new("Hyper Ball", "<:hyperball:1551326031431077898>", "ultra-ball", 400, 4.0),
        master "master": Ball = Ball {
            price_growth: Some(1.2),
            guaranteed: Some(true),
            ..Ball::new("Master Ball", "<:masterball:1551326387455926432>", "master-ball", 10_000, 255.0)
        },
    }
}

section! {
    pub struct Ball {
        label "label": String = String::new(),
        emoji "emoji": String = String::new(),
        sprite "sprite": String = String::new(),
        price "price": u32 = 0,
        multiplier "multiplier": f64 = 1.0,
        /// Master Ball : chaque achat coûte ce facteur de plus que le précédent.
        #[serde(skip_serializing_if = "Option::is_none")]
        price_growth "priceGrowth": Option<f64> = None,
        #[serde(skip_serializing_if = "Option::is_none")]
        guaranteed "guaranteed": Option<bool> = None,
    }
}

impl Ball {
    fn new(label: &str, emoji: &str, sprite: &str, price: u32, multiplier: f64) -> Self {
        Self {
            label: label.into(),
            emoji: emoji.into(),
            sprite: sprite.into(),
            price,
            multiplier,
            ..Self::default()
        }
    }
}

section! {
    pub struct SpecialBalls {
        max_held "maxHeld": u32 = 10,
        daily_limit "dailyLimit": u32 = 10,
        appat "appat": SpecialBall = SpecialBall {
            label: "Appât Ball".into(),
            emoji: "🎣".into(),
            sprite: "lure-ball".into(),
            price: 230,
            bonus: Bonus { fished: Some(true), item: None, multiplier: 3.0 },
            ..SpecialBall::default()
        },
        catalyseur "catalyseur": SpecialBall = SpecialBall {
            label: "Catalyseur Ball".into(),
            emoji: "⚙️".into(),
            sprite: "moon-ball".into(),
            price: 300,
            bonus: Bonus { fished: None, item: Some("catalyseur".into()), multiplier: 4.0 },
            ..SpecialBall::default()
        },
    }
}

section! {
    pub struct SpecialBall {
        label "label": String = String::new(),
        emoji "emoji": String = String::new(),
        sprite "sprite": String = String::new(),
        price "price": u32 = 0,
        multiplier "multiplier": f64 = 1.0,
        /// En vente à partir de cette génération.
        generation "generation": u8 = 2,
        bonus "bonus": Bonus = Bonus::default(),
    }
}

section! {
    /// Le bonus d'une ball spéciale, quand sa condition est remplie (Pokémon pêché, ou espèce qui
    /// évolue avec l'objet).
    pub struct Bonus {
        #[serde(skip_serializing_if = "Option::is_none")]
        fished "fished": Option<bool> = None,
        #[serde(skip_serializing_if = "Option::is_none")]
        item "item": Option<String> = None,
        multiplier "multiplier": f64 = 1.0,
    }
}

section! {
    pub struct Evolution {
        /// Vers le stade 2, puis vers le stade 3 : exemplaires sacrifiés et points.
        to_stage_2 "2": StageCost = StageCost { duplicates: 2, points: 1500 },
        to_stage_3 "3": StageCost = StageCost { duplicates: 2, points: 3000 },
        branch_choice_points "branchChoicePoints": u32 = 3000,
        /// Métamorph sacrifiés pour remplacer un exemplaire manquant.
        dittos_per_copy "dittosPerCopy": u32 = 1,
    }
}

section! {
    pub struct StageCost {
        duplicates "duplicates": u32 = 0,
        points "points": u32 = 0,
    }
}

section! {
    pub struct Trade {
        expiry_hours "expiryHours": u32 = 24,
        draft_minutes "draftMinutes": u32 = 15,
    }
}

section! {
    pub struct LockByDefault {
        shiny "shiny": bool = true,
        legendary "legendary": bool = true,
    }
}

section! {
    pub struct ShinyCharm {
        multiplier "multiplier": f64 = 2.0,
    }
}

section! {
    pub struct Starters {
        /// Les starters proposés à l'ouverture de chaque génération.
        choices "choices": BTreeMap<u8, Vec<u16>> = BTreeMap::from([(2, vec![152, 155, 158])]),
        /// Les paliers de Pokédex de la génération qui récompensent son starter.
        rewards "rewards": Vec<StarterReward> = vec![
            StarterReward { percent: 33, stage: 2, shiny: false },
            StarterReward { percent: 66, stage: 3, shiny: false },
            StarterReward { percent: 100, stage: 1, shiny: true },
        ],
    }
}

section! {
    pub struct StarterReward {
        percent "percent": u32 = 0,
        stage "stage": u8 = 1,
        shiny "shiny": bool = false,
    }
}

section! {
    pub struct Fishing {
        generation "generation": u8 = 2,
        flee_seconds "fleeSeconds": u32 = 120,
        /// Rend plus rares à l'état sauvage les espèces qui se pêchent (1 : aucune différence).
        wild_rarity_factor "wildRarityFactor": f64 = 0.7,
    }
}

section! {
    pub struct Eggs {
        enabled "enabled": bool = true,
        hatch_hours "hatchHours": u32 = 120,
        hatch_messages "hatchMessages": u32 = 200,
        per_day "perDay": u32 = 1,
        shiny_parent_multiplier "shinyParentMultiplier": f64 = 2.0,
    }
}

section! {
    pub struct PageSize {
        page_size "pageSize": u32 = 1,
    }
}

section! {
    pub struct Showcase {
        slots "slots": u32 = 6,
        share_cooldown_minutes "shareCooldownMinutes": u32 = 60,
        image_cell "imageCell": u32 = 128,
        image_timeout_seconds "imageTimeoutSeconds": u32 = 5,
    }
}

section! {
    pub struct UnownText {
        max_letters "maxLetters": u32 = 80,
        letters_per_line "lettersPerLine": u32 = 10,
        image_cell "imageCell": u32 = 64,
        image_timeout_seconds "imageTimeoutSeconds": u32 = 5,
    }
}

section! {
    pub struct Pc {
        slots_per_box "slotsPerBox": u32 = 30,
        columns "columns": u32 = 6,
        min_boxes "minBoxes": u32 = 8,
        max_boxes "maxBoxes": u32 = 60,
        box_name_length "boxNameLength": u32 = 20,
        nickname_length "nicknameLength": u32 = 20,
    }
}

section! {
    pub struct Sell {
        by_rarity "byRarity": ByRarity = ByRarity::default(),
        /// 0 : un shiny ne se revend pas plus cher.
        shiny_multiplier "shinyMultiplier": f64 = 0.0,
    }
}

section! {
    pub struct ByRarity {
        commun "COMMUN": u32 = 250,
        peu_commun "PEU_COMMUN": u32 = 600,
        rare "RARE": u32 = 1500,
        tres_rare "TRES_RARE": u32 = 2000,
    }
}

section! {
    pub struct Lottery {
        enabled "enabled": bool = true,
        win_chance "winChance": f64 = 0.75,
        /// Chaque lot supplémentaire d'un même tirage est d'autant moins probable.
        lot_decay "lotDecay": f64 = 0.5,
    }
}

section! {
    pub struct SeasonRecap {
        enabled "enabled": bool = true,
        top_size "topSize": u32 = 5,
        podium_size "podiumSize": u32 = 3,
        min_throws_for_luck "minThrowsForLuck": u32 = 30,
        min_lottery_draws "minLotteryDraws": u32 = 5,
        min_spawns_for_flee_rate "minSpawnsForFleeRate": u32 = 5,
        publish_within_hours "publishWithinHours": u32 = 168,
        retry_minutes "retryMinutes": u32 = 10,
        record_retries "recordRetries": u32 = 3,
        record_retry_delay_ms "recordRetryDelayMs": u32 = 500,
    }
}
