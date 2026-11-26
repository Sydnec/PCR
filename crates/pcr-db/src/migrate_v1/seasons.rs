//! Conversion des générations, des starters et de leurs récompenses, et des bilans de saison.

use sqlx::SqliteConnection;

use super::{MigrateError, Report, is_id};

pub(super) async fn convert(
    conn: &mut SqliteConnection,
    report: &mut Report,
) -> Result<(), MigrateError> {
    report
        .copy(
            conn,
            "pokemon_generations",
            "v1.pokemon_generations",
            "INSERT INTO pokemon_generations (generation, announced_at)
             SELECT generation, announced_at FROM v1.pokemon_generations",
            "",
        )
        .await?;

    report
        .copy(
            conn,
            "pokemon_starters",
            "v1.pokemon_starters",
            &format!(
                "INSERT INTO pokemon_starters (user_id, generation, species_id, chosen_at)
                 SELECT CAST(user_id AS INTEGER), generation, species_id, chosen_at
                   FROM v1.pokemon_starters WHERE {}",
                is_id("user_id")
            ),
            "identifiant de membre invalide",
        )
        .await?;

    report
        .copy(
            conn,
            "pokemon_starter_rewards",
            "v1.pokemon_starter_rewards",
            &format!(
                "INSERT INTO pokemon_starter_rewards (user_id, generation, percent, given_at)
                 SELECT CAST(r.user_id AS INTEGER), r.generation, r.percent, r.given_at
                   FROM v1.pokemon_starter_rewards AS r
                  WHERE {} AND EXISTS (
                        SELECT 1 FROM pokemon_starters AS s
                         WHERE s.user_id = CAST(r.user_id AS INTEGER) AND s.generation = r.generation)",
                is_id("r.user_id")
            ),
            "starter absent ou identifiant invalide",
        )
        .await?;

    // Le message publié part dans `public_messages`.
    report
        .copy(
            conn,
            "pokemon_season_recaps",
            "v1.pokemon_season_recaps",
            "INSERT INTO pokemon_season_recaps
                    (season, started_at, ended_at, claimed_at, attempts, posted_at, skipped_at, payload)
             SELECT season, started_at, ended_at, claimed_at, MAX(COALESCE(attempts, 0), 0),
                    posted_at, skipped_at, CASE WHEN json_valid(payload) THEN payload END
               FROM v1.pokemon_season_recaps",
            "",
        )
        .await
}
