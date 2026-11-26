//! Conversion des objets : sacs et leur journal, balls spéciales, boutique, loterie.

use sqlx::SqliteConnection;

use super::{MigrateError, Report, flag, is_id};

const BAD_MEMBER: &str = "identifiant de membre invalide";

pub(super) async fn convert(
    conn: &mut SqliteConnection,
    report: &mut Report,
) -> Result<(), MigrateError> {
    // Les lignes à 0 restent : elles gardent depuis quand le dresseur connaît l'objet.
    report
        .copy(
            conn,
            "pokemon_inventory",
            "v1.pokemon_inventory",
            &format!(
                "INSERT INTO pokemon_inventory
                        (user_id, item_key, count, first_obtained_at, last_obtained_at)
                 SELECT CAST(user_id AS INTEGER), item_key, MAX(COALESCE(count, 0), 0),
                        first_obtained_at, last_obtained_at
                   FROM v1.pokemon_inventory WHERE {}",
                is_id("user_id")
            ),
            BAD_MEMBER,
        )
        .await?;
    report
        .fixed(
            conn,
            "SELECT count(*) FROM v1.pokemon_inventory WHERE count < 0",
            "compteur(s) d'objet négatif(s) ramené(s) à 0",
        )
        .await?;

    report
        .copy(
            conn,
            "pokemon_item_log",
            "v1.pokemon_item_log",
            &format!(
                "INSERT INTO pokemon_item_log (id, user_id, item_key, delta, source, created_at)
                 SELECT id, CAST(user_id AS INTEGER), item_key, delta, source, created_at
                   FROM v1.pokemon_item_log WHERE {} AND delta <> 0",
                is_id("user_id")
            ),
            "identifiant invalide ou mouvement nul",
        )
        .await?;

    report
        .copy(
            conn,
            "pokemon_ball_units",
            "v1.pokemon_ball_units",
            &format!(
                "INSERT INTO pokemon_ball_units (id, user_id, ball, bought_at)
                 SELECT id, CAST(user_id AS INTEGER), ball, bought_at
                   FROM v1.pokemon_ball_units WHERE {}",
                is_id("user_id")
            ),
            BAD_MEMBER,
        )
        .await?;

    convert_shop(conn, report).await
}

async fn convert_shop(
    conn: &mut SqliteConnection,
    report: &mut Report,
) -> Result<(), MigrateError> {
    report
        .copy(
            conn,
            "pokemon_shop_daily",
            "v1.pokemon_shop_daily",
            &format!(
                "INSERT INTO pokemon_shop_daily (user_id, ball, day, bought)
                 SELECT CAST(user_id AS INTEGER), ball, day, MAX(COALESCE(bought, 0), 0)
                   FROM v1.pokemon_shop_daily WHERE {}",
                is_id("user_id")
            ),
            BAD_MEMBER,
        )
        .await?;

    report
        .copy(
            conn,
            "pokemon_shop_purchases",
            "v1.pokemon_shop_purchases",
            &format!(
                "INSERT INTO pokemon_shop_purchases (id, user_id, ball, quantity, cost, bought_at)
                 SELECT id, CAST(user_id AS INTEGER), ball, quantity, cost, bought_at
                   FROM v1.pokemon_shop_purchases WHERE {} AND quantity > 0",
                is_id("user_id")
            ),
            "identifiant invalide ou quantité nulle",
        )
        .await?;

    convert_lottery(conn, report).await
}

async fn convert_lottery(
    conn: &mut SqliteConnection,
    report: &mut Report,
) -> Result<(), MigrateError> {
    // `last_day = ''` voulait dire « jamais joué ». Des victoires au-delà des tirages (un tirage
    // rendu après coup) sont ramenées au nombre de tirages, que la v2 exige.
    report
        .copy(
            conn,
            "pokemon_lottery",
            "v1.pokemon_lottery",
            &format!(
                "INSERT INTO pokemon_lottery (user_id, last_day, last_draw_at, draws, wins)
                 SELECT CAST(user_id AS INTEGER), NULLIF(last_day, ''), COALESCE(last_draw_at, 0),
                        MAX(COALESCE(draws, 0), 0),
                        MIN(MAX(COALESCE(wins, 0), 0), MAX(COALESCE(draws, 0), 0))
                   FROM v1.pokemon_lottery WHERE {}",
                is_id("user_id")
            ),
            BAD_MEMBER,
        )
        .await?;
    report
        .fixed(
            conn,
            "SELECT count(*) FROM v1.pokemon_lottery WHERE wins > draws",
            "dresseur(s) avec plus de victoires que de tirages : ramenées aux tirages",
        )
        .await?;

    report
        .copy(
            conn,
            "pokemon_lottery_draws",
            "v1.pokemon_lottery_draws",
            &format!(
                "INSERT INTO pokemon_lottery_draws (id, user_id, won, drawn_at)
                 SELECT id, CAST(user_id AS INTEGER), {}, drawn_at
                   FROM v1.pokemon_lottery_draws WHERE {}",
                flag("won"),
                is_id("user_id")
            ),
            BAD_MEMBER,
        )
        .await
}
