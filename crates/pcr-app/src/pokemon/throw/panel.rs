//! Ce que lisent les panneaux de lancer : les balls en poche, le menu des balls spéciales et le prix
//! de la Master Ball. Une lecture ratée tait ce qu'elle devait dire (ni « offerte » ni prix) plutôt
//! que de promettre une ball qu'on n'a peut-être pas.

use pcr_core::{
    config::{Ball, GameConfig},
    pokemon::{capture, items as catalogue, throw as rules},
};
use pcr_db::{
    Conn, DbError, points,
    pokemon::{items, spawn as spawns, throws, units},
};

use crate::App;

/// Une ball ordinaire du panneau.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PanelBall {
    pub key: &'static str,
    pub label: String,
    pub emoji: String,
    /// Le prix affiché ; `None` : personnel (la Master Ball, que sa confirmation donne) ou illisible.
    pub price: Option<i64>,
    /// Combien en poche ; `None` : sac illisible.
    pub held: Option<i64>,
}

/// Les balls ordinaires du panneau, avec ce que le dresseur en a en poche (la Master Ball n'y est
/// pas : elle passe par sa confirmation, dans le menu des balls spéciales).
pub async fn panel(app: &App, user: i64) -> Vec<PanelBall> {
    let config = app.game_config();
    let inventory = match app.db.reader().acquire().await {
        Ok(mut conn) => items::inventory(&mut conn, user).await.ok(),
        Err(_) => None,
    };
    config
        .pokemon
        .capture
        .balls
        .entries()
        .into_iter()
        .filter(|(_, ball)| ball.guaranteed != Some(true))
        .map(|(key, ball)| PanelBall {
            key,
            label: ball.label.clone(),
            emoji: ball.emoji.clone(),
            price: (inventory.is_some() && !capture::has_personal_price(ball))
                .then(|| i64::from(ball.price)),
            held: inventory.as_ref().map(|rows| in_pocket(&config, rows, key)),
        })
        .collect()
}

/// Combien de lancers de `ball` le dresseur a en poche : ceux de l'objet que le lancer consommera.
fn in_pocket(config: &GameConfig, rows: &[(String, i64)], ball: &str) -> i64 {
    catalogue::ball_item(&config.pokemon, ball)
        .and_then(|item| {
            rows.iter()
                .find_map(|(key, count)| (key == item.key).then_some(*count))
        })
        .unwrap_or(0)
}

/// Une ball de la boutique utilisable contre cette apparition.
#[derive(Debug, Clone, PartialEq)]
pub struct SpecialChoice {
    pub key: &'static str,
    pub label: String,
    pub emoji: String,
    /// Achetées avant l'apparition.
    pub usable: i64,
    /// Sa chance contre ce Pokémon, bonus compris.
    pub probability: f64,
}

/// Le menu des balls spéciales : la Master Ball, puis les balls de la boutique qui servent ici.
#[derive(Debug, Clone, PartialEq)]
pub struct SpecialMenu {
    /// La Master Ball (absente de la config : rien).
    pub master: Option<PanelBall>,
    pub choices: Vec<SpecialChoice>,
    /// Une lecture a échoué : les boutons sont grisés et les chances tues.
    pub failed: bool,
}

pub async fn special_menu(app: &App, user: i64, spawn: i64) -> SpecialMenu {
    let config = app.game_config();
    let generation = super::super::generation(app);
    let master = config
        .pokemon
        .capture
        .balls
        .entries()
        .into_iter()
        .find(|(_, ball)| ball.guaranteed == Some(true));
    let read = async {
        let mut conn = app.db.reader().acquire().await?;
        let spawn = spawns::get(&mut conn, spawn).await?;
        let inventory = items::inventory(&mut conn, user).await?;
        let spawned_at = spawn.as_ref().map_or(0, |spawn| spawn.spawned_at);
        let units = units::counts(&mut conn, user, spawned_at).await?;
        let price = match master {
            Some((key, ball)) => Some(personal_price(&mut conn, user, key, ball).await?),
            None => None,
        };
        Ok::<_, DbError>((spawn, inventory, units, price))
    };
    let (spawn, inventory, units, price) = match read.await {
        Ok(read) => read,
        Err(error) => {
            tracing::warn!(?error, "reading the special balls failed");
            return SpecialMenu {
                master: master.map(|(key, ball)| PanelBall {
                    key,
                    label: ball.label.clone(),
                    emoji: ball.emoji.clone(),
                    price: None,
                    held: None,
                }),
                choices: Vec::new(),
                failed: true,
            };
        }
    };
    let choices = rules::open_specials(&config.pokemon, generation)
        .filter_map(|(key, ball)| {
            let usable = units
                .iter()
                .find_map(|row| (row.ball == key).then_some(row.eligible))?;
            let spawn = spawn.as_ref()?;
            let thrown = rules::ball(&config.pokemon, generation, key)?;
            (usable > 0).then(|| SpecialChoice {
                key,
                label: ball.label.clone(),
                emoji: ball.emoji.clone(),
                usable,
                probability: thrown.probability(
                    &config.pokemon,
                    u32::try_from(spawn.catch_rate).unwrap_or_default(),
                    spawn.fished,
                    u16::try_from(spawn.species_id).unwrap_or_default(),
                ),
            })
        })
        .collect();
    SpecialMenu {
        master: master.map(|(key, ball)| PanelBall {
            key,
            label: ball.label.clone(),
            emoji: ball.emoji.clone(),
            price,
            held: Some(in_pocket(&config, &inventory, key)),
        }),
        choices,
        failed: false,
    }
}

/// Le prix de la prochaine ball payée en points par ce dresseur : il monte à chaque achat pour une
/// ball au prix personnel, et se lit dans le journal des lancers.
async fn personal_price(
    conn: &mut Conn,
    user: i64,
    key: &str,
    ball: &Ball,
) -> Result<i64, DbError> {
    if !capture::has_personal_price(ball) {
        return Ok(i64::from(ball.price));
    }
    let bought = throws::paid(conn, user, key).await?;
    Ok(capture::price_after(
        ball,
        u32::try_from(bought).unwrap_or(u32::MAX),
    ))
}

/// Ce que la confirmation de la Master Ball dit à son dresseur : c'est ici qu'il apprend son prix.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MasterQuote {
    pub label: String,
    pub emoji: String,
    /// En poche : elle part avant les points.
    pub held: i64,
    pub price: i64,
    pub balance: i64,
}

/// `None` : pas de ball garantie dans la config.
pub async fn master_quote(app: &App, user: i64) -> Result<Option<MasterQuote>, DbError> {
    let config = app.game_config();
    let Some((key, ball)) = config
        .pokemon
        .capture
        .balls
        .entries()
        .into_iter()
        .find(|(_, ball)| ball.guaranteed == Some(true))
    else {
        return Ok(None);
    };
    let mut conn = app.db.reader().acquire().await?;
    let inventory = items::inventory(&mut conn, user).await?;
    let held = in_pocket(&config, &inventory, key);
    // Le solde et le prix ne servent qu'à qui va payer.
    let (price, balance) = if held > 0 {
        (0, 0)
    } else {
        (
            personal_price(&mut conn, user, key, ball).await?,
            points::balance_in(&mut conn, user).await?,
        )
    };
    Ok(Some(MasterQuote {
        label: ball.label.clone(),
        emoji: ball.emoji.clone(),
        held,
        price,
        balance,
    }))
}
