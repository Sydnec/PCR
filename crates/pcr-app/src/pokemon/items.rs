//! Les objets des dresseurs : les balls en poche (que `/solde` et la fiche d'une apparition montrent),
//! le gain d'un objet sous sa limite de détention, et `/admin item`.

use pcr_core::{
    config::Pokemon,
    pokemon::{
        bag::{self, Granted, Overflow},
        items,
    },
};
use pcr_db::{
    Conn, DbError,
    points::{self, Overdraft, Source},
    pokemon::items as inventory,
};

use crate::{App, error::UseCaseError};

/// Une ball en poche, prête à afficher.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BallStock {
    pub key: &'static str,
    pub label: String,
    pub emoji: String,
    pub count: i64,
}

/// Les balls que `user` a en poche, dans l'ordre du catalogue. Est une ball tout objet adossé à une
/// ball (`ball: "poke"`), quelle que soit sa clé : c'est le catalogue qui décide.
pub async fn ball_stock(app: &App, user: i64) -> Result<Vec<BallStock>, DbError> {
    let mut conn = app.db.reader().acquire().await?;
    let rows = inventory::inventory(&mut conn, user).await?;
    Ok(balls_in(&app.game_config().pokemon, &rows))
}

fn balls_in(config: &Pokemon, rows: &[(String, i64)]) -> Vec<BallStock> {
    items::all(config)
        .filter(|item| item.item.ball.is_some())
        .filter_map(|item| {
            let count = rows
                .iter()
                .find_map(|(key, count)| (key == item.key).then_some(*count))?;
            Some(BallStock {
                key: item.key,
                label: item.label.to_owned(),
                emoji: item.emoji.to_owned(),
                count,
            })
        })
        .collect()
}

/// Donne `quantity` de `key` à `user`, dans la transaction ouverte. Sous une limite de détention
/// (`Overflow::Sell`), chaque exemplaire de trop devient l'objet supérieur s'il a de la place, sinon
/// se vend d'office : on ne refuse pas un butin. `None` : clé hors catalogue, rien n'est écrit.
#[allow(clippy::too_many_arguments)] // Un gain : à qui, quoi, combien, sous quelle règle, d'où.
pub(crate) async fn grant(
    conn: &mut Conn,
    config: &Pokemon,
    user: i64,
    key: &str,
    quantity: i64,
    overflow: Overflow,
    source: &str,
    now_ms: i64,
) -> Result<Option<Granted>, DbError> {
    let Some(item) = items::get(config, key) else {
        return Ok(None);
    };
    let cap = match overflow {
        Overflow::Sell => item.cap().map(i64::from),
        Overflow::Ignore => None,
    };
    let Some(cap) = cap else {
        inventory::credit(conn, user, item.key, quantity, None, source, now_ms).await?;
        return Ok(Some(Granted {
            kept: u32::try_from(quantity).unwrap_or(u32::MAX),
            ..Granted::default()
        }));
    };
    let upgrade = bag::upgrade(config, &item);
    let mut granted = Granted::default();
    for _ in 0..quantity {
        if inventory::credit(conn, user, item.key, 1, Some(cap), source, now_ms).await? {
            granted.kept += 1;
            continue;
        }
        // La cible garde sa propre limite, dans la même instruction : deux Super Cannes de trop ne
        // font qu'une Méga Canne.
        if let Some(target) = &upgrade {
            let target_cap = target.cap().map(i64::from);
            let source = format!("amelioration:{source}");
            if inventory::credit(conn, user, target.key, 1, target_cap, &source, now_ms).await? {
                granted.upgraded += 1;
                continue;
            }
        }
        let value = i64::from(item.overflow_value());
        points::move_balance(
            conn,
            user,
            value,
            Overdraft::Allowed,
            Source::Overflow,
            now_ms,
        )
        .await?;
        granted.sold += 1;
        granted.points += value;
    }
    Ok(Some(granted))
}

/// Ce que `/admin item` a fait à un dresseur.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Moved {
    /// Avant, après.
    Done { before: i64, after: i64 },
    /// Le retrait a un plancher : il n'en a que `held`, rien n'est retiré.
    Short { held: i64 },
}

fn checked<'a>(
    config: &'a Pokemon,
    key: &str,
    quantity: i64,
) -> Result<items::CatalogueItem<'a>, UseCaseError> {
    let item =
        items::get(config, key).ok_or_else(|| UseCaseError::refused(bag::unknown_item(key)))?;
    if quantity == 0 {
        return Err(UseCaseError::refused(bag::NOTHING));
    }
    Ok(item)
}

/// `/admin item` sur un dresseur : donne (la limite de détention ne joue pas : l'administrateur
/// dédommage ou teste, et sait ce qu'il donne) ou retire, sans jamais creuser le sac.
pub async fn admin_user(
    app: &App,
    admin: u64,
    user: i64,
    key: &str,
    quantity: i64,
) -> Result<Moved, UseCaseError> {
    let config = app.game_config();
    let item = checked(&config.pokemon, key, quantity)?;
    let now_ms = app.clock.now_ms();
    let source = format!("admin:{admin}");
    let mut tx = app.db.writer().begin().await.map_err(DbError::from)?;
    let before = inventory::count(&mut tx, user, item.key).await?;
    if quantity < 0 {
        if !inventory::consume(&mut tx, user, item.key, -quantity, &source, now_ms).await? {
            return Ok(Moved::Short { held: before });
        }
    } else {
        grant(
            &mut tx,
            &config.pokemon,
            user,
            item.key,
            quantity,
            Overflow::Ignore,
            &source,
            now_ms,
        )
        .await?;
    }
    let after = inventory::count(&mut tx, user, item.key).await?;
    tx.commit().await.map_err(DbError::from)?;
    Ok(Moved::Done { before, after })
}

/// `/admin item` sur un rôle : servis, et ceux qui n'en avaient pas assez pour un retrait (épargnés),
/// en une transaction.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RoleMoved {
    pub served: i64,
    pub short: i64,
}

pub async fn admin_members(
    app: &App,
    admin: u64,
    members: &[i64],
    key: &str,
    quantity: i64,
) -> Result<RoleMoved, UseCaseError> {
    let config = app.game_config();
    let item = checked(&config.pokemon, key, quantity)?;
    let now_ms = app.clock.now_ms();
    let source = format!("admin:{admin}");
    let mut tx = app.db.writer().begin().await.map_err(DbError::from)?;
    let mut moved = RoleMoved {
        served: 0,
        short: 0,
    };
    for &member in members {
        let done = if quantity < 0 {
            inventory::consume(&mut tx, member, item.key, -quantity, &source, now_ms).await?
        } else {
            grant(
                &mut tx,
                &config.pokemon,
                member,
                item.key,
                quantity,
                Overflow::Ignore,
                &source,
                now_ms,
            )
            .await?;
            true
        };
        if done {
            moved.served += 1;
        } else {
            moved.short += 1;
        }
    }
    tx.commit().await.map_err(DbError::from)?;
    Ok(moved)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::TestApp;

    async fn count(t: &TestApp, user: i64, item: &str) -> i64 {
        t.scalar(format!(
            "SELECT coalesce((SELECT count FROM pokemon_inventory WHERE user_id = {user} AND item_key = '{item}'), 0)"
        ))
        .await
    }

    fn refusal<T: std::fmt::Debug>(result: Result<T, UseCaseError>) -> String {
        match result {
            Err(UseCaseError::Refused(refusal)) => refusal.text().to_owned(),
            other => panic!("expected a refusal, got {other:?}"),
        }
    }

    /// `test/commands-admin.test.js` : don, retrait avec plancher, refus, rôle.
    #[tokio::test]
    async fn the_administration_gives_and_takes_without_digging() {
        let t = TestApp::new("items-admin", "2026-11-27T12:00:00Z").await;
        assert_eq!(
            admin_user(&t.app, 99, 2, "pepite", 3).await.expect("give"),
            Moved::Done {
                before: 0,
                after: 3
            }
        );
        // La limite de détention ne joue pas pour l'administration.
        admin_user(&t.app, 99, 2, "ball_master", 2)
            .await
            .expect("give");
        assert_eq!(count(&t, 2, "ball_master").await, 2);
        assert_eq!(
            admin_user(&t.app, 99, 2, "pepite", -5).await.expect("take"),
            Moved::Short { held: 3 }
        );
        assert_eq!(count(&t, 2, "pepite").await, 3, "rien n'est retiré");
        assert_eq!(
            admin_user(&t.app, 99, 2, "pepite", -2).await.expect("take"),
            Moved::Done {
                before: 3,
                after: 1
            }
        );
        assert_eq!(
            refusal(admin_user(&t.app, 99, 2, "n_importe_quoi", 1).await),
            "❌ `n_importe_quoi` n'est pas un objet du catalogue."
        );
        assert_eq!(
            refusal(admin_user(&t.app, 99, 2, "pepite", 0).await),
            bag::NOTHING
        );
        assert_eq!(
            t.scalar(
                "SELECT count(*) FROM pokemon_item_log WHERE source = 'admin:99' AND item_key = 'pepite'"
            )
            .await,
            2
        );
        // Un rôle : ceux qui n'en ont pas assez sont épargnés et comptés.
        admin_user(&t.app, 99, 3, "pepite", 3).await.expect("give");
        assert_eq!(
            admin_members(&t.app, 99, &[2, 3, 4], "pepite", -2)
                .await
                .expect("role"),
            RoleMoved {
                served: 1,
                short: 2
            }
        );
        assert_eq!(
            (count(&t, 2, "pepite").await, count(&t, 3, "pepite").await),
            (1, 1)
        );
        t.close().await;
    }
}
