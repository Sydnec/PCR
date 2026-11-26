//! Conversion de l'économie et de la communauté : soldes et leur journal, pot commun, paris,
//! anniversaires, rappels (venus de la base annuelle `v1y`).

use sqlx::SqliteConnection;

use super::{MigrateError, Report, flag, is_id, opt_id};

const BAD_MEMBER: &str = "identifiant de membre invalide";

pub(super) async fn convert(
    conn: &mut SqliteConnection,
    report: &mut Report,
) -> Result<(), MigrateError> {
    report
        .copy(
            conn,
            "points",
            "v1.points",
            &format!(
                "INSERT INTO points (user_id, balance, last_message_at, messages_today, messages_day)
                 SELECT CAST(user_id AS INTEGER), COALESCE(balance, 0), COALESCE(last_message_at, 0),
                        MAX(COALESCE(messages_today_count, 0), 0), NULLIF(last_reset_date, '')
                   FROM v1.points WHERE {}",
                is_id("user_id")
            ),
            BAD_MEMBER,
        )
        .await?;

    report
        .copy(
            conn,
            "points_log",
            "v1.points_log",
            &format!(
                "INSERT INTO points_log (id, user_id, delta, balance, source, created_at)
                 SELECT id, CAST(user_id AS INTEGER), delta, balance, 'v1', created_at
                   FROM v1.points_log WHERE {}",
                is_id("user_id")
            ),
            BAD_MEMBER,
        )
        .await?;

    // La ligne unique existe déjà (posée par le schéma v2) : on reprend l'échéance du prochain pot.
    // Le bail repart à zéro : aucun pot ne tourne pendant une conversion.
    report
        .copy(
            conn,
            "economy_state",
            "v1.economy_state",
            "UPDATE economy_state SET redistribution_since = 0,
                    next_redistribution_at = COALESCE(
                        (SELECT next_redistribution_at FROM v1.economy_state WHERE id = 1), 0)",
            "ligne unique",
        )
        .await?;

    report
        .copy(
            conn,
            "points_redistributions",
            "v1.points_redistributions",
            &format!(
                "INSERT INTO points_redistributions
                        (id, ran_at, triggered_by, percent, participants, contributors, pot, share)
                 SELECT id, ran_at, {}, rate, participants, contributors, pot, share
                   FROM v1.points_redistributions",
                opt_id("triggered_by")
            ),
            "",
        )
        .await?;
    report
        .fixed(
            conn,
            "SELECT count(*) FROM v1.points_redistributions WHERE failures > 0",
            "pot(s) avaient des échecs en v1 (colonne `failures` supprimée)",
        )
        .await?;

    convert_bets(conn, report).await?;

    report
        .copy(
            conn,
            "birthdays",
            "v1.birthdays",
            &format!(
                "INSERT INTO birthdays (user_id, day, month, year, last_wished_year)
                 SELECT CAST(user_id AS INTEGER), day, month, year, last_wished_year
                   FROM v1.birthdays
                  WHERE {} AND day BETWEEN 1 AND 31 AND month BETWEEN 1 AND 12",
                is_id("user_id")
            ),
            "identifiant invalide ou date impossible",
        )
        .await?;

    // Un rappel marqué envoyé sans date (anciennes lignes) prend son échéance : il est parti au plus
    // tôt à ce moment-là.
    report
        .copy(
            conn,
            "reminders",
            "v1y.reminders",
            &format!(
                "INSERT INTO reminders (id, user_id, channel_id, message, trigger_at, created_at, sent_at)
                 SELECT id, CAST(user_id AS INTEGER), CAST(channel_id AS INTEGER), message, trigger_at,
                        created_at, CASE WHEN {} THEN COALESCE(sent_at, trigger_at) END
                   FROM v1y.reminders WHERE {} AND {}",
                flag("sent"),
                is_id("user_id"),
                is_id("channel_id")
            ),
            "identifiant de membre ou de salon invalide",
        )
        .await?;
    Ok(())
}

async fn convert_bets(
    conn: &mut SqliteConnection,
    report: &mut Report,
) -> Result<(), MigrateError> {
    // La v1 rangeait dans `winning_option_index` l'option gagnante d'un pari classique, ou la vraie
    // valeur d'une estimation : la v2 les sépare.
    report
        .copy(
            conn,
            "bets",
            "v1.bets",
            &format!(
                "INSERT INTO bets (id, creator_id, title, status, is_estimation, winning_option,
                                   estimate_result)
                 SELECT id, CAST(creator_id AS INTEGER), COALESCE(title, ''), COALESCE(status, 'OPEN'),
                        {est},
                        CASE WHEN NOT {est} THEN winning_option_index END,
                        CASE WHEN {est} THEN winning_option_index END
                   FROM v1.bets WHERE {}",
                is_id("creator_id"),
                est = flag("is_estimation"),
            ),
            "identifiant du créateur invalide",
        )
        .await?;

    // Rien n'empêchait en v1 deux lignes pour la même option : la première l'emporte.
    report
        .copy(
            conn,
            "bet_options",
            "v1.bet_options",
            "INSERT INTO bet_options (bet_id, option_index, label)
             SELECT bet_id, option_index, COALESCE(label, '')
               FROM v1.bet_options
              WHERE option_index >= 1
                AND bet_id IN (SELECT id FROM bets)
                AND id IN (SELECT min(id) FROM v1.bet_options GROUP BY bet_id, option_index)",
            "pari absent, option en double ou numéro invalide",
        )
        .await?;

    // Une estimation désignait l'option 0 : la v2 n'en garde que la valeur estimée.
    report
        .copy(
            conn,
            "bet_participations",
            "v1.bet_participations",
            &format!(
                "INSERT INTO bet_participations (bet_id, user_id, option_index, amount, prediction)
                 SELECT p.bet_id, CAST(p.user_id AS INTEGER),
                        CASE WHEN b.is_estimation = 0 THEN p.option_index END, p.amount,
                        CASE WHEN b.is_estimation = 1 THEN p.prediction_value END
                   FROM v1.bet_participations AS p JOIN bets AS b ON b.id = p.bet_id
                  WHERE {} AND p.amount > 0
                    AND (b.is_estimation = 1 AND p.prediction_value IS NOT NULL
                         OR b.is_estimation = 0 AND EXISTS (
                             SELECT 1 FROM bet_options AS o
                              WHERE o.bet_id = p.bet_id AND o.option_index = p.option_index))",
                is_id("p.user_id")
            ),
            "pari ou option absents, mise nulle ou identifiant invalide",
        )
        .await?;
    Ok(())
}

/// Ce qui doit se retrouver à l'identique de part et d'autre.
pub(super) async fn check(
    conn: &mut SqliteConnection,
    report: &mut Report,
) -> Result<(), MigrateError> {
    report
        .check_equal(
            conn,
            "somme des soldes",
            "SELECT sum(balance) FROM v1.points",
            "SELECT sum(balance) FROM points",
        )
        .await?;
    report
        .check_equal(
            conn,
            "mises des paris ouverts",
            "SELECT sum(p.amount) FROM v1.bet_participations AS p
               JOIN v1.bets AS b ON b.id = p.bet_id WHERE b.status IN ('OPEN', 'LOCKED')",
            "SELECT sum(p.amount) FROM bet_participations AS p
               JOIN bets AS b ON b.id = p.bet_id WHERE b.status IN ('OPEN', 'LOCKED')",
        )
        .await?;
    report
        .check_equal(
            conn,
            "rappels en attente",
            &format!(
                "SELECT count(*) FROM v1y.reminders WHERE NOT {}",
                flag("sent")
            ),
            "SELECT count(*) FROM reminders WHERE sent_at IS NULL",
        )
        .await?;
    Ok(())
}
