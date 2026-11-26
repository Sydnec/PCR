//! Neutralisation d'une copie de la prod importée en dev (`pcr import-prod`).
//!
//! Le bot de dev est une autre application Discord, mais les données copiées désignent des messages,
//! des salons et des membres de la prod. Tout ce qui le ferait agir dessus s'éteint ici. Les annonces
//! (éclosions, anniversaires, bilans) partent dans les salons de l'instance, ceux du dev : elles
//! restent. Une table qui gagne un salon, un message ou une action envers des membres s'ajoute ici.

use crate::{Db, DbError};

/// Ce que la neutralisation a éteint, pour le journal de l'import.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Neutralized {
    pub public_messages: u64,
    pub reminders: u64,
    pub trade_drafts: u64,
    pub web_sessions: u64,
}

/// Une transaction : un import à moitié neutralisé n'est jamais mis en place.
pub async fn neutralize(db: &Db, now_ms: i64) -> Result<Neutralized, DbError> {
    let mut tx = db.writer().begin().await?;

    // Marqués disparus plutôt que supprimés : chaque ligne de jeu garde son message, simplement hors
    // de portée, comme un message supprimé à la main. Le dev n'éditera jamais la prod.
    let public_messages = sqlx::query!(
        "UPDATE public_messages SET gone_at = ? WHERE gone_at IS NULL",
        now_ms
    )
    .execute(&mut *tx)
    .await?
    .rows_affected();

    // Des MP à de vrais membres : `dm_allowlist` les bloquerait déjà, mais un garde-fou de
    // configuration ne doit pas être le seul.
    let reminders = sqlx::query!(
        "UPDATE reminders SET sent_at = ? WHERE sent_at IS NULL",
        now_ms
    )
    .execute(&mut *tx)
    .await?
    .rows_affected();

    // Un brouillon publierait son offre dans un salon de la prod ; il ne vit que quelques minutes.
    let trade_drafts = sqlx::query!("DELETE FROM pokemon_trade_drafts")
        .execute(&mut *tx)
        .await?
        .rows_affected();

    // Les connexions au site de prod n'ont rien à faire sur celui du dev.
    let web_sessions = sqlx::query!("DELETE FROM web_sessions")
        .execute(&mut *tx)
        .await?
        .rows_affected();

    tx.commit().await?;
    Ok(Neutralized {
        public_messages,
        reminders,
        trade_drafts,
        web_sessions,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn nothing_copied_from_prod_can_reach_prod_messages_or_members() {
        let dir = std::env::temp_dir().join(format!("pcr-db-import-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        let db = Db::open(&dir.join("pcr.db")).await.expect("open");
        let w = db.writer();

        sqlx::query!(
            "INSERT INTO public_messages (kind, entity_id, channel_id, message_id, changed_at)
             VALUES ('spawn', 1, 10, 20, 0), ('trade', 1, 10, 21, 0)"
        )
        .execute(w)
        .await
        .expect("messages");
        sqlx::query!(
            "INSERT INTO reminders (user_id, channel_id, message, trigger_at, created_at, sent_at)
             VALUES (1, 10, 'à venir', 9, 0, NULL), (1, 10, 'parti', 5, 0, 6)"
        )
        .execute(w)
        .await
        .expect("reminders");
        sqlx::query!(
            "INSERT INTO pokemon_trade_drafts (from_user_id, to_user_id, channel_id, created_at, expires_at)
             VALUES (1, 2, 10, 0, 9)"
        )
        .execute(w)
        .await
        .expect("draft");
        sqlx::query!(
            "INSERT INTO web_sessions (token_hash, user_id, username, created_at, expires_at)
             VALUES (zeroblob(32), 1, 'sacha', 0, 9)"
        )
        .execute(w)
        .await
        .expect("session");

        let done = neutralize(&db, 100).await.expect("neutralize");
        assert_eq!(
            done,
            Neutralized {
                public_messages: 2,
                reminders: 1,
                trade_drafts: 1,
                web_sessions: 1,
            }
        );

        let r = db.reader();
        let live =
            sqlx::query_scalar!("SELECT count(*) FROM public_messages WHERE gone_at IS NULL")
                .fetch_one(r)
                .await
                .expect("count");
        let pending = sqlx::query_scalar!("SELECT count(*) FROM reminders WHERE sent_at IS NULL")
            .fetch_one(r)
            .await
            .expect("count");
        let sent_before =
            sqlx::query_scalar!("SELECT sent_at FROM reminders WHERE message = 'parti'")
                .fetch_one(r)
                .await
                .expect("sent reminder");
        assert_eq!((live, pending), (0, 0));
        // Un rappel déjà parti garde sa vraie date d'envoi.
        assert_eq!(sent_before, Some(6));

        db.close().await;
        std::fs::remove_dir_all(&dir).ok();
    }
}
