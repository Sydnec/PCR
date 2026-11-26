//! Conversion du cœur du jeu Pokémon : état global, apparitions et lancers, objets au sol, collection,
//! œufs, échanges. Les salons et messages partent dans `public_messages` (voir `messages`).

use sqlx::SqliteConnection;

use super::{MigrateError, Report, flag, is_id, opt_id};

const BAD_MEMBER: &str = "identifiant de membre invalide";

pub(super) async fn convert(
    conn: &mut SqliteConnection,
    report: &mut Report,
) -> Result<(), MigrateError> {
    // Ligne unique déjà posée par le schéma v2. Le drapeau `spawning` disparaît : aucune apparition
    // n'est en cours de création pendant une conversion.
    report
        .copy(
            conn,
            "pokemon_state",
            "v1.pokemon_state",
            "UPDATE pokemon_state SET
                    message_count = COALESCE((SELECT message_count FROM v1.pokemon_state), 0),
                    last_spawn_at = COALESCE((SELECT last_spawn_at FROM v1.pokemon_state), 0),
                    total_spawns = COALESCE((SELECT total_spawns FROM v1.pokemon_state), 0),
                    spawn_paused_until = COALESCE((SELECT spawn_paused_until FROM v1.pokemon_state), 0)",
            "ligne unique",
        )
        .await?;

    // Une rareté manquante ferait échouer la conversion (NOT NULL) : la v1 l'écrit toujours, et la
    // recalculer demanderait les données d'espèces.
    report
        .copy(
            conn,
            "pokemon_spawns",
            "v1.pokemon_spawns",
            &format!(
                "INSERT INTO pokemon_spawns
                        (id, species_id, is_shiny, charm_shiny, catch_rate, rarity, held_item, sex, form,
                         status, fished, reserved_for, cast_cost, spawned_at, flees_at, throw_count,
                         caught_by, caught_at, caught_ball, ended_at)
                 SELECT id, species_id, {}, {}, catch_rate, rarity, NULLIF(held_item, ''),
                        NULLIF(sex, ''), NULLIF(form, ''), status, {}, {}, cast_cost, spawned_at,
                        flees_at, COALESCE(throw_count, 0), {}, caught_at, NULLIF(caught_ball, ''),
                        ended_at
                   FROM v1.pokemon_spawns",
                flag("is_shiny"),
                flag("charm_shiny"),
                flag("fished"),
                opt_id("reserved_for"),
                opt_id("caught_by"),
            ),
            "",
        )
        .await?;

    report
        .copy(
            conn,
            "pokemon_throws",
            "v1.pokemon_throws",
            &format!(
                "INSERT INTO pokemon_throws
                        (id, spawn_id, user_id, ball, cost, probability, result, thrown_at)
                 SELECT id, spawn_id, CAST(user_id AS INTEGER), ball, cost, probability, result, thrown_at
                   FROM v1.pokemon_throws
                  WHERE {} AND spawn_id IN (SELECT id FROM pokemon_spawns)",
                is_id("user_id")
            ),
            "apparition absente ou identifiant invalide",
        )
        .await?;

    // Un objet tombé garde sa ligne même si son apparition manque : il reste à ramasser.
    report
        .copy(
            conn,
            "pokemon_drops",
            "v1.pokemon_drops",
            &format!(
                "INSERT INTO pokemon_drops
                        (id, spawn_id, item_key, species_id, status, dropped_at, claimed_by, claimed_at)
                 SELECT id, CASE WHEN spawn_id IN (SELECT id FROM pokemon_spawns) THEN spawn_id END,
                        item_key, species_id, status, dropped_at, {}, claimed_at
                   FROM v1.pokemon_drops",
                opt_id("claimed_by")
            ),
            "",
        )
        .await?;
    report
        .fixed(
            conn,
            "SELECT count(*) FROM v1.pokemon_drops
              WHERE spawn_id IS NOT NULL AND spawn_id NOT IN (SELECT id FROM pokemon_spawns)",
            "objet(s) dont l'apparition manque : `spawn_id` → NULL",
        )
        .await?;

    convert_collection(conn, report).await?;
    convert_trades(conn, report).await
}

async fn convert_collection(
    conn: &mut SqliteConnection,
    report: &mut Report,
) -> Result<(), MigrateError> {
    // La v1 ignorait déjà une case de PC négative à la lecture : elle redevient « sans case ».
    report
        .copy(
            conn,
            "pokemon_owned",
            "v1.pokemon_owned",
            &format!(
                "INSERT INTO pokemon_owned
                        (id, user_id, species_id, is_shiny, sex, form, ball, origin, sterile, locked,
                         obtained_at, pc_pos, nickname, showcase_pos)
                 SELECT id, CAST(user_id AS INTEGER), species_id, {}, NULLIF(sex, ''), NULLIF(form, ''),
                        NULLIF(ball, ''), origin, {}, {}, obtained_at,
                        CASE WHEN pc_pos >= 0 THEN pc_pos END, NULLIF(nickname, ''), showcase_pos
                   FROM v1.pokemon_owned WHERE {}",
                flag("is_shiny"),
                flag("sterile"),
                flag("locked"),
                is_id("user_id")
            ),
            BAD_MEMBER,
        )
        .await?;
    report
        .fixed(
            conn,
            "SELECT count(*) FROM v1.pokemon_owned WHERE pc_pos < 0",
            "case(s) de PC négative(s) → NULL",
        )
        .await?;

    report
        .copy(
            conn,
            "pokemon_pc_boxes",
            "v1.pokemon_pc_boxes",
            &format!(
                "INSERT INTO pokemon_pc_boxes (user_id, box, name, archived)
                 SELECT CAST(user_id AS INTEGER), box, NULLIF(name, ''), {}
                   FROM v1.pokemon_pc_boxes WHERE {} AND box >= 0",
                flag("archived"),
                is_id("user_id")
            ),
            "identifiant invalide ou boîte négative",
        )
        .await?;

    report
        .copy(
            conn,
            "pokemon_showcase_shares",
            "v1.pokemon_showcase_shares",
            &format!(
                "INSERT INTO pokemon_showcase_shares (user_id, shared_at)
                 SELECT CAST(user_id AS INTEGER), shared_at FROM v1.pokemon_showcase_shares WHERE {}",
                is_id("user_id")
            ),
            BAD_MEMBER,
        )
        .await?;

    report
        .copy(
            conn,
            "pokemon_evolutions",
            "v1.pokemon_fusions",
            &format!(
                "INSERT INTO pokemon_evolutions
                        (id, user_id, from_species_id, to_species_id, is_shiny, duplicates_spent,
                         points_spent, created_at)
                 SELECT id, CAST(user_id AS INTEGER), from_species_id, to_species_id, {},
                        duplicates_spent, points_spent, created_at
                   FROM v1.pokemon_fusions WHERE {}",
                flag("is_shiny"),
                is_id("user_id")
            ),
            BAD_MEMBER,
        )
        .await?;

    report
        .copy(
            conn,
            "pokemon_sales",
            "v1.pokemon_sales",
            &format!(
                "INSERT INTO pokemon_sales (id, user_id, species_id, is_shiny, quantity, points, sold_at)
                 SELECT id, CAST(user_id AS INTEGER), species_id, {}, quantity, points, sold_at
                   FROM v1.pokemon_sales WHERE {} AND quantity > 0",
                flag("is_shiny"),
                is_id("user_id")
            ),
            "identifiant invalide ou quantité nulle",
        )
        .await?;

    convert_eggs(conn, report).await
}

async fn convert_eggs(
    conn: &mut SqliteConnection,
    report: &mut Report,
) -> Result<(), MigrateError> {
    report
        .copy(
            conn,
            "pokemon_eggs",
            "v1.pokemon_eggs",
            &format!(
                "INSERT INTO pokemon_eggs
                        (id, user_id, species_id, father_id, mother_id, father_species_id,
                         mother_species_id, shiny_parents, status, messages, hatch_messages, laid_at,
                         hatch_at, hatched_at, pokemon_id)
                 SELECT id, CAST(user_id AS INTEGER), species_id, father_id, mother_id,
                        father_species_id, mother_species_id, COALESCE(shiny_parents, 0), status,
                        COALESCE(messages, 0), hatch_messages, laid_at, hatch_at, hatched_at, pokemon_id
                   FROM v1.pokemon_eggs WHERE {}",
                is_id("user_id")
            ),
            BAD_MEMBER,
        )
        .await
}

async fn convert_trades(
    conn: &mut SqliteConnection,
    report: &mut Report,
) -> Result<(), MigrateError> {
    // « Pas de Pokémon » s'écrivait espèce 0, « offre ouverte » destinataire '' : NULL dans les deux
    // cas. Un objet sans quantité en valait un, comme le choix qui l'avait créé. Une contre-offre dont
    // l'original est écarté perd ce lien plutôt que de rompre la clé étrangère.
    report
        .copy(
            conn,
            "pokemon_trades",
            "v1.pokemon_trades",
            &format!(
                "INSERT INTO pokemon_trades
                        (id, from_user_id, to_user_id, open_offer,
                         offer_pokemon_id, offer_species_id, offer_is_shiny, offer_sex, offer_form,
                         offer_fertile, offer_points, offer_item, offer_item_qty,
                         request_open, request_pokemon_id, request_species_id, request_is_shiny,
                         request_sex, request_form, request_fertile, request_points, request_item,
                         request_item_qty, status, counter_of, created_at, expires_at, resolved_at)
                 SELECT id, CAST(from_user_id AS INTEGER), {to}, {open},
                        offer_pokemon_id, NULLIF(offer_species_id, 0), {os}, NULLIF(offer_sex, ''),
                        NULLIF(offer_form, ''), offer_fertile, offer_points, NULLIF(offer_item, ''),
                        CASE WHEN NULLIF(offer_item, '') IS NOT NULL THEN COALESCE(offer_item_qty, 1) END,
                        {ro}, request_pokemon_id, NULLIF(request_species_id, 0), {rs},
                        NULLIF(request_sex, ''), NULLIF(request_form, ''), request_fertile,
                        request_points, NULLIF(request_item, ''),
                        CASE WHEN NULLIF(request_item, '') IS NOT NULL
                             THEN COALESCE(request_item_qty, 1) END,
                        status,
                        CASE WHEN counter_of IN (SELECT t.id FROM v1.pokemon_trades AS t WHERE {from_t})
                             THEN counter_of END,
                        created_at, expires_at, resolved_at
                   FROM v1.pokemon_trades WHERE {from}",
                to = opt_id("to_user_id"),
                open = flag("open_offer"),
                os = flag("offer_is_shiny"),
                ro = flag("request_open"),
                rs = flag("request_is_shiny"),
                from = is_id("from_user_id"),
                from_t = is_id("t.from_user_id"),
            ),
            BAD_MEMBER,
        )
        .await?;

    // Un brouillon ne vit que quelques minutes ; on le reprend tel quel, choix compris (JSON).
    report
        .copy(
            conn,
            "pokemon_trade_drafts",
            "v1.pokemon_trade_drafts",
            &format!(
                "INSERT INTO pokemon_trade_drafts
                        (id, from_user_id, to_user_id, channel_id, offer, request, counter_of,
                         created_at, expires_at)
                 SELECT id, CAST(from_user_id AS INTEGER), {}, {}, offer, request,
                        CASE WHEN counter_of IN (SELECT id FROM pokemon_trades) THEN counter_of END,
                        created_at, expires_at
                   FROM v1.pokemon_trade_drafts
                  WHERE {} AND (offer IS NULL OR json_valid(offer))
                    AND (request IS NULL OR json_valid(request))",
                opt_id("to_user_id"),
                opt_id("channel_id"),
                is_id("from_user_id")
            ),
            "identifiant invalide ou choix illisible",
        )
        .await
}

/// Ce qui doit se retrouver à l'identique de part et d'autre.
pub(super) async fn check(
    conn: &mut SqliteConnection,
    report: &mut Report,
) -> Result<(), MigrateError> {
    for (name, v1, v2) in [
        (
            "Pokémon possédés",
            "SELECT count(*) FROM v1.pokemon_owned",
            "SELECT count(*) FROM pokemon_owned",
        ),
        (
            "Pokémon shiny possédés",
            "SELECT count(*) FROM v1.pokemon_owned WHERE is_shiny <> 0",
            "SELECT count(*) FROM pokemon_owned WHERE is_shiny = 1",
        ),
        (
            "objets dans les sacs",
            "SELECT sum(count) FROM v1.pokemon_inventory WHERE count > 0",
            "SELECT sum(count) FROM pokemon_inventory",
        ),
        (
            "balls spéciales en stock",
            "SELECT count(*) FROM v1.pokemon_ball_units",
            "SELECT count(*) FROM pokemon_ball_units",
        ),
        (
            "œufs en couvaison",
            "SELECT count(*) FROM v1.pokemon_eggs WHERE status = 'INCUBATING'",
            "SELECT count(*) FROM pokemon_eggs WHERE status = 'INCUBATING'",
        ),
        (
            "échanges en attente",
            "SELECT count(*) FROM v1.pokemon_trades WHERE status = 'PENDING'",
            "SELECT count(*) FROM pokemon_trades WHERE status = 'PENDING'",
        ),
    ] {
        report.check_equal(conn, name, v1, v2).await?;
    }
    Ok(())
}
