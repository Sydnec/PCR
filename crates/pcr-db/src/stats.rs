//! Écriture groupée des compteurs de l'année dans `stats-<ANNÉE>.db`.
//!
//! `pcr-app` accumule les incréments en mémoire et les écrit ici par lots, en une transaction : un
//! message Discord ne coûte pas une écriture par mot. Les compteurs ne descendent jamais sous zéro :
//! une réaction retirée en janvier, posée en décembre, retire d'un compteur de la nouvelle année qui
//! ne l'avait jamais compté.

use sqlx::Connection as _;

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
/// deux fois : `excluded.count` est déjà ramené à zéro, un retrait s'y perdrait.
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
        }
    }
    tx.commit().await?;
    Ok(())
}
