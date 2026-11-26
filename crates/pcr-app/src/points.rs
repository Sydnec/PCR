//! Les points : gains de messages (et leurs statistiques), solde, classement, `/admin points`.

use jiff::Timestamp;
use pcr_core::{
    clock::paris_date,
    points::{self as rules, MessageState, Reward},
    refusal::Refusal,
    stats as text,
};
use pcr_db::{
    DbError,
    points::{self, MessageCounters, Overdraft, Source},
    stats::Counter,
};

use crate::App;

/// Longueur du classement `/classement`.
pub const LEADERBOARD_SIZE: i64 = 10;

#[derive(Debug, thiserror::Error)]
pub enum PointsError {
    #[error("{0}")]
    Refused(Refusal),
    #[error(transparent)]
    Db(#[from] DbError),
}

fn state(counters: MessageCounters) -> MessageState {
    MessageState {
        last_rewarded_at: counters.last_message_at,
        rewarded_today: u32::try_from(counters.messages_today).unwrap_or(u32::MAX),
        // Un jour illisible est un autre jour : le compteur repart de zéro plutôt que de bloquer.
        day: counters.messages_day.and_then(|day| day.parse().ok()),
    }
}

/// Un message d'un membre (pas d'un bot) : ses statistiques, et son gain s'il en rapporte un.
pub async fn on_message(
    app: &App,
    author: i64,
    channel: i64,
    content: &str,
) -> Result<Option<Reward>, DbError> {
    let now = app.clock.now();
    count_message(app, now, author, channel, content);

    let config = app.game_config();
    let reward_at = |state: &MessageState| {
        rules::message_reward(
            state,
            now,
            &config.message_points_distribution,
            &config.message_points,
        )
    };
    // Coup d'œil sur un lecteur : la plupart des messages tombent dans la carence et ne coûtent
    // aucune écriture.
    let mut reader = app.db.reader().acquire().await?;
    let seen = state(points::message_counters(&mut reader, author).await?);
    drop(reader);
    if reward_at(&seen).is_none() {
        return Ok(None);
    }
    // La décision se reprend dans la transaction : deux messages simultanés y passent l'un après
    // l'autre, et le second voit le gain du premier.
    let mut tx = app.db.writer().begin().await.map_err(DbError::from)?;
    let Some(reward) = reward_at(&state(points::message_counters(&mut tx, author).await?)) else {
        return Ok(None);
    };
    let now_ms = now.as_millisecond();
    points::move_balance(
        &mut tx,
        author,
        reward.points.into(),
        Overdraft::Allowed,
        Source::Message,
        now_ms,
    )
    .await?;
    let day = paris_date(now).to_string();
    points::record_message_reward(&mut tx, author, now_ms, reward.rank.into(), &day).await?;
    tx.commit().await.map_err(DbError::from)?;
    Ok(Some(reward))
}

/// Le message compte pour l'auteur dans son salon et son jour de Paris, ses mots et ses emoji.
fn count_message(app: &App, now: Timestamp, user: i64, channel: i64, content: &str) {
    let day = paris_date(now).to_string();
    app.stats
        .add(now, Counter::Message { user, channel, day }, 1);
    for word in text::words(content) {
        app.stats.add(now, Counter::Word { user, word }, 1);
    }
    for emoji in text::emoji(content) {
        app.stats.add(now, Counter::Emoji { user, emoji }, 1);
    }
}

/// Ce que `/solde` montre d'un dresseur.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Summary {
    pub balance: i64,
    /// Le prochain gain possible ; `None` : dès maintenant.
    pub next_points_at: Option<Timestamp>,
}

/// Le solde de `user` et le moment où un message pourra de nouveau lui rapporter.
pub async fn summary(app: &App, user: i64) -> Result<Summary, DbError> {
    let now = app.clock.now();
    let config = app.game_config();
    let balance = points::balance(&app.db, user).await?;
    let mut reader = app.db.reader().acquire().await?;
    let counters = points::message_counters(&mut reader, user).await?;
    Ok(Summary {
        balance,
        next_points_at: rules::next_points_at(
            &state(counters),
            now,
            &config.message_points_distribution,
            &config.message_points,
        ),
    })
}

/// Les plus gros soldes (dresseur, solde).
pub async fn leaderboard(app: &App) -> Result<Vec<(i64, i64)>, DbError> {
    points::top(&app.db, LEADERBOARD_SIZE).await
}

/// Le solde d'un dresseur servi par `/admin points`, avant et après.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Granted {
    pub before: i64,
    pub after: i64,
}

/// `/admin points` sur un dresseur : crédite, ou débite sans plancher. Un solde négatif bloque les
/// achats jusqu'à ce qu'il remonte : c'est voulu.
pub async fn grant_user(app: &App, user: i64, amount: i64) -> Result<Granted, PointsError> {
    rules::check_admin_amount(amount).map_err(PointsError::Refused)?;
    let mut tx = app.db.writer().begin().await.map_err(DbError::from)?;
    let after = points::move_balance(
        &mut tx,
        user,
        amount,
        Overdraft::Allowed,
        Source::Admin,
        app.clock.now_ms(),
    )
    .await?
    .unwrap_or_default();
    tx.commit().await.map_err(DbError::from)?;
    Ok(Granted {
        before: after - amount,
        after,
    })
}

/// `/admin points` sur un rôle : le même mouvement pour chacun, en une transaction. Une distribution
/// interrompue à mi-chemin ne sert personne à moitié. Renvoie le nombre de bénéficiaires.
pub async fn grant_members(app: &App, members: &[i64], amount: i64) -> Result<i64, PointsError> {
    rules::check_admin_amount(amount).map_err(PointsError::Refused)?;
    let now_ms = app.clock.now_ms();
    let mut tx = app.db.writer().begin().await.map_err(DbError::from)?;
    for &member in members {
        points::move_balance(
            &mut tx,
            member,
            amount,
            Overdraft::Allowed,
            Source::Admin,
            now_ms,
        )
        .await?;
    }
    tx.commit().await.map_err(DbError::from)?;
    Ok(i64::try_from(members.len()).unwrap_or(i64::MAX))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::TestApp;

    #[tokio::test]
    async fn a_message_pays_once_per_cooldown_and_is_journaled() {
        let t = TestApp::new("points-message", "2026-10-06T10:00:00Z").await;
        let first = on_message(&t.app, 1, 900, "bonjour").await.expect("first");
        assert_eq!(
            first,
            Some(Reward {
                rank: 1,
                points: 750
            })
        );
        let again = on_message(&t.app, 1, 900, "encore").await.expect("again");
        assert_eq!(again, None);
        let later = t.at("2026-10-06T11:00:00Z");
        let second = on_message(&later, 1, 900, "plus tard")
            .await
            .expect("second");
        assert_eq!(
            second,
            Some(Reward {
                rank: 2,
                points: 600
            })
        );

        assert_eq!(
            t.scalar("SELECT balance FROM points WHERE user_id = 1")
                .await,
            1350
        );
        assert_eq!(
            t.scalar("SELECT count(*) FROM points_log WHERE user_id = 1 AND source = 'message'")
                .await,
            2
        );
        assert_eq!(
            t.scalar(
                "SELECT count(*) FROM points
                  WHERE user_id = 1 AND messages_today = 2 AND messages_day = '2026-10-06'"
            )
            .await,
            1
        );
        let summary = summary(&later, 1).await.expect("summary");
        assert_eq!(summary.balance, 1350);
        assert_eq!(
            summary.next_points_at,
            Some(crate::testing::at("2026-10-06T12:00:00Z"))
        );
        t.close().await;
    }

    #[tokio::test]
    async fn a_reward_that_fails_halfway_pays_nothing() {
        let t = TestApp::new("points-message-failure", "2026-10-06T10:00:00Z").await;
        t.sql(
            "CREATE TRIGGER panne BEFORE UPDATE OF messages_today ON points
             BEGIN SELECT RAISE(ABORT, 'panne'); END",
        )
        .await;
        assert!(on_message(&t.app, 1, 900, "bonjour").await.is_err());
        assert_eq!(t.scalar("SELECT count(*) FROM points").await, 0);
        assert_eq!(t.scalar("SELECT count(*) FROM points_log").await, 0);
        t.close().await;
    }

    #[tokio::test]
    async fn an_admin_grant_reports_both_balances_and_may_go_negative() {
        let t = TestApp::new("points-grant", "2026-10-06T10:00:00Z").await;
        let given = grant_user(&t.app, 1, 300).await.expect("grant");
        assert_eq!(
            given,
            Granted {
                before: 0,
                after: 300
            }
        );
        let taken = grant_user(&t.app, 1, -500).await.expect("take");
        assert_eq!(
            taken,
            Granted {
                before: 300,
                after: -200
            }
        );
        assert!(matches!(
            grant_user(&t.app, 1, 0).await,
            Err(PointsError::Refused(_))
        ));
        assert_eq!(
            t.scalar("SELECT count(*) FROM points_log WHERE source = 'admin'")
                .await,
            2
        );
        t.close().await;
    }

    #[tokio::test]
    async fn a_role_grant_that_fails_halfway_serves_nobody() {
        let t = TestApp::new("points-grant-role", "2026-10-06T10:00:00Z").await;
        t.sql(
            "CREATE TRIGGER panne BEFORE INSERT ON points_log WHEN NEW.user_id = 3
             BEGIN SELECT RAISE(ABORT, 'panne'); END",
        )
        .await;
        assert!(grant_members(&t.app, &[1, 2, 3], 100).await.is_err());
        assert_eq!(t.scalar("SELECT count(*) FROM points").await, 0);
        assert_eq!(t.scalar("SELECT count(*) FROM points_log").await, 0);
        t.sql("DROP TRIGGER panne").await;
        assert_eq!(
            grant_members(&t.app, &[1, 2, 3], 100).await.expect("grant"),
            3
        );
        assert_eq!(t.scalar("SELECT sum(balance) FROM points").await, 300);
        t.close().await;
    }
}
