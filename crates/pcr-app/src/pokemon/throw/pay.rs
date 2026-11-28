//! Le paiement d'un lancer, dans sa transaction : une ball de la boutique se prend dans la poche, une
//! ball ordinaire en poche part avant les points, sinon le prix (personnel pour la Master Ball).

use pcr_core::{
    config::GameConfig,
    pokemon::{
        capture, items as catalogue,
        throw::{Kind, Outcome, Paid, Promise, ThrowBall},
    },
};
use pcr_db::{
    Conn, DbError,
    points::{self, Overdraft, Source},
    pokemon::{items, spawn::Spawn, throws, units},
};

use super::Request;

/// Le paiement : une ball de la boutique se prend dans la poche (achetée avant l'apparition) ; une
/// ball ordinaire en poche part avant les points, et deux clics simultanés n'en dépensent qu'une ;
/// sinon le prix, personnel pour la Master Ball. `Err` : le refus, rien n'a été pris.
pub(super) async fn pay(
    conn: &mut Conn,
    config: &GameConfig,
    ball: &ThrowBall<'_>,
    request: &Request<'_>,
    spawn: &Spawn,
    now_ms: i64,
) -> Result<Result<Paid, Outcome>, DbError> {
    let user = request.user;
    let label = ball.label.to_owned();
    let Kind::Capture(capture_ball) = ball.kind else {
        if units::take(conn, user, ball.key, spawn.spawned_at).await? {
            return Ok(Ok(Paid::Used { label }));
        }
        let held = units::counts(conn, user, spawn.spawned_at)
            .await?
            .into_iter()
            .find_map(|units| (units.ball == ball.key).then_some(units.held))
            .unwrap_or(0);
        return Ok(Err(Outcome::NoUnit { ball: label, held }));
    };
    if let Some(item) = catalogue::ball_item(&config.pokemon, ball.key)
        && items::consume(conn, user, item.key, 1, "lancer", now_ms).await?
    {
        return Ok(Ok(Paid::Offered {
            label: item.label.to_owned(),
        }));
    }
    // Promise offerte, la ball a disparu (un second panneau ouvert ailleurs) : la payer en points en
    // silence serait le mésclic que la confirmation existe pour empêcher.
    if request.promise == Promise::Offered {
        return Ok(Err(Outcome::NoItem { ball: label }));
    }
    let price = if capture::has_personal_price(capture_ball) {
        let bought = throws::paid(conn, user, ball.key).await?;
        capture::price_after(capture_ball, u32::try_from(bought).unwrap_or(u32::MAX))
    } else {
        i64::from(capture_ball.price)
    };
    if let Promise::Price(announced) = request.promise
        && announced != price
    {
        return Ok(Err(Outcome::PriceChanged { ball: label, price }));
    }
    match points::move_balance(
        conn,
        user,
        -price,
        Overdraft::Refused,
        Source::Throw,
        now_ms,
    )
    .await?
    {
        Some(_) => Ok(Ok(Paid::Points(price))),
        None => Ok(Err(Outcome::Insufficient {
            ball: label,
            price,
            balance: points::balance_in(conn, user).await?,
        })),
    }
}
