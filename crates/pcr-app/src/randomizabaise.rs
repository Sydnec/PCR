//! `/randomizabaise` : un ship tiré parmi les porteurs du rôle par défaut, retenu dans les stats de
//! l'année (ses réactions s'y comptent ensuite).

use pcr_core::randomizabaise::{self as rules, Ship};
use pcr_db::DbError;
use rand::Rng;

use crate::{App, error::UseCaseError, members::MembersPort, redistribution::default_members};

/// Tire le ship. `Err(Ok(refus))` se montre au membre ; `Err(Err(panne))` est une panne de Discord.
pub async fn draw(
    app: &App,
    port: &dyn MembersPort,
    rng: &mut (impl Rng + Send),
) -> Result<Ship, Result<UseCaseError, String>> {
    let members = default_members(app, port)
        .await
        .map_err(Err)?
        .map_err(|refusal| Ok(refusal.into()))?;
    let odds = app.game_config().randomizabaise.shiny_odds;
    rules::draw(&members.members, odds, rng)
        .ok_or_else(|| Ok(UseCaseError::refused(rules::TOO_FEW)))
}

/// Retient le ship posté dans `message`.
pub async fn record(app: &App, message: i64, ship: &Ship) -> Result<(), DbError> {
    app.stats
        .record_ship(app.clock.now(), message, &ship.members, ship.shiny)
        .await
}

#[cfg(test)]
mod tests {
    use rand::{SeedableRng as _, rngs::StdRng};

    use super::*;
    use crate::{
        members::{Member, PortFuture, Roster},
        testing::TestApp,
    };

    /// `default_role_id` de `deploy/instance.example.toml`.
    const ROLE: i64 = 555_555_555_555_555_555;

    #[derive(Debug)]
    struct Port(Vec<i64>);

    impl MembersPort for Port {
        fn roster(&self, _role: i64) -> PortFuture<'_, Roster> {
            Box::pin(async move {
                Ok(Roster {
                    role_name: Some("Membres".to_owned()),
                    members: self
                        .0
                        .iter()
                        .map(|&id| Member {
                            id,
                            bot: false,
                            roles: vec![ROLE],
                        })
                        .collect(),
                })
            })
        }
    }

    #[tokio::test]
    async fn a_ship_needs_two_members_and_is_recorded_for_the_year() {
        let t = TestApp::new("randomizabaise", "2026-11-27T12:00:00Z").await;
        let mut rng = StdRng::seed_from_u64(3);
        assert!(matches!(
            draw(&t.app, &Port(vec![1]), &mut rng).await,
            Err(Ok(UseCaseError::Refused(refusal))) if refusal.text() == rules::TOO_FEW
        ));
        let ship = draw(&t.app, &Port(vec![1, 2]), &mut rng)
            .await
            .expect("ship");
        record(&t.app, 77, &ship).await.expect("record");
        record(&t.app, 77, &ship).await.expect("replayed");
        t.app.stats.close().await;
        let path = crate::stats::Stats::path(&t.app.instance.data_dir, 2026);
        let stats = pcr_db::StatsDb::open(&path).await.expect("stats");
        let rows: i64 =
            sqlx::query_scalar("SELECT count(*) FROM randomizabaise_stats WHERE message_id = 77")
                .fetch_one(stats.reader())
                .await
                .expect("count");
        assert_eq!(rows, 1);
        stats.close().await;
        t.close().await;
    }
}
