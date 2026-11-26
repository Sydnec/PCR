//! Conversion du parc safari : parcs, visites, captures et journal des actions.

use sqlx::SqliteConnection;

use super::{MigrateError, Report, flag, is_id, opt_id};

pub(super) async fn convert(
    conn: &mut SqliteConnection,
    report: &mut Report,
) -> Result<(), MigrateError> {
    report
        .copy(
            conn,
            "pokemon_safari_parks",
            "v1.pokemon_safari_parks",
            &format!(
                "INSERT INTO pokemon_safari_parks
                        (id, status, opened_at, expires_at, opened_by, reserved_for, entries, closed_at)
                 SELECT id, status, opened_at, expires_at, {}, {}, COALESCE(entries, 0), closed_at
                   FROM v1.pokemon_safari_parks",
                opt_id("opened_by"),
                opt_id("reserved_for")
            ),
            "",
        )
        .await?;

    // Les `live_*` (salon, message, fin écrite) partent dans `public_messages` ; seule la signature
    // du direct reste ici.
    report
        .copy(
            conn,
            "pokemon_safari_sessions",
            "v1.pokemon_safari_sessions",
            &format!(
                "INSERT INTO pokemon_safari_sessions
                        (id, park_id, user_id, status, generations, actions_left, entry_cost,
                         started_at, expires_at, ended_at, balls_thrown, baits_used, flees, catches,
                         encounter_no, encounter_species_id, encounter_is_shiny, encounter_catch_rate,
                         encounter_bait, encounter_sex, encounter_form, shared_at, live_author)
                 SELECT id, CASE WHEN park_id IN (SELECT id FROM pokemon_safari_parks) THEN park_id END,
                        CAST(user_id AS INTEGER), status, NULLIF(generations, ''), actions_left,
                        COALESCE(entry_cost, 0), started_at, expires_at, ended_at,
                        COALESCE(balls_thrown, 0), COALESCE(baits_used, 0), COALESCE(flees, 0),
                        COALESCE(catches, 0), COALESCE(encounter_no, 0), encounter_species_id, {},
                        encounter_catch_rate, COALESCE(encounter_bait, 0), NULLIF(encounter_sex, ''),
                        NULLIF(encounter_form, ''), shared_at,
                        CASE WHEN json_valid(live_author) THEN live_author END
                   FROM v1.pokemon_safari_sessions WHERE {}",
                flag("encounter_is_shiny"),
                is_id("user_id")
            ),
            "identifiant de membre invalide",
        )
        .await?;

    report
        .copy(
            conn,
            "pokemon_safari_catches",
            "v1.pokemon_safari_catches",
            &format!(
                "INSERT INTO pokemon_safari_catches (id, session_id, species_id, is_shiny, form, caught_at)
                 SELECT id, session_id, species_id, {}, NULLIF(form, ''), caught_at
                   FROM v1.pokemon_safari_catches
                  WHERE session_id IN (SELECT id FROM pokemon_safari_sessions)",
                flag("is_shiny")
            ),
            "visite absente",
        )
        .await?;

    report
        .copy(
            conn,
            "pokemon_safari_events",
            "v1.pokemon_safari_events",
            &format!(
                "INSERT INTO pokemon_safari_events
                        (id, session_id, outcome, species_id, is_shiny, sex, form, played_at)
                 SELECT id, session_id, outcome, species_id, {}, NULLIF(sex, ''), NULLIF(form, ''),
                        played_at
                   FROM v1.pokemon_safari_events
                  WHERE session_id IN (SELECT id FROM pokemon_safari_sessions)",
                flag("is_shiny")
            ),
            "visite absente",
        )
        .await
}
