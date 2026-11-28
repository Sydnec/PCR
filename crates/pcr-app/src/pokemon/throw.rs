//! Le lancer d'une ball : Discord et le site lancent par ici, avec le même délai, le même prix et la
//! même course.
//!
//! Tout tient dans une transaction de l'écrivain unique : relire l'apparition, payer (une ball en
//! poche d'abord, les points ensuite), tirer, conclure (raté ou capture), faire naître l'individu,
//! donner un Charme Chroma mérité et revendiquer l'apparition suivante. Deux lancers sur le même
//! Pokémon passent l'un après l'autre : le second voit le premier, et un Pokémon parti ne coûte rien.
//! Plus de paiement à rembourser, donc, quand on est battu de peu (la v1 remboursait, VOID).

use jiff::Timestamp;
use pcr_core::{
    config::GameConfig,
    pokemon::{
        display, items as catalogue, locked_by_default,
        spawn::Cause,
        species::{self, Sex, Species},
        throw::{self as rules, Outcome, Paid, Promise, ThrowBall},
    },
};
use pcr_db::{
    Conn, DbError,
    pokemon::{
        collection::{self, NewOwned},
        spawn as spawns,
        spawn::{Spawn, Spent, Status},
        throws::{self, NewThrow},
    },
    public_messages,
};
use rand::{Rng, RngExt as _};

use super::{
    charms,
    spawn::{self, Claimed, MESSAGE, stats::Winner},
};
use crate::App;

mod held;
mod panel;
mod pay;
mod stats;

pub use panel::{
    MasterQuote, PanelBall, SpecialChoice, SpecialMenu, master_quote, panel, special_menu,
};

/// Un lancer demandé.
#[derive(Debug, Clone, Copy)]
pub struct Request<'a> {
    pub user: i64,
    pub spawn: i64,
    pub ball: &'a str,
    /// Ce que la confirmation de la Master Ball a promis (ou rien).
    pub promise: Promise,
}

/// Ce qu'a donné un lancer.
#[derive(Debug, Clone, PartialEq)]
pub struct Thrown {
    pub outcome: Outcome,
    /// La ball lancée vient de la boutique : le panneau reste sur leur menu.
    pub special: bool,
    /// Les générations dont le dresseur vient de recevoir le Charme Chroma, à annoncer.
    pub charms: Vec<u8>,
}

/// Ce qu'une transaction de lancer laisse aux statistiques et aux suites.
#[derive(Debug, Default)]
struct Resolved {
    throw: Option<stats::Throw>,
    end: Option<(Spawn, Vec<Spent>, Winner)>,
    claimed: Option<Claimed>,
    charms: Vec<u8>,
}

fn refused(outcome: Outcome, special: bool) -> Thrown {
    Thrown {
        outcome,
        special,
        charms: Vec::new(),
    }
}

/// Lance une ball. Une ball inconnue est refusée avant tout ; le délai entre deux lancers est
/// consommé ensuite, même si le lancer échoue (comme en v1). En service, `rng` vient de
/// `App::rng()`.
pub async fn throw(
    app: &App,
    request: &Request<'_>,
    rng: &mut (impl Rng + Send),
) -> Result<Thrown, DbError> {
    let config = app.game_config();
    let generation = super::generation(app);
    let Some(ball) = rules::ball(&config.pokemon, generation, request.ball) else {
        return Ok(refused(Outcome::UnknownBall, false));
    };
    let special = ball.is_special();
    let now = app.clock.now();
    if let Some(remaining) = cooldown(app, &config, request.user, now.as_millisecond()) {
        return Ok(refused(Outcome::Cooldown { remaining }, special));
    }
    let mut tx = app.db.writer().begin().await.map_err(DbError::from)?;
    let mut resolved = Resolved::default();
    let outcome = resolve(
        &mut tx,
        &config,
        generation,
        &ball,
        request,
        now,
        rng,
        &mut resolved,
        app,
    )
    .await?;
    // Seul un lancer joué (raté ou capture) s'écrit : un refus venu après le paiement (le dernier
    // rempart du statut) ne doit rien avoir pris.
    if resolved.throw.is_some() {
        tx.commit().await.map_err(DbError::from)?;
    } else {
        tx.rollback().await.map_err(DbError::from)?;
    }
    after_commit(app, now, resolved, outcome, special).await
}

/// Le délai entre deux lancers d'un même dresseur : `Some(secondes)` s'il doit encore attendre,
/// sinon le lancer est noté (avant la transaction, comme en v1 : une panne de base le consomme aussi).
/// Une entrée par dresseur, jamais purgée : la table est bornée par l'effectif du serveur.
fn cooldown(app: &App, config: &GameConfig, user: i64, now_ms: i64) -> Option<u64> {
    let mut last = app
        .last_throws
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let seconds = config.pokemon.capture.throw_cooldown_seconds;
    let remaining = rules::cooldown_remaining(last.get(&user).copied(), now_ms, seconds);
    if remaining.is_none() {
        last.insert(user, now_ms);
    }
    remaining
}

#[allow(clippy::too_many_arguments)] // L'état d'un lancer, passé tel quel à sa transaction.
async fn resolve(
    conn: &mut Conn,
    config: &GameConfig,
    generation: u8,
    ball: &ThrowBall<'_>,
    request: &Request<'_>,
    now: Timestamp,
    rng: &mut (impl Rng + ?Sized),
    resolved: &mut Resolved,
    app: &App,
) -> Result<Outcome, DbError> {
    let now_ms = now.as_millisecond();
    // Un Pokémon déjà parti ne coûte rien. Une touche de pêche n'est ouverte qu'à son pêcheur, et
    // jusqu'à sa fuite seulement.
    let Some(spawn) = spawns::get(conn, request.spawn).await? else {
        return Ok(Outcome::Gone);
    };
    match spawn.status {
        Status::Active => {}
        Status::Fishing if spawn.reserved_for != Some(request.user) => {
            return Ok(Outcome::NotYours);
        }
        Status::Fishing if spawn.flees_at.is_none_or(|at| at > now_ms) => {}
        _ => return Ok(Outcome::Gone),
    }
    let Some(species) = u16::try_from(spawn.species_id).ok().and_then(species::get) else {
        return Ok(Outcome::UnknownSpecies);
    };
    let catch_rate = u32::try_from(spawn.catch_rate).unwrap_or_default();
    let probability = ball.probability(&config.pokemon, catch_rate, spawn.fished, species.id);
    let paid = match pay::pay(conn, config, ball, request, &spawn, now_ms).await? {
        Ok(paid) => paid,
        Err(refusal) => return Ok(refusal),
    };
    let success = ball.guaranteed() || rng.random::<f64>() < probability;
    let throw = stats::Throw {
        user: request.user,
        species: spawn.species_id,
        ball: ball.key,
        cost: paid.points(),
        probability,
        caught: success,
    };
    let record = NewThrow {
        spawn: spawn.id,
        user: request.user,
        ball: ball.key,
        cost: paid.points(),
        probability,
        result: if success {
            throws::Result::Catch
        } else {
            throws::Result::Miss
        },
        thrown_at: now_ms,
    };
    // Gardées sur le statut, ces écritures ne peuvent échouer ici (la transaction vient de relire
    // l'apparition) : elles restent le dernier rempart contre deux vainqueurs.
    if !success {
        if !throws::miss(conn, spawn.id, now_ms).await? {
            return Ok(Outcome::Gone);
        }
        throws::record(conn, &record).await?;
        public_messages::touch(conn, MESSAGE, spawn.id, now_ms).await?;
        resolved.throw = Some(throw);
        let sex = spawn.sex.as_deref().and_then(Sex::from_code);
        return Ok(Outcome::Miss {
            ball: ball.label.to_owned(),
            paid,
            name: display::display_name(species, spawn.is_shiny, sex, spawn.form.as_deref()),
            probability,
        });
    }
    if !throws::catch(conn, spawn.id, request.user, ball.key, now_ms).await? {
        return Ok(Outcome::Gone);
    }
    throws::record(conn, &record).await?;
    resolved.throw = Some(throw);
    let outcome = capture(
        conn,
        app,
        config,
        generation,
        ball,
        request,
        &spawn,
        species,
        probability,
        paid,
        now,
        rng,
        resolved,
    )
    .await?;
    Ok(outcome)
}

/// La capture conclue : le shiny du Charme Chroma, l'individu dans la boîte (la ball, le sexe et la
/// forme que l'annonce montrait, verrouillé d'office s'il le faut), le charme mérité, et l'apparition
/// suivante (le salon ne reste pas vide ; une pêche ne l'a jamais occupé).
#[allow(clippy::too_many_arguments)] // La capture reprend l'état entier du lancer.
async fn capture(
    conn: &mut Conn,
    app: &App,
    config: &GameConfig,
    generation: u8,
    ball: &ThrowBall<'_>,
    request: &Request<'_>,
    spawn: &Spawn,
    species: &'static Species,
    probability: f64,
    paid: Paid,
    now: Timestamp,
    rng: &mut (impl Rng + ?Sized),
    resolved: &mut Resolved,
) -> Result<Outcome, DbError> {
    let now_ms = now.as_millisecond();
    let user = request.user;
    // Il brille pour son vainqueur s'il brillait pour tout le salon, ou pour les seuls porteurs du
    // charme de sa génération et que le vainqueur en est un.
    let charmed = !spawn.is_shiny
        && spawn.charm_shiny
        && charms::held(conn, config, user)
            .await?
            .contains(&species.generation);
    if charmed {
        throws::shine(conn, spawn.id).await?;
    }
    let shiny = spawn.is_shiny || charmed;
    collection::insert(
        conn,
        &NewOwned {
            user,
            species: spawn.species_id,
            shiny,
            sex: spawn.sex.as_deref(),
            form: spawn.form.as_deref(),
            ball: Some(ball.key),
            origin: "capture",
            locked: locked_by_default(&config.pokemon, species, shiny),
            obtained_at: now_ms,
        },
    )
    .await?;
    let held = held::hand_over(conn, app, config, spawn, user, now_ms, rng).await?;
    public_messages::touch(conn, MESSAGE, spawn.id, now_ms).await?;
    resolved.charms = charms::check(conn, config, generation, user, now_ms).await?;
    let spent = spawns::spending(conn, spawn.id).await?;
    resolved.end = Some((
        Spawn {
            is_shiny: shiny,
            ..spawn.clone()
        },
        spent,
        Winner {
            user,
            ball_label: ball.label.to_owned(),
            probability,
            shiny,
        },
    ));
    if !spawn.fished
        && config.pokemon.enabled
        && let Some(channel) = spawn::channel(app)
    {
        resolved.claimed = spawn::claim(
            conn,
            config,
            generation,
            Cause::Capture,
            spawn::Options::default(),
            channel,
            now_ms,
            rng,
        )
        .await?;
    }
    let sex = spawn.sex.as_deref().and_then(Sex::from_code);
    let charm = charmed
        .then(|| catalogue::charm_item(&config.pokemon, species.generation))
        .flatten()
        .map(|charm| (charm.emoji.to_owned(), charm.label.to_owned()));
    tracing::info!(
        user,
        spawn = spawn.id,
        species = species.name,
        shiny,
        charmed,
        ball = ball.key,
        "pokemon caught"
    );
    Ok(Outcome::Catch {
        paid,
        name: display::display_name(species, shiny, sex, spawn.form.as_deref()),
        charm,
        held,
    })
}

/// Après le commit : statistiques, réécriture des messages, et l'apparition suivante.
async fn after_commit(
    app: &App,
    now: Timestamp,
    resolved: Resolved,
    outcome: Outcome,
    special: bool,
) -> Result<Thrown, DbError> {
    if let Some(throw) = &resolved.throw {
        stats::record_throw(app, now, throw).await;
        app.public_messages_changed();
    }
    if let Some((spawn, spent, winner)) = &resolved.end {
        spawn::stats::record_end(app, now, spawn, spent, Some(winner)).await;
    }
    if let Some(claimed) = resolved.claimed {
        spawn::after_commit(app, now, claimed).await;
    }
    Ok(Thrown {
        outcome,
        special,
        charms: resolved.charms,
    })
}

#[cfg(test)]
mod tests;
