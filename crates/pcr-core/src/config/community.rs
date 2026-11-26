//! Réglages hors Pokémon : gains de messages, site, messages publics, liens, pot commun, purge,
//! anniversaires. Valeurs par défaut de la v1.

use super::section::section;

section! {
    /// Points gagnés selon le rang du message dans la journée du dresseur.
    pub struct MessagePoints {
        first "1": u32 = 750,
        second "2": u32 = 600,
        third "3": u32 = 500,
        fourth "4": u32 = 400,
        fifth "5": u32 = 350,
        sixth "6": u32 = 300,
        /// Au-delà du sixième.
        rest "default": u32 = 300,
    }
}

section! {
    /// Règles des gains de messages propres à la v2 : la v1 les codait en dur.
    pub struct MessagePointsRules {
        /// Carence entre deux messages récompensés ; minuit (Paris) la lève.
        cooldown_minutes "cooldownMinutes": u32 = 60,
    }
}

section! {
    /// L'API du site.
    pub struct Web {
        /// Durée d'une session avant qu'il faille se reconnecter par Discord.
        session_hours "sessionHours": u32 = 168,
        /// Garde-fou contre une boucle ou un script, par dresseur : le parc safari et le rangement du
        /// PC enchaînent les clics, de quoi jouer vite, pas plus.
        writes_per_minute "writesPerMinute": u32 = 60,
        /// Le refus d'accès d'un membre parti est retenu ce temps-là, pour ne pas interroger Discord à
        /// chaque requête ; un membre revenu entre au plus tard après ce délai.
        access_denial_cache_seconds "accessDenialCacheSeconds": u32 = 60,
        /// Cadence de relecture de l'apparition en cours par l'onglet Capture (secours du SSE).
        spawn_refresh_seconds "spawnRefreshSeconds": u32 = 3,
    }
}

section! {
    /// Les messages publics que le jeu réécrit (apparitions, offres, parcs, objets au sol, directs).
    pub struct PublicMessages {
        /// Une réécriture refusée par une panne passagère se retente autant de fois, après
        /// `retryDelayMs`, puis le double, etc.
        retries "retries": u32 = 2,
        retry_delay_ms "retryDelayMs": u32 = 1000,
        /// Le rattrapage attend ce répit (le chemin ordinaire peut encore conclure) et ne regarde que
        /// les changements de cette fenêtre : l'historique ne se retouche pas.
        repair_grace_seconds "repairGraceSeconds": u32 = 120,
        repair_window_hours "repairWindowHours": u32 = 24,
    }
}

section! {
    /// La réécriture des liens X et Instagram vers leurs miroirs.
    pub struct Links {
        translation "translation": Translation = Translation::default(),
    }
}

section! {
    /// Le bouton « Traduire » sous la copie d'un tweet qui n'est pas en français.
    pub struct Translation {
        /// Coupé, plus aucune copie ne reçoit de bouton ; ceux déjà publiés répondent encore.
        enabled "enabled": bool = true,
        /// Lire la langue est rapide : passé ce délai, la copie reste sans bouton.
        lookup_timeout_seconds "lookupTimeoutSeconds": u32 = 3,
        /// Traduire l'est moins, et le clic, déjà différé, peut attendre.
        translate_timeout_seconds "translateTimeoutSeconds": u32 = 10,
        /// Chaque tweet coûte une requête ; Discord ne range que 5 boutons par rangée.
        max_tweets "maxTweets": u32 = 3,
    }
}

section! {
    /// Pot commun : chacun cotise une part de sa fortune, la cagnotte repart en parts égales. Le
    /// prélèvement est automatique et silencieux : un réglage de l'économie, pas un événement.
    pub struct Redistribution {
        enabled "enabled": bool = true,
        /// Changer cette valeur ne déplace pas l'échéance déjà posée : elle vaut pour le pot suivant.
        interval_hours "intervalHours": u32 = 168,
        /// Part de la fortune prélevée, en pourcentage. Les soldes nuls ou négatifs ne cotisent pas,
        /// mais reçoivent leur part.
        contribution_percent "contributionPercent": f64 = 5.0,
    }
}

section! {
    /// `/admin purge-membre`, relu au lancement de chaque purge.
    pub struct PurgeMember {
        /// Salons parcourus en même temps : plus de débit, mais tous partagent la limite globale du
        /// bot, dont le jeu a aussi besoin.
        concurrency "concurrency": u32 = 6,
        progress_log_seconds "progressLogSeconds": u32 = 30,
        /// Une attente imposée par Discord au-delà de ce seuil est journalisée : c'est elle qui fait
        /// passer une purge pour bloquée.
        rate_limit_log_seconds "rateLimitLogSeconds": u32 = 10,
    }
}

section! {
    /// Anniversaires : l'heure du message de fête (heure de Paris) et le message ; `{user}` devient la
    /// mention du membre, `{name}` son pseudo.
    pub struct Birthday {
        enabled "enabled": bool = true,
        hour "hour": u32 = 9,
        message "message": String =
            "🎂 JOAAAAAAAAAAAAAAAAAAAAA {user} ! Passe une excellente journée !!!".into(),
    }
}
