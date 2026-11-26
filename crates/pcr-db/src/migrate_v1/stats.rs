//! Conversion des statistiques de l'année (`botdata-<ANNÉE>.db` → `stats-<ANNÉE>.db`).
//!
//! Les lignes `__global__` de la v1 portaient les totaux du serveur ; la v2 les recalcule par agrégat.
//! Elles sont écartées par le filtre d'identifiant, et les contrôles comparent leur valeur au total
//! recalculé. Les messages en attente de suppression (`messages`, autodel abandonnée) et le curseur
//! `progress` ne sont pas repris.

use sqlx::SqliteConnection;

use super::{MigrateError, Report, flag, is_id, opt_id};

const GLOBAL_OR_BAD: &str = "ligne `__global__` (total recalculé) ou identifiant invalide";

pub(super) async fn convert(
    conn: &mut SqliteConnection,
    report: &mut Report,
) -> Result<(), MigrateError> {
    convert_messages(conn, report).await?;
    convert_community(conn, report).await?;
    convert_pokemon(conn, report).await
}

/// Messages, mots, emoji et réactions.
async fn convert_messages(
    conn: &mut SqliteConnection,
    report: &mut Report,
) -> Result<(), MigrateError> {
    let user = is_id("user_id");
    report
        .copy(
            conn,
            "message_stats",
            "v1y.message_stats",
            &format!(
                "INSERT INTO message_stats (user_id, channel_id, day, count)
                 SELECT CAST(user_id AS INTEGER), CAST(channel_id AS INTEGER), date, MAX(count, 0)
                   FROM v1y.message_stats WHERE {user} AND {}",
                is_id("channel_id")
            ),
            GLOBAL_OR_BAD,
        )
        .await?;
    report
        .copy(
            conn,
            "word_stats",
            "v1y.word_stats",
            &format!(
                "INSERT INTO word_stats (user_id, word, count)
                 SELECT CAST(user_id AS INTEGER), word, MAX(count, 0)
                   FROM v1y.word_stats WHERE {user} AND word IS NOT NULL"
            ),
            GLOBAL_OR_BAD,
        )
        .await?;
    // Une réaction avec un emoji serveur supprimé n'a plus de nom : la v1 la comptait sous NULL, ce
    // qu'aucun affichage ne savait montrer.
    report
        .copy(
            conn,
            "emoji_stats",
            "v1y.emoji_stats",
            &format!(
                "INSERT INTO emoji_stats (user_id, emoji, count)
                 SELECT CAST(user_id AS INTEGER), emoji, MAX(count, 0)
                   FROM v1y.emoji_stats WHERE {user} AND emoji IS NOT NULL"
            ),
            "ligne `__global__`, emoji sans nom ou identifiant invalide",
        )
        .await?;
    report
        .copy(
            conn,
            "reaction_stats",
            "v1y.reaction_stats",
            &format!(
                "INSERT INTO reaction_stats (user_id, count)
                 SELECT CAST(user_id AS INTEGER), MAX(count, 0) FROM v1y.reaction_stats WHERE {user}"
            ),
            GLOBAL_OR_BAD,
        )
        .await?;
    report
        .copy(
            conn,
            "message_reactions",
            "v1y.message_reactions",
            &format!(
                "INSERT INTO message_reactions (message_id, count)
                 SELECT CAST(message_id AS INTEGER), MAX(count, 0)
                   FROM v1y.message_reactions WHERE {}",
                is_id("message_id")
            ),
            "identifiant de message invalide",
        )
        .await?;
    Ok(())
}

/// Commandes, paris, vocal et /randomizabaise.
async fn convert_community(
    conn: &mut SqliteConnection,
    report: &mut Report,
) -> Result<(), MigrateError> {
    let user = is_id("user_id");
    report
        .copy(
            conn,
            "command_stats",
            "v1y.command_stats",
            "INSERT INTO command_stats (command, count)
             SELECT command, MAX(count, 0) FROM v1y.command_stats WHERE command IS NOT NULL",
            "commande sans nom",
        )
        .await?;
    report
        .copy(
            conn,
            "bet_stats",
            "v1y.bet_stats",
            &format!(
                "INSERT INTO bet_stats (user_id, total_wagered, max_win)
                 SELECT CAST(user_id AS INTEGER), MAX(COALESCE(total_wagered, 0), 0),
                        MAX(COALESCE(max_win, 0), 0)
                   FROM v1y.bet_stats WHERE {user}"
            ),
            GLOBAL_OR_BAD,
        )
        .await?;
    // Une session vocale ouverte ne se mesure plus après une coupure : `joined_at` repart à NULL,
    // comme au démarrage de la v1.
    report
        .copy(
            conn,
            "voice_time",
            "v1y.voice_time",
            &format!(
                "INSERT INTO voice_time (user_id, total_time_ms, longest_session_ms, joined_at)
                 SELECT CAST(user_id AS INTEGER), MAX(COALESCE(total_time_ms, 0), 0),
                        MAX(COALESCE(longest_session, 0), 0), NULL
                   FROM v1y.voice_time WHERE {user}"
            ),
            GLOBAL_OR_BAD,
        )
        .await?;
    report
        .copy(
            conn,
            "randomizabaise_stats",
            "v1y.randomizabaise_stats",
            &format!(
                "INSERT INTO randomizabaise_stats
                        (message_id, user_a, user_b, user_c, reaction_count, is_shiny)
                 SELECT CAST(message_id AS INTEGER), CAST(user_a AS INTEGER), CAST(user_b AS INTEGER),
                        {}, MAX(COALESCE(reaction_count, 0), 0), {}
                   FROM v1y.randomizabaise_stats WHERE {} AND {} AND {}",
                opt_id("user_c"),
                flag("is_shiny"),
                is_id("message_id"),
                is_id("user_a"),
                is_id("user_b")
            ),
            "membre tiré ou message manquant",
        )
        .await
}

async fn convert_pokemon(
    conn: &mut SqliteConnection,
    report: &mut Report,
) -> Result<(), MigrateError> {
    let user = is_id("user_id");
    // La v1 parlait de fusions : `fusions` et `fusion_points` deviennent `evolutions` et
    // `evolution_points`.
    report
        .copy(
            conn,
            "pokemon_stats",
            "v1y.pokemon_stats",
            &format!(
                "INSERT INTO pokemon_stats
                        (user_id, throws, catches, points_spent, points_burned, expected_catches,
                         shiny_catches, legendary_catches, best_catch_probability, best_catch_species,
                         fastest_catch_ms, most_throws_on_one_spawn, evolutions, duplicates_spent,
                         evolution_points, trades, safari_sessions, safari_catches, safari_points_spent)
                 SELECT CAST(user_id AS INTEGER), COALESCE(throws, 0), COALESCE(catches, 0),
                        COALESCE(points_spent, 0), COALESCE(points_burned, 0),
                        COALESCE(expected_catches, 0), COALESCE(shiny_catches, 0),
                        COALESCE(legendary_catches, 0), best_catch_probability, best_catch_species,
                        fastest_catch_ms, COALESCE(most_throws_on_one_spawn, 0), COALESCE(fusions, 0),
                        COALESCE(duplicates_spent, 0), COALESCE(fusion_points, 0), COALESCE(trades, 0),
                        COALESCE(safari_sessions, 0), COALESCE(safari_catches, 0),
                        COALESCE(safari_points_spent, 0)
                   FROM v1y.pokemon_stats WHERE {user}"
            ),
            GLOBAL_OR_BAD,
        )
        .await?;
    report
        .copy(
            conn,
            "pokemon_ball_stats",
            "v1y.pokemon_ball_stats",
            &format!(
                "INSERT INTO pokemon_ball_stats (user_id, ball, count, cost)
                 SELECT CAST(user_id AS INTEGER), ball, COALESCE(count, 0), COALESCE(cost, 0)
                   FROM v1y.pokemon_ball_stats WHERE {user} AND ball IS NOT NULL"
            ),
            GLOBAL_OR_BAD,
        )
        .await?;
    report
        .copy(
            conn,
            "pokemon_species_stats",
            "v1y.pokemon_species_stats",
            "INSERT INTO pokemon_species_stats
                    (species_id, spawns, catches, escapes, shiny_spawns, shiny_catches,
                     throws_received, points_burned, max_throws_single_spawn)
             SELECT species_id, COALESCE(spawns, 0), COALESCE(catches, 0), COALESCE(escapes, 0),
                    COALESCE(shiny_spawns, 0), COALESCE(shiny_catches, 0),
                    COALESCE(throws_received, 0), COALESCE(points_burned, 0),
                    COALESCE(max_throws_single_spawn, 0)
               FROM v1y.pokemon_species_stats",
            "",
        )
        .await?;
    report
        .copy(
            conn,
            "pokemon_highlights",
            "v1y.pokemon_highlights",
            &format!(
                "INSERT INTO pokemon_highlights
                        (id, type, user_id, species_id, is_shiny, value, detail, created_at)
                 SELECT id, type, {}, species_id, {}, value, detail, created_at
                   FROM v1y.pokemon_highlights",
                opt_id("user_id"),
                flag("is_shiny")
            ),
            "",
        )
        .await?;
    report
        .copy(
            conn,
            "pokemon_daily_stats",
            "v1y.pokemon_daily_stats",
            "INSERT INTO pokemon_daily_stats (day, spawns, throws, catches, points_burned)
             SELECT date, COALESCE(spawns, 0), COALESCE(throws, 0), COALESCE(catches, 0),
                    COALESCE(points_burned, 0)
               FROM v1y.pokemon_daily_stats",
            "",
        )
        .await
}

/// Les totaux `__global__` de la v1 contre les agrégats de la v2. Un écart ne bloque rien : il dit
/// qu'une écriture du total avait échoué en v1, ou qu'une ligne de membre a été écartée.
pub(super) async fn check(
    conn: &mut SqliteConnection,
    report: &mut Report,
) -> Result<(), MigrateError> {
    for (name, v1, v2) in [
        (
            "messages du serveur",
            "SELECT sum(count) FROM v1y.message_stats WHERE user_id = '__global__'",
            "SELECT sum(count) FROM message_stats",
        ),
        (
            "réactions du serveur",
            "SELECT sum(count) FROM v1y.reaction_stats WHERE user_id = '__global__'",
            "SELECT sum(count) FROM reaction_stats",
        ),
        (
            "lancers du serveur",
            "SELECT sum(throws) FROM v1y.pokemon_stats WHERE user_id = '__global__'",
            "SELECT sum(throws) FROM pokemon_stats",
        ),
        (
            "captures du serveur",
            "SELECT sum(catches) FROM v1y.pokemon_stats WHERE user_id = '__global__'",
            "SELECT sum(catches) FROM pokemon_stats",
        ),
    ] {
        report.check_equal(conn, name, v1, v2).await?;
    }
    Ok(())
}
