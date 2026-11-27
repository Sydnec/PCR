//! Les paris (`bets`, `bet_options`, `bet_participations`).
//!
//! Les fonctions prennent la connexion de la transaction du cas d'usage : une mise relit le pari, débite
//! et s'enregistre d'un bloc, et une résolution revendique le pari avant de payer.

use sqlx::SqliteConnection;

use crate::DbError;

/// Où en est un pari.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    /// On peut miser.
    Open,
    /// Mises fermées, résultat attendu.
    Locked,
    /// Résultat déclaré, gagnants payés.
    Closed,
    /// Annulé, mises remboursées.
    Cancelled,
}

impl Status {
    fn parse(text: &str) -> Result<Self, DbError> {
        Ok(match text {
            "OPEN" => Self::Open,
            "LOCKED" => Self::Locked,
            "CLOSED" => Self::Closed,
            "CANCELLED" => Self::Cancelled,
            // Impossible tant que le `CHECK` de la colonne tient.
            other => return Err(sqlx::Error::Decode(format!("bet status {other}").into()).into()),
        })
    }

    /// Le pari attend encore son résultat (on peut le verrouiller, l'annuler ou le résoudre).
    pub fn is_pending(self) -> bool {
        matches!(self, Self::Open | Self::Locked)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Bet {
    pub id: i64,
    pub creator_id: i64,
    pub title: String,
    pub status: Status,
    pub is_estimation: bool,
    pub winning_option: Option<i64>,
    pub estimate_result: Option<i64>,
}

/// Une mise : sur une option (pari classique) ou une valeur (estimation).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Participation {
    pub user_id: i64,
    pub option_index: Option<i64>,
    pub amount: i64,
    pub prediction: Option<i64>,
}

/// Crée un pari et ses options (numérotées à partir de 1, comme leurs boutons) ; renvoie son numéro.
pub async fn create(
    conn: &mut SqliteConnection,
    creator: i64,
    title: &str,
    is_estimation: bool,
    options: &[String],
) -> Result<i64, DbError> {
    let estimation = i64::from(is_estimation);
    let id = sqlx::query_scalar!(
        "INSERT INTO bets (creator_id, title, is_estimation) VALUES (?, ?, ?) RETURNING id",
        creator,
        title,
        estimation
    )
    .fetch_one(&mut *conn)
    .await?;
    for (index, label) in (1_i64..).zip(options) {
        sqlx::query!(
            "INSERT INTO bet_options (bet_id, option_index, label) VALUES (?, ?, ?)",
            id,
            index,
            label
        )
        .execute(&mut *conn)
        .await?;
    }
    Ok(id)
}

pub async fn get(conn: &mut SqliteConnection, bet: i64) -> Result<Option<Bet>, DbError> {
    let row = sqlx::query!(
        "SELECT id, creator_id, title, status, is_estimation, winning_option, estimate_result
           FROM bets WHERE id = ?",
        bet
    )
    .fetch_optional(conn)
    .await?;
    row.map(|row| {
        Ok(Bet {
            id: row.id,
            creator_id: row.creator_id,
            title: row.title,
            status: Status::parse(&row.status)?,
            is_estimation: row.is_estimation == 1,
            winning_option: row.winning_option,
            estimate_result: row.estimate_result,
        })
    })
    .transpose()
}

/// Les options d'un pari, dans l'ordre de leurs numéros.
pub async fn options(conn: &mut SqliteConnection, bet: i64) -> Result<Vec<(i64, String)>, DbError> {
    let rows = sqlx::query!(
        "SELECT option_index, label FROM bet_options WHERE bet_id = ? ORDER BY option_index",
        bet
    )
    .fetch_all(conn)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| (row.option_index, row.label))
        .collect())
}

/// Les mises d'un pari, par membre : l'ordre où la v1 les lisait (son index sur `user_id`).
pub async fn participations(
    conn: &mut SqliteConnection,
    bet: i64,
) -> Result<Vec<Participation>, DbError> {
    let rows = sqlx::query!(
        "SELECT user_id, option_index, amount, prediction
           FROM bet_participations WHERE bet_id = ? ORDER BY user_id",
        bet
    )
    .fetch_all(conn)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| Participation {
            user_id: row.user_id,
            option_index: row.option_index,
            amount: row.amount,
            prediction: row.prediction,
        })
        .collect())
}

/// La mise de `user` sur `bet`, s'il en a une.
pub async fn participation(
    conn: &mut SqliteConnection,
    bet: i64,
    user: i64,
) -> Result<Option<Participation>, DbError> {
    let row = sqlx::query!(
        "SELECT user_id, option_index, amount, prediction
           FROM bet_participations WHERE bet_id = ? AND user_id = ?",
        bet,
        user
    )
    .fetch_optional(conn)
    .await?;
    Ok(row.map(|row| Participation {
        user_id: row.user_id,
        option_index: row.option_index,
        amount: row.amount,
        prediction: row.prediction,
    }))
}

/// Ajoute `amount` à la mise de `user` sur `option` (la crée au besoin) ; renvoie le total misé. Le
/// cas d'usage a vérifié qu'une mise existante porte sur la même option.
pub async fn add_stake(
    conn: &mut SqliteConnection,
    bet: i64,
    user: i64,
    option: i64,
    amount: i64,
) -> Result<i64, DbError> {
    Ok(sqlx::query_scalar!(
        "INSERT INTO bet_participations (bet_id, user_id, option_index, amount) VALUES (?, ?, ?, ?)
         ON CONFLICT (bet_id, user_id) DO UPDATE SET amount = amount + excluded.amount
         RETURNING amount",
        bet,
        user,
        option,
        amount
    )
    .fetch_one(conn)
    .await?)
}

/// Pose (ou remplace) l'estimation de `user` et sa mise.
pub async fn set_estimate(
    conn: &mut SqliteConnection,
    bet: i64,
    user: i64,
    prediction: i64,
    amount: i64,
) -> Result<(), DbError> {
    sqlx::query!(
        "INSERT INTO bet_participations (bet_id, user_id, amount, prediction) VALUES (?, ?, ?, ?)
         ON CONFLICT (bet_id, user_id)
         DO UPDATE SET amount = excluded.amount, prediction = excluded.prediction",
        bet,
        user,
        amount,
        prediction
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// Ferme les mises d'un pari ouvert ; `false` s'il ne l'était plus. Gardé sur `OPEN` : un verrouillage
/// arrivé après une résolution ne doit pas rouvrir un pari payé (correctif v1).
pub async fn lock(conn: &mut SqliteConnection, bet: i64) -> Result<bool, DbError> {
    let done = sqlx::query!(
        "UPDATE bets SET status = 'LOCKED' WHERE id = ? AND status = 'OPEN'",
        bet
    )
    .execute(conn)
    .await?;
    Ok(done.rows_affected() == 1)
}

/// La fin d'un pari, revendiquée.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    /// Option gagnante d'un pari classique.
    Winner(i64),
    /// Vraie valeur d'une estimation.
    Result(i64),
    Cancelled,
}

/// Termine un pari qui attendait son résultat ; `false` si un autre l'a terminé avant. Seul celui qui
/// obtient `true` paie ou rembourse : deux résolutions croisées ne paient jamais deux fois.
pub async fn finish(
    conn: &mut SqliteConnection,
    bet: i64,
    outcome: Outcome,
) -> Result<bool, DbError> {
    let (status, winning, result) = match outcome {
        Outcome::Winner(option) => ("CLOSED", Some(option), None),
        Outcome::Result(value) => ("CLOSED", None, Some(value)),
        Outcome::Cancelled => ("CANCELLED", None, None),
    };
    let done = sqlx::query!(
        "UPDATE bets SET status = ?, winning_option = ?, estimate_result = ?
          WHERE id = ? AND status IN ('OPEN', 'LOCKED')",
        status,
        winning,
        result,
        bet
    )
    .execute(conn)
    .await?;
    Ok(done.rows_affected() == 1)
}
