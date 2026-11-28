//! Un lancer dans les statistiques de l'année : les lancers et les points de chacun (brûlés sur les
//! seuls ratés), l'usage des balls, et la chance (captures « attendues »). Écrit après le commit : une
//! statistique qui échoue ne défait jamais un lancer.

use jiff::Timestamp;
use pcr_core::clock::paris_date;

use crate::{
    App,
    stats::{BallColumn, Counter, DailyColumn, SpeciesColumn, UserColumn},
};

/// Ce qu'un lancer laisse aux statistiques.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) struct Throw {
    pub user: i64,
    pub species: i64,
    pub ball: &'static str,
    /// Les points pris (zéro pour une ball offerte) : ce qui garde honnête le compte des points brûlés.
    pub cost: i64,
    pub probability: f64,
    pub caught: bool,
}

pub(super) async fn record_throw(app: &App, now: Timestamp, throw: &Throw) {
    let burned = if throw.caught { 0 } else { throw.cost };
    let add = |counter, delta| app.stats.add(now, counter, delta);
    let user = |column| Counter::PokemonUser {
        user: throw.user,
        column,
    };
    add(user(UserColumn::Throws), 1);
    add(user(UserColumn::PointsSpent), throw.cost);
    add(user(UserColumn::PointsBurned), burned);
    let ball = |column| Counter::PokemonBall {
        user: throw.user,
        ball: throw.ball.to_owned(),
        column,
    };
    add(ball(BallColumn::Count), 1);
    add(ball(BallColumn::Cost), throw.cost);
    let species = |column| Counter::PokemonSpecies {
        species: throw.species,
        column,
    };
    add(species(SpeciesColumn::ThrowsReceived), 1);
    add(species(SpeciesColumn::PointsBurned), burned);
    let day = paris_date(now).to_string();
    add(
        Counter::PokemonDaily {
            day: day.clone(),
            column: DailyColumn::Throws,
        },
        1,
    );
    add(
        Counter::PokemonDaily {
            day,
            column: DailyColumn::PointsBurned,
        },
        burned,
    );
    // La somme des probabilités de ses lancers : comparée à ses captures, sa chance sur l'année.
    if let Err(error) = app
        .stats
        .expected_catch(now, throw.user, throw.probability)
        .await
    {
        tracing::warn!(?error, "recording expected catches failed");
    }
}
