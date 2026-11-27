//! Écriture groupée des compteurs de l'année dans `stats-<ANNÉE>.db`.
//!
//! `pcr-app` accumule les incréments en mémoire et les écrit ici par lots, en une transaction : un
//! message Discord ne coûte pas une écriture par mot. Les compteurs ne descendent jamais sous zéro :
//! une réaction retirée en janvier, posée en décembre, retire d'un compteur de la nouvelle année qui
//! ne l'avait jamais compté.

use sqlx::{Connection as _, SqliteConnection};

use crate::{DbError, StatsDb};

/// Une ligne de compteur d'une table de stats (les tables Pokémon s'ajoutent avec leur jeu, P4).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Counter {
    /// Messages d'un membre dans un salon, un jour de Paris (« AAAA-MM-JJ »).
    Message {
        user: i64,
        channel: i64,
        day: String,
    },
    Word {
        user: i64,
        word: String,
    },
    Emoji {
        user: i64,
        emoji: String,
    },
    /// Réactions posées par un membre.
    Reaction {
        user: i64,
    },
    /// Réactions reçues par un message.
    MessageReaction {
        message: i64,
    },
    Command {
        name: String,
    },
    /// Points misés sur les paris résolus.
    BetWagered {
        user: i64,
    },
    /// Plus gros gain à un pari : un maximum, pas une somme.
    BetMaxWin {
        user: i64,
    },
}

impl Counter {
    /// Comment deux valeurs d'un même compteur se combinent, dans le tampon comme en base : la
    /// plupart s'additionnent, un record garde la plus grande.
    pub fn combine(&self, current: i64, value: i64) -> i64 {
        match self {
            Self::BetMaxWin { .. } => current.max(value),
            _ => current + value,
        }
    }
}

/// Les statistiques de paris de l'année : celles d'un membre et celles du serveur.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct BetStats {
    pub total_wagered: i64,
    pub max_win: i64,
    pub server_wagered: i64,
    pub server_max_win: i64,
    /// Le détenteur du record du serveur (le plus petit identifiant en cas d'égalité) ; aucun tant
    /// que personne n'a rien gagné.
    pub record_holder: Option<i64>,
}

/// Les statistiques de paris de `user` et du serveur.
pub async fn bet_stats(db: &StatsDb, user: i64) -> Result<BetStats, DbError> {
    let mine = sqlx::query!(
        "SELECT total_wagered, max_win FROM bet_stats WHERE user_id = ?",
        user
    )
    .fetch_optional(db.reader())
    .await?;
    let server = sqlx::query!(
        r#"SELECT coalesce(sum(total_wagered), 0) AS "wagered!: i64",
                  coalesce(max(max_win), 0) AS "max_win!: i64"
             FROM bet_stats"#
    )
    .fetch_one(db.reader())
    .await?;
    let record_holder = sqlx::query_scalar!(
        "SELECT user_id FROM bet_stats WHERE max_win = ? AND max_win > 0 ORDER BY user_id LIMIT 1",
        server.max_win
    )
    .fetch_optional(db.reader())
    .await?;
    Ok(BetStats {
        total_wagered: mine.as_ref().map_or(0, |row| row.total_wagered),
        max_win: mine.map_or(0, |row| row.max_win),
        server_wagered: server.wagered,
        server_max_win: server.max_win,
        record_holder,
    })
}

/// Pose sa marque d'année sur une base neuve : un fichier renommé à la main reste reconnaissable.
pub async fn mark_year(db: &StatsDb, year: i16) -> Result<(), DbError> {
    let year = year.to_string();
    sqlx::query!(
        "INSERT INTO stats_meta (key, value) VALUES ('year', ?) ON CONFLICT (key) DO NOTHING",
        year
    )
    .execute(db.writer())
    .await?;
    Ok(())
}

/// Ajoute chaque `(compteur, delta)`, en une transaction : tout le lot, ou rien. Le delta est lié
/// deux fois : `excluded.count` est déjà ramené à zéro, un retrait s'y perdrait. Un record
/// ([`Counter::combine`]) garde la plus grande valeur au lieu d'ajouter.
pub async fn add_all(db: &StatsDb, counters: &[(Counter, i64)]) -> Result<(), DbError> {
    let mut conn = db.writer().acquire().await?;
    let mut tx = conn.begin().await?;
    for (counter, delta) in counters {
        let delta = *delta;
        match counter {
            Counter::Message { user, channel, day } => {
                sqlx::query!(
                    "INSERT INTO message_stats (user_id, channel_id, day, count)
                     VALUES (?, ?, ?, MAX(?, 0))
                     ON CONFLICT (user_id, channel_id, day)
                     DO UPDATE SET count = MAX(count + ?, 0)",
                    user,
                    channel,
                    day,
                    delta,
                    delta
                )
                .execute(&mut *tx)
                .await?;
            }
            Counter::Word { user, word } => {
                sqlx::query!(
                    "INSERT INTO word_stats (user_id, word, count) VALUES (?, ?, MAX(?, 0))
                     ON CONFLICT (user_id, word) DO UPDATE SET count = MAX(count + ?, 0)",
                    user,
                    word,
                    delta,
                    delta
                )
                .execute(&mut *tx)
                .await?;
            }
            Counter::Emoji { user, emoji } => {
                sqlx::query!(
                    "INSERT INTO emoji_stats (user_id, emoji, count) VALUES (?, ?, MAX(?, 0))
                     ON CONFLICT (user_id, emoji) DO UPDATE SET count = MAX(count + ?, 0)",
                    user,
                    emoji,
                    delta,
                    delta
                )
                .execute(&mut *tx)
                .await?;
            }
            Counter::Reaction { user } => {
                sqlx::query!(
                    "INSERT INTO reaction_stats (user_id, count) VALUES (?, MAX(?, 0))
                     ON CONFLICT (user_id) DO UPDATE SET count = MAX(count + ?, 0)",
                    user,
                    delta,
                    delta
                )
                .execute(&mut *tx)
                .await?;
            }
            Counter::MessageReaction { message } => {
                sqlx::query!(
                    "INSERT INTO message_reactions (message_id, count) VALUES (?, MAX(?, 0))
                     ON CONFLICT (message_id) DO UPDATE SET count = MAX(count + ?, 0)",
                    message,
                    delta,
                    delta
                )
                .execute(&mut *tx)
                .await?;
            }
            Counter::Command { name } => {
                sqlx::query!(
                    "INSERT INTO command_stats (command, count) VALUES (?, MAX(?, 0))
                     ON CONFLICT (command) DO UPDATE SET count = MAX(count + ?, 0)",
                    name,
                    delta,
                    delta
                )
                .execute(&mut *tx)
                .await?;
            }
            Counter::BetWagered { user } | Counter::BetMaxWin { user } => {
                add_bet(&mut tx, counter, *user, delta).await?;
            }
        }
    }
    tx.commit().await?;
    Ok(())
}

/// Les compteurs de paris, qui partagent leur ligne : `combine` dit lequel s'additionne.
async fn add_bet(
    conn: &mut SqliteConnection,
    counter: &Counter,
    user: i64,
    delta: i64,
) -> Result<(), DbError> {
    if matches!(counter, Counter::BetMaxWin { .. }) {
        sqlx::query!(
            "INSERT INTO bet_stats (user_id, max_win) VALUES (?, MAX(?, 0))
             ON CONFLICT (user_id) DO UPDATE SET max_win = MAX(max_win, ?)",
            user,
            delta,
            delta
        )
        .execute(conn)
        .await?;
    } else {
        sqlx::query!(
            "INSERT INTO bet_stats (user_id, total_wagered) VALUES (?, MAX(?, 0))
             ON CONFLICT (user_id) DO UPDATE SET total_wagered = MAX(total_wagered + ?, 0)",
            user,
            delta,
            delta
        )
        .execute(conn)
        .await?;
    }
    Ok(())
}
