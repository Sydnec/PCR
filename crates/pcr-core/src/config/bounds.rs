//! Bornes des réglages numériques, reprises de la v1.

/// Bornes des réglages dont une faute de frappe ne se rattrape pas (reprises de la v1). Le type seul
/// ne protège de rien : `contributionPercent: 50` est un nombre valide, et couperait en deux la
/// fortune de tout le monde à l'échéance suivante, sans annonce ni retour possible.
pub(super) const BOUNDS: &[(&str, Option<f64>, Option<f64>)] = &[
    ("redistribution.contributionPercent", Some(0.0), Some(100.0)),
    ("redistribution.intervalHours", Some(1.0), None),
    // Diviseurs : à 0, un Pokédex ou une boîte auraient un nombre de pages infini.
    ("pokemon.pokedex.pageSize", Some(1.0), None),
    ("pokemon.box.pageSize", Some(1.0), Some(25.0)),
    // Au-delà de dix, la vitrine ne tient plus d'un coup d'œil.
    ("pokemon.showcase.slots", Some(1.0), Some(10.0)),
    ("pokemon.showcase.imageCell", Some(48.0), Some(256.0)),
    (
        "pokemon.showcase.imageTimeoutSeconds",
        Some(1.0),
        Some(30.0),
    ),
    // Au-delà, l'image devient un mur que Discord réduit jusqu'à l'illisible.
    ("pokemon.unownText.maxLetters", Some(1.0), Some(200.0)),
    ("pokemon.unownText.lettersPerLine", Some(4.0), Some(20.0)),
    ("pokemon.unownText.imageCell", Some(32.0), Some(128.0)),
    (
        "pokemon.unownText.imageTimeoutSeconds",
        Some(1.0),
        Some(30.0),
    ),
    // Changer la taille d'une boîte redistribue les places : bornée à ce qu'une grille affiche.
    ("pokemon.pc.slotsPerBox", Some(6.0), Some(60.0)),
    ("pokemon.pc.columns", Some(1.0), Some(10.0)),
    ("pokemon.pc.minBoxes", Some(1.0), Some(200.0)),
    ("pokemon.pc.maxBoxes", Some(1.0), Some(200.0)),
    ("pokemon.pc.boxNameLength", Some(1.0), Some(40.0)),
    ("pokemon.pc.nicknameLength", Some(1.0), Some(24.0)),
    // À 0, Métamorph comblerait une évolution sans être consommé.
    ("pokemon.evolution.dittosPerCopy", Some(1.0), None),
    // Une rafale de réessais martèlerait Discord ; au-delà, le rattrapage prend le relais.
    ("publicMessages.retries", Some(0.0), Some(5.0)),
    ("publicMessages.retryDelayMs", Some(0.0), Some(60_000.0)),
    ("publicMessages.repairGraceSeconds", Some(0.0), Some(3600.0)),
    ("publicMessages.repairWindowHours", Some(1.0), Some(168.0)),
    // À 0, chaque onglet ouvert relirait l'apparition en boucle.
    ("web.spawnRefreshSeconds", Some(2.0), Some(60.0)),
    ("web.accessDenialCacheSeconds", Some(0.0), Some(3600.0)),
    // Au clic, Discord ne laisse que 15 minutes pour répondre.
    (
        "links.translation.lookupTimeoutSeconds",
        Some(1.0),
        Some(60.0),
    ),
    (
        "links.translation.translateTimeoutSeconds",
        Some(1.0),
        Some(60.0),
    ),
    // Une chance sur `odds` : à 0, tout deviendrait shiny.
    ("pokemon.spawn.shinyOdds", Some(1.0), None),
    ("pokemon.safari.shinyOdds", Some(1.0), None),
    // Sous 1, un parent shiny ferait baisser les chances au lieu de les monter.
    ("pokemon.eggs.shinyParentMultiplier", Some(1.0), None),
    // Le taux de capture va de 0 à 255.
    ("pokemon.capture.minCatchRate", Some(0.0), Some(255.0)),
    // Sous 1, ces réglages feraient l'inverse de ce qu'ils promettent.
    ("pokemon.spawn.legendaryFleeMultiplier", Some(1.0), None),
    ("pokemon.spawn.generationBoost", Some(1.0), None),
    ("pokemon.capture.balls.master.priceGrowth", Some(1.0), None),
    // Au-delà de dix lignes, le bilan dépasse ce qu'un message Discord peut porter.
    ("pokemon.seasonRecap.topSize", Some(1.0), Some(10.0)),
    ("pokemon.seasonRecap.podiumSize", Some(1.0), Some(10.0)),
    // Divisions par ces nombres : à 0, un taux indéfini entrerait au classement.
    ("pokemon.seasonRecap.minThrowsForLuck", Some(1.0), None),
    ("pokemon.seasonRecap.minLotteryDraws", Some(1.0), None),
    ("pokemon.seasonRecap.minSpawnsForFleeRate", Some(1.0), None),
    ("pokemon.seasonRecap.publishWithinHours", Some(1.0), None),
    ("pokemon.seasonRecap.retryMinutes", Some(1.0), Some(1440.0)),
    ("pokemon.seasonRecap.recordRetries", Some(0.0), Some(10.0)),
    (
        "pokemon.seasonRecap.recordRetryDelayMs",
        Some(0.0),
        Some(10_000.0),
    ),
    // Le plafond (la dernière génération des données d'espèces) arrive avec ces données (P4).
    ("pokemon.generation", Some(1.0), None),
    ("birthday.hour", Some(0.0), Some(23.0)),
    // À 0, la purge attendrait sans fin ; au-delà, le bot saturerait sa limite chez Discord.
    ("purgeMember.concurrency", Some(1.0), Some(20.0)),
    ("purgeMember.progressLogSeconds", Some(5.0), Some(3600.0)),
];

/// Les bornes d'un réglage numérique. Sans borne nommée, un défaut positif ou nul refuse le négatif,
/// rien de plus : le zéro et les fractions sont légitimes presque partout (un poids à 0 exclut un
/// stade, `globalMultiplier` à 0,5 durcit les captures).
pub fn bounds(path: &str, default: f64) -> (Option<f64>, Option<f64>) {
    match BOUNDS.iter().find(|(key, _, _)| *key == path) {
        Some(&(_, min, max)) => (min, max),
        None => ((default >= 0.0).then_some(0.0), None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::edit::lookup;

    #[test]
    fn every_bound_names_a_numeric_setting() {
        for (path, _, _) in BOUNDS {
            let (_, default) = lookup(path).expect(path);
            assert!(default.is_number(), "{path}");
        }
    }
}
