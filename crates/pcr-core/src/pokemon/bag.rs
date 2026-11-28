//! Le sac d'un dresseur : ce que devient un objet gagné au-delà de sa limite de détention (`maxHeld`),
//! et ce que l'administration peut y mettre ou en retirer.
//!
//! Un objet plafonné ne se refuse pas : l'exemplaire de trop devient son `upgradesTo` s'il a encore de
//! la place (la Super Canne de trop devient la Méga Canne qui manque), sinon il se vend
//! `overflowValue` points. La Master Ball n'en garde qu'une : en accumuler retirait toute tension aux
//! légendaires.

use super::items::{self, CatalogueItem};
use crate::{config::Pokemon, format};

/// Comment un gain traite la limite de détention.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Overflow {
    /// Le butin ordinaire : le surplus change d'objet ou se vend.
    Sell,
    /// Une compensation ou un don de l'administration : la limite ne joue pas.
    Ignore,
}

/// Ce qu'est devenu un gain : gardé, changé en son objet supérieur, vendu d'office.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Granted {
    pub kept: u32,
    pub upgraded: u32,
    pub sold: u32,
    /// Ce que la vente d'office a rapporté.
    pub points: i64,
}

/// L'objet en lequel se change un exemplaire de trop, s'il y en a un (et pas lui-même).
pub fn upgrade<'a>(config: &'a Pokemon, item: &CatalogueItem<'_>) -> Option<CatalogueItem<'a>> {
    let target = item.item.upgrades_to.as_deref()?;
    items::get(config, target).filter(|target| target.key != item.key)
}

/// La phrase d'un gain dont une part a été changée ou vendue d'office (la même sur Discord et sur le
/// site), ou rien quand tout a été gardé. Texte de la v1.
pub fn overflow_notice(
    config: &Pokemon,
    item: &CatalogueItem<'_>,
    granted: &Granted,
) -> Option<String> {
    if granted.sold == 0 && granted.upgraded == 0 {
        return None;
    }
    let label = item.label;
    let changed = (granted.upgraded > 0).then(|| {
        let target = upgrade(config, item).map_or("autre", |target| target.label);
        let what = if granted.upgraded > 1 {
            format!("{} d'entre elles deviennent", granted.upgraded)
        } else {
            "celle-ci devient".to_owned()
        };
        format!("Tu as déjà une {label} : {what} une **{target}** !")
    });
    let sold = (granted.sold > 0).then(|| {
        let cap = item.cap().unwrap_or(1);
        let held = if cap > 1 {
            format!("{cap} {label}")
        } else {
            format!("une {label}")
        };
        let what = if granted.sold > 1 {
            format!("les {} de plus sont vendues", granted.sold)
        } else {
            "celle-ci est vendue".to_owned()
        };
        format!(
            "Tu as déjà {held}, le maximum : {what} **{}** points.",
            format::number(granted.points)
        )
    });
    Some(
        [changed, sold]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>()
            .join(" "),
    )
}

/// `/admin item` sur une clé hors catalogue.
pub fn unknown_item(key: &str) -> String {
    format!("❌ `{key}` n'est pas un objet du catalogue.")
}

/// `/admin item` avec une quantité nulle.
pub const NOTHING: &str = "❌ Une quantité de 0 ne changerait rien.";

/// `/admin item` qui retirerait plus que le sac n'en contient : le retrait a un plancher (un solde
/// négatif est un état de jeu voulu, un sac à -2 tickets n'est rien du tout).
pub fn not_enough(name: &str, held: i64, item: &CatalogueItem<'_>, quantity: i64) -> String {
    format!(
        "❌ **{name}** n'a que **{held}** {} {}, impossible d'en retirer **{quantity}**.",
        item.emoji, item.label
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `test/item-cap.test.js` : la phrase dit ce qui a été changé ou vendu, et rien sinon.
    #[test]
    fn the_notice_tells_what_was_changed_or_sold() {
        let config = Pokemon::default();
        let master = items::get(&config, "ball_master").expect("master");
        let sold = Granted {
            sold: 1,
            points: 10_000,
            ..Granted::default()
        };
        assert_eq!(
            overflow_notice(&config, &master, &sold).as_deref(),
            Some(
                "Tu as déjà une Master Ball, le maximum : celle-ci est vendue **10\u{202f}000** points."
            )
        );
        let kept = Granted {
            kept: 1,
            ..Granted::default()
        };
        assert_eq!(overflow_notice(&config, &master, &kept), None);
        let rod = items::get(&config, "super_canne").expect("super canne");
        let upgraded = Granted {
            upgraded: 1,
            ..Granted::default()
        };
        assert_eq!(
            overflow_notice(&config, &rod, &upgraded).as_deref(),
            Some("Tu as déjà une Super Canne : celle-ci devient une **Méga Canne** !")
        );
        let rod_sold = Granted {
            sold: 1,
            points: 500,
            ..Granted::default()
        };
        assert_eq!(
            overflow_notice(&config, &rod, &rod_sold).as_deref(),
            Some("Tu as déjà une Super Canne, le maximum : celle-ci est vendue **500** points.")
        );
        assert!(upgrade(&config, &master).is_none());
    }
}
