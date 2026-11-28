//! Écriture groupée des compteurs de l'année dans `stats-<ANNÉE>.db`.
//!
//! `pcr-app` accumule les incréments en mémoire et les écrit ici par lots, en une transaction : un
//! message Discord ne coûte pas une écriture par mot. Les compteurs ne descendent jamais sous zéro :
//! une réaction retirée en janvier, posée en décembre, retire d'un compteur de la nouvelle année qui
//! ne l'avait jamais compté.

use sqlx::{Connection as _, SqliteConnection};

use crate::{DbError, StatsDb};

mod pokemon;

pub use pokemon::{
    BallColumn, DailyColumn, Highlight, HighlightKind, SpeciesColumn, UserColumn,
    record_expected_catch, record_highlight, record_personal_bests,
};

/// Une ligne de compteur d'une table de stats.
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
    /// Réactions reçues par le message d'un `/randomizabaise` (sa ligne existe déjà).
    ShipReaction {
        message: i64,
    },
    /// Une colonne de `pokemon_species_stats`.
    PokemonSpecies {
        species: i64,
        column: SpeciesColumn,
    },
    /// Une colonne de `pokemon_daily_stats`, un jour de Paris.
    PokemonDaily {
        day: String,
        column: DailyColumn,
    },
    /// Une colonne de `pokemon_stats`, celle d'un dresseur.
    PokemonUser {
        user: i64,
        column: UserColumn,
    },
    /// L'usage d'une ball par un dresseur (`pokemon_ball_stats`).
    PokemonBall {
        user: i64,
        ball: String,
        column: BallColumn,
    },
}

impl Counter {
    /// Comment deux valeurs d'un même compteur se combinent, dans le tampon comme en base : la
    /// plupart s'additionnent, un record garde la plus grande.
    pub fn combine(&self, current: i64, value: i64) -> i64 {
        match self {
            Self::BetMaxWin { .. }
            | Self::PokemonSpecies {
                column: SpeciesColumn::MaxThrowsSingleSpawn,
                ..
            }
            | Self::PokemonUser {
                column: UserColumn::MostThrowsOnOneSpawn,
                ..
            } => current.max(value),
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

/// Un `/randomizabaise` : le message et les membres shippés (ses réactions se comptent ensuite).
/// Rejoué, il ne change rien.
pub async fn record_ship(
    db: &StatsDb,
    message: i64,
    members: &[i64],
    shiny: bool,
) -> Result<(), DbError> {
    let (Some(&a), Some(&b)) = (members.first(), members.get(1)) else {
        return Ok(());
    };
    let c = members.get(2).copied();
    let shiny = i64::from(shiny);
    sqlx::query!(
        "INSERT INTO randomizabaise_stats (message_id, user_a, user_b, user_c, is_shiny)
         VALUES (?, ?, ?, ?, ?) ON CONFLICT (message_id) DO NOTHING",
        message,
        a,
        b,
        c,
        shiny
    )
    .execute(db.writer())
    .await?;
    Ok(())
}

/// Un membre entre en vocal à `at` (ms). Changer de salon ne relance pas la session.
pub async fn voice_joined(db: &StatsDb, user: i64, at: i64) -> Result<(), DbError> {
    sqlx::query!(
        "INSERT INTO voice_time (user_id, joined_at) VALUES (?, ?)
         ON CONFLICT (user_id) DO UPDATE SET joined_at = coalesce(joined_at, excluded.joined_at)",
        user,
        at
    )
    .execute(db.writer())
    .await?;
    Ok(())
}

/// Un membre quitte le vocal à `at` : la session s'ajoute à son total et peut devenir sa plus longue.
pub async fn voice_left(db: &StatsDb, user: i64, at: i64) -> Result<(), DbError> {
    sqlx::query!(
        "UPDATE voice_time
            SET total_time_ms = total_time_ms + MAX(? - joined_at, 0),
                longest_session_ms = MAX(longest_session_ms, ? - joined_at),
                joined_at = NULL
          WHERE user_id = ? AND joined_at IS NOT NULL",
        at,
        at,
        user
    )
    .execute(db.writer())
    .await?;
    Ok(())
}

/// Au démarrage : seules les sessions des membres encore en vocal (`in_voice`) continuent ; les
/// autres, coupées par l'arrêt, ne se mesurent plus.
pub async fn voice_reset(db: &StatsDb, in_voice: &[i64]) -> Result<u64, DbError> {
    let ids = serde_json::to_string(in_voice).unwrap_or_else(|_| "[]".to_owned());
    let done = sqlx::query!(
        "UPDATE voice_time SET joined_at = NULL
          WHERE joined_at IS NOT NULL AND user_id NOT IN (SELECT value FROM json_each(?))",
        ids
    )
    .execute(db.writer())
    .await?;
    Ok(done.rows_affected())
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
            Counter::ShipReaction { message } => {
                sqlx::query!(
                    "UPDATE randomizabaise_stats SET reaction_count = MAX(reaction_count + ?, 0)
                      WHERE message_id = ?",
                    delta,
                    message
                )
                .execute(&mut *tx)
                .await?;
            }
            Counter::BetWagered { user } | Counter::BetMaxWin { user } => {
                add_bet(&mut tx, counter, *user, delta).await?;
            }
            Counter::PokemonSpecies { .. }
            | Counter::PokemonDaily { .. }
            | Counter::PokemonUser { .. }
            | Counter::PokemonBall { .. } => pokemon::add(&mut tx, counter, delta).await?,
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
