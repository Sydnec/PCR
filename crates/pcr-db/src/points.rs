//! Les soldes (`points`) et leur journal (`points_log`).
//!
//! [`move_balance`] est la seule fonction qui change un solde : elle écrit la ligne du journal dans
//! la même transaction que le mouvement. Aucun chemin ne peut donc oublier le journal,
//! et un mouvement annulé (transaction défaite) n'y laisse rien.

use std::collections::HashMap;

use sqlx::SqliteConnection;

use crate::{Db, DbError};

/// D'où vient un mouvement de solde : la colonne `source` du journal. `v1` marque l'historique
/// importé, qui ne le disait pas.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Source {
    /// Gain d'un message.
    Message,
    /// `/admin points`.
    Admin,
    /// Pot commun (cotisation et part, en un mouvement net).
    Redistribution,
    /// Paris : mise, remboursement, gain.
    Bet,
}

impl Source {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Message => "message",
            Self::Admin => "admin",
            Self::Redistribution => "redistribution",
            Self::Bet => "bet",
        }
    }
}

/// Ce qu'un débit peut faire d'un solde.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Overdraft {
    /// Le solde peut passer sous zéro (`/admin points`, pot commun : il ne fait jamais plonger un
    /// cotisant).
    Allowed,
    /// Un débit que le solde ne couvre pas est refusé (achats, mises).
    Refused,
}

/// Applique `delta` au solde de `user` et le journalise sous `source`, à `now_ms`. Renvoie le solde
/// après le mouvement, ou `None` si `Overdraft::Refused` et que le solde ne couvre pas le débit (rien
/// n'est alors écrit). Un mouvement nul n'écrit rien.
pub async fn move_balance(
    conn: &mut SqliteConnection,
    user: i64,
    delta: i64,
    overdraft: Overdraft,
    source: Source,
    now_ms: i64,
) -> Result<Option<i64>, DbError> {
    if delta == 0 {
        return balance_in(conn, user).await.map(Some);
    }
    let after = if delta < 0 && overdraft == Overdraft::Refused {
        // Un dresseur sans ligne n'a jamais rien gagné : son débit est refusé, comme en v1.
        sqlx::query_scalar!(
            "UPDATE points SET balance = balance + ? WHERE user_id = ? AND balance + ? >= 0
             RETURNING balance",
            delta,
            user,
            delta
        )
        .fetch_optional(&mut *conn)
        .await?
    } else {
        Some(
            sqlx::query_scalar!(
                "INSERT INTO points (user_id, balance) VALUES (?, ?)
                 ON CONFLICT (user_id) DO UPDATE SET balance = balance + excluded.balance
                 RETURNING balance",
                user,
                delta
            )
            .fetch_one(&mut *conn)
            .await?,
        )
    };
    let Some(after) = after else {
        return Ok(None);
    };
    let source = source.as_str();
    sqlx::query!(
        "INSERT INTO points_log (user_id, delta, balance, source, created_at) VALUES (?, ?, ?, ?, ?)",
        user,
        delta,
        after,
        source,
        now_ms
    )
    .execute(&mut *conn)
    .await?;
    Ok(Some(after))
}

/// Le solde de `user` (0 sans ligne : il n'a jamais rien gagné).
pub async fn balance(db: &Db, user: i64) -> Result<i64, DbError> {
    let mut conn = db.reader().acquire().await?;
    balance_in(&mut conn, user).await
}

/// Le solde de `user`, lu dans la transaction en cours (0 sans ligne).
pub async fn balance_in(conn: &mut SqliteConnection, user: i64) -> Result<i64, DbError> {
    let balance = sqlx::query_scalar!("SELECT balance FROM points WHERE user_id = ?", user)
        .fetch_optional(conn)
        .await?;
    Ok(balance.unwrap_or(0))
}

/// Les soldes de `users`, dans la transaction du mouvement qui va les lire ; un membre sans ligne
/// est absent du résultat (solde nul).
pub async fn balances(
    conn: &mut SqliteConnection,
    users: &[i64],
) -> Result<HashMap<i64, i64>, DbError> {
    let ids = serde_json::to_string(users).unwrap_or_else(|_| "[]".to_owned());
    let rows = sqlx::query!(
        "SELECT user_id, balance FROM points WHERE user_id IN (SELECT value FROM json_each(?))",
        ids
    )
    .fetch_all(conn)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| (row.user_id, row.balance))
        .collect())
}

/// Les `limit` plus gros soldes, du plus gros au plus petit.
pub async fn top(db: &Db, limit: i64) -> Result<Vec<(i64, i64)>, DbError> {
    let rows = sqlx::query!(
        "SELECT user_id, balance FROM points ORDER BY balance DESC, user_id LIMIT ?",
        limit
    )
    .fetch_all(db.reader())
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| (row.user_id, row.balance))
        .collect())
}

/// Les gains de messages retenus pour un dresseur.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct MessageCounters {
    pub last_message_at: i64,
    pub messages_today: i64,
    /// Jour de Paris « AAAA-MM-JJ » des gains comptés.
    pub messages_day: Option<String>,
}

/// Les compteurs de gains de messages de `user` (par défaut sans ligne). Prend une connexion : le
/// gain d'un message les lit dans sa transaction, `/solde` sur un lecteur.
pub async fn message_counters(
    conn: &mut SqliteConnection,
    user: i64,
) -> Result<MessageCounters, DbError> {
    let row = sqlx::query!(
        "SELECT last_message_at, messages_today, messages_day FROM points WHERE user_id = ?",
        user
    )
    .fetch_optional(conn)
    .await?;
    Ok(
        row.map_or_else(MessageCounters::default, |row| MessageCounters {
            last_message_at: row.last_message_at,
            messages_today: row.messages_today,
            messages_day: row.messages_day,
        }),
    )
}

/// Retient le gain d'un message (après le [`move_balance`] qui l'a payé, qui a créé la ligne).
pub async fn record_message_reward(
    conn: &mut SqliteConnection,
    user: i64,
    rewarded_at: i64,
    messages_today: i64,
    day: &str,
) -> Result<(), DbError> {
    sqlx::query!(
        "UPDATE points SET last_message_at = ?, messages_today = ?, messages_day = ?
          WHERE user_id = ?",
        rewarded_at,
        messages_today,
        day,
        user
    )
    .execute(conn)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn open(name: &str) -> (Db, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("pcr-db-points-{name}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        let db = Db::open(&dir.join("pcr.db")).await.expect("open");
        (db, dir)
    }

    #[tokio::test]
    async fn every_movement_is_journaled_and_debits_never_overdraw() {
        let (db, dir) = open("move").await;
        let mut conn = db.writer().acquire().await.expect("conn");
        let credit = move_balance(&mut conn, 1, 500, Overdraft::Allowed, Source::Admin, 10)
            .await
            .expect("credit");
        assert_eq!(credit, Some(500));
        // Un débit que le solde ne couvre pas : refusé, rien d'écrit.
        let refused = move_balance(&mut conn, 1, -501, Overdraft::Refused, Source::Admin, 11)
            .await
            .expect("refused");
        assert_eq!(refused, None);
        let unknown = move_balance(&mut conn, 2, -1, Overdraft::Refused, Source::Admin, 11)
            .await
            .expect("unknown");
        assert_eq!(unknown, None);
        // Au point près, puis sous zéro quand c'est permis.
        let exact = move_balance(&mut conn, 1, -500, Overdraft::Refused, Source::Admin, 12)
            .await
            .expect("exact");
        assert_eq!(exact, Some(0));
        let negative = move_balance(&mut conn, 1, -40, Overdraft::Allowed, Source::Admin, 13)
            .await
            .expect("negative");
        assert_eq!(negative, Some(-40));
        let nothing = move_balance(&mut conn, 1, 0, Overdraft::Allowed, Source::Admin, 14)
            .await
            .expect("zero");
        assert_eq!(nothing, Some(-40));
        drop(conn);

        let log: Vec<(i64, i64, String, i64)> = sqlx::query_as(
            "SELECT delta, balance, source, created_at FROM points_log WHERE user_id = 1 ORDER BY id",
        )
        .fetch_all(db.reader())
        .await
        .expect("log");
        assert_eq!(
            log,
            [
                (500, 500, "admin".to_owned(), 10),
                (-500, 0, "admin".to_owned(), 12),
                (-40, -40, "admin".to_owned(), 13),
            ]
        );
        assert_eq!(balance(&db, 1).await.expect("balance"), -40);
        assert_eq!(balance(&db, 2).await.expect("balance"), 0);

        db.close().await;
        std::fs::remove_dir_all(&dir).ok();
    }
}
