//! Les apparitions du salon : la revendication au fil des messages (et après une capture), le spawn
//! forcé de `/admin pokespawn`, la fuite (balayage chaque minute) et ce que le message public d'une
//! apparition montre (`view`).
//!
//! Une revendication tient dans une transaction : relire le salon, décider (`pcr_core`), faire fuir
//! le Pokémon en place, insérer le suivant et déclarer son message. L'écrivain unique de SQLite les
//! fait passer l'une après l'autre : dix messages simultanés ne font apparaître qu'un Pokémon, sans
//! verrou en mémoire (le drapeau `spawning` de la v1 n'a plus lieu d'être). Le message part après le
//! commit, par le worker des messages publics.

use std::time::Duration;

use jiff::Timestamp;
use pcr_core::{
    config::GameConfig,
    pokemon::{
        drop,
        rarity::Rarity,
        spawn::{self as rules, Cause, Channel, Encounter, Forced},
        species::{self, Sex, Species},
        weights::Draw,
    },
};
use pcr_db::{
    Conn, DbError,
    pokemon::spawn::{self as spawns, NewSpawn, Spawn, Spent},
    public_messages,
};
use rand::{Rng, RngExt as _};
use tokio::sync::watch;

use super::drops;
use crate::{App, error::UseCaseError};

pub(crate) mod stats;
mod view;

pub use pcr_db::pokemon::spawn::{Spawn as Row, Status, Throw};
pub use view::{Participant, Spending, View, view};

/// Le type de message public d'une apparition.
pub const MESSAGE: &str = "spawn";
/// Cadence du balayage des fuites, comme en v1 : indépendant de l'activité du serveur, sans quoi un
/// salon silencieux ne délogerait jamais un Pokémon que personne n'attrape.
const TICK: Duration = Duration::from_mins(1);

/// Une apparition née.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Born {
    pub id: i64,
    pub encounter: Encounter,
}

/// Une apparition enfuie, et ce que ses lancers ont coûté (pour les statistiques).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Fled {
    pub spawn: Spawn,
    pub spent: Vec<Spent>,
}

/// Une revendication aboutie : le nouveau venu, et celui qu'il a chassé.
#[derive(Debug)]
pub(crate) struct Claimed {
    pub born: Born,
    pub replaced: Option<Fled>,
}

/// Ce qu'un administrateur précise pour une apparition (`/admin pokespawn`).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Request {
    /// L'espèce (son numéro) ; aléatoire sans elle.
    pub species: Option<u16>,
    pub shiny: Option<bool>,
    /// Un texte en tête de l'annonce (« 🎃 Événement d'Halloween ! »).
    pub announcement: Option<String>,
    /// Forcer ou supprimer la mention du rôle Pokémon.
    pub ping: Option<bool>,
}

/// Ce que la revendication ajoute au tirage.
#[derive(Debug, Clone, Copy, Default)]
pub(crate) struct Options<'a> {
    pub forced: Forced,
    pub announcement: Option<&'a str>,
    pub ping: Option<bool>,
}

/// Un message d'un membre sur le serveur : il compte pour la prochaine apparition, et peut la faire
/// naître. Rien ne compte quand le jeu est coupé ou que le salon n'est pas configuré.
pub async fn on_message(app: &App) -> Result<Option<Born>, DbError> {
    let config = app.game_config();
    let Some(channel) = channel(app).filter(|_| config.pokemon.enabled) else {
        return Ok(None);
    };
    let now = app.clock.now();
    let mut rng = App::rng();
    let mut tx = app.db.writer().begin().await.map_err(DbError::from)?;
    spawns::count_message(&mut tx).await?;
    let claimed = claim(
        &mut tx,
        &config,
        super::generation(app),
        Cause::Message,
        Options::default(),
        channel,
        now.as_millisecond(),
        &mut rng,
    )
    .await?;
    tx.commit().await.map_err(DbError::from)?;
    Ok(match claimed {
        Some(claimed) => Some(after_commit(app, now, claimed).await),
        None => None,
    })
}

/// `/admin pokespawn` : une apparition tout de suite, pause du parc comprise. Le compteur et
/// l'horloge repartent de zéro, sinon une apparition naturelle pourrait tomber juste après et faire
/// fuir le Pokémon annoncé. Le jeu coupé n'empêche pas un événement.
pub async fn force(app: &App, request: &Request) -> Result<Born, UseCaseError> {
    let channel = channel(app).ok_or_else(|| UseCaseError::refused(rules::NO_CHANNEL))?;
    let config = app.game_config();
    let generation = super::generation(app);
    let species = match request.species {
        None => None,
        Some(id) => Some(available(id, generation)?),
    };
    let now = app.clock.now();
    let mut rng = App::rng();
    let options = Options {
        forced: Forced {
            species,
            shiny: request.shiny,
        },
        announcement: request.announcement.as_deref(),
        ping: request.ping,
    };
    let mut tx = app.db.writer().begin().await.map_err(DbError::from)?;
    let claimed = claim(
        &mut tx,
        &config,
        generation,
        Cause::Forced,
        options,
        channel,
        now.as_millisecond(),
        &mut rng,
    )
    .await?;
    let Some(claimed) = claimed else {
        return Err(UseCaseError::refused(rules::EMPTY_POOL));
    };
    tx.commit().await.map_err(DbError::from)?;
    Ok(after_commit(app, now, claimed).await)
}

/// Une saisie tapée à la main peut viser une génération encore fermée : refusée, avec la raison.
fn available(id: u16, generation: u8) -> Result<&'static Species, UseCaseError> {
    match species::get(id) {
        Some(species) if species.is_available(generation) => Ok(species),
        Some(species) => Err(UseCaseError::refused(rules::closed_generation(
            species, generation,
        ))),
        None => Err(UseCaseError::refused(rules::UNKNOWN_SPECIES)),
    }
}

pub(crate) fn channel(app: &App) -> Option<i64> {
    app.instance
        .discord
        .pokemon_channel_id
        .and_then(|id| i64::try_from(id).ok())
}

/// Revendique une apparition dans la transaction ouverte, si `cause` en donne le droit : fait fuir le
/// Pokémon en place, insère le suivant et déclare son message public dans `channel`. `None` : pas le
/// droit, ou rien à tirer.
#[allow(clippy::too_many_arguments)] // L'état d'une revendication, passé tel quel par ses trois causes.
pub(crate) async fn claim(
    conn: &mut Conn,
    config: &GameConfig,
    generation: u8,
    cause: Cause,
    options: Options<'_>,
    channel: i64,
    now_ms: i64,
    rng: &mut (impl Rng + ?Sized),
) -> Result<Option<Claimed>, DbError> {
    let spawn_config = &config.pokemon.spawn;
    let state = spawns::state(conn).await?;
    let active = spawns::active(conn).await?;
    let last_end = match active {
        Some(_) => None,
        None => spawns::last_end(conn).await?,
    };
    let snapshot = Channel {
        message_count: state.message_count,
        last_spawn_at: state.last_spawn_at,
        paused_until: state.paused_until,
        // Une rareté illisible ne protège pas comme un légendaire : le Pokémon reste chassable.
        active: active
            .as_ref()
            .map(|spawn| Rarity::from_key(&spawn.rarity).unwrap_or(Rarity::Common)),
        last_end,
    };
    if !rules::claims(cause, &snapshot, now_ms, spawn_config) {
        return Ok(None);
    }
    let draw = Draw::new(&config.pokemon, generation);
    let Some(encounter) = rules::roll(&draw, options.forced, rng) else {
        tracing::warn!("no species available for a spawn");
        return Ok(None);
    };
    // L'ancien sort avant l'insertion : l'index unique partiel refuserait un second ACTIVE.
    let replaced = match active {
        Some(previous) => {
            let drop = leaves(config, &previous, Some(channel), rng);
            flee_one(conn, previous, now_ms, drop).await?
        }
        None => None,
    };
    let species = encounter.species;
    let new = NewSpawn {
        species_id: i64::from(species.id),
        is_shiny: encounter.shiny.shiny,
        charm_shiny: encounter.shiny.charm,
        // Le taux brut de l'espèce, figé : le plancher s'applique à la lecture.
        catch_rate: i64::from(species.catch_rate),
        rarity: encounter.rarity.key(),
        held_item: encounter.held_item,
        sex: encounter.sex.map(Sex::code),
        form: encounter.form,
        spawned_at: now_ms,
        flees_at: rules::flee_deadline(now_ms, spawn_config, encounter.rarity, rng.random()),
        announcement: options.announcement,
        pings_role: rules::pings_role(
            spawn_config,
            encounter.rarity,
            encounter.shiny.shiny,
            options.ping,
        ),
    };
    let id = spawns::insert(conn, &new).await?;
    spawns::claimed(conn, now_ms).await?;
    public_messages::create(conn, MESSAGE, id, channel, now_ms).await?;
    Ok(Some(Claimed {
        born: Born { id, encounter },
        replaced,
    }))
}

/// Le salon où un fuyard lâchera son objet, si le tirage le veut ; sans salon il part avec, et une
/// pêche n'a pas de salon où le poser. Le hasard n'est tiré que s'il tient quelque chose, comme en v1.
fn leaves(
    config: &GameConfig,
    spawn: &Spawn,
    channel: Option<i64>,
    rng: &mut (impl Rng + ?Sized),
) -> Option<i64> {
    if spawn.held_item.is_none() || spawn.fished {
        return None;
    }
    channel.filter(|_| drop::leaves_item_behind(&config.pokemon.spawn, rng.random()))
}

/// Fait fuir une apparition encore là et prépare sa fin : son message se réécrit, ses lancers
/// comptent, et elle lâche son objet dans le salon `drop` s'il y en a un (`leaves`). `None` : une
/// capture l'a emportée entre-temps, il n'y a rien à conclure.
async fn flee_one(
    conn: &mut Conn,
    spawn: Spawn,
    now_ms: i64,
    drop: Option<i64>,
) -> Result<Option<Fled>, DbError> {
    if !spawns::flee(conn, spawn.id, now_ms).await? {
        return Ok(None);
    }
    if let (Some(channel), Some(item)) = (drop, spawn.held_item.as_deref()) {
        drops::place(conn, &spawn, item, channel, now_ms).await?;
    }
    public_messages::touch(conn, MESSAGE, spawn.id, now_ms).await?;
    let spent = spawns::spending(conn, spawn.id).await?;
    Ok(Some(Fled { spawn, spent }))
}

/// Après le commit : les statistiques, le journal, et le réveil du worker des messages publics.
pub(crate) async fn after_commit(app: &App, now: Timestamp, claimed: Claimed) -> Born {
    let born = claimed.born;
    if let Some(fled) = &claimed.replaced {
        stats::record_end(app, now, &fled.spawn, &fled.spent, None).await;
    }
    stats::record_birth(app, now, &born);
    app.public_messages_changed();
    let encounter = &born.encounter;
    tracing::info!(
        id = born.id,
        species = encounter.species.name,
        shiny = encounter.shiny.shiny,
        charm = encounter.shiny.charm,
        rarity = encounter.rarity.key(),
        "pokemon spawned"
    );
    born
}

/// Fait fuir les apparitions dont la durée de vie est écoulée, ou dont le message a disparu. Une
/// apparition sans échéance (antérieure à son ajout en v1) en reçoit une, tirée à partir de
/// maintenant : ni immortelle, ni tuée au premier passage. Rend le nombre de fuites.
pub async fn flee_due(app: &App) -> Result<usize, DbError> {
    let config = app.game_config();
    let now = app.clock.now();
    let now_ms = now.as_millisecond();
    let mut rng = App::rng();
    let mut tx = app.db.writer().begin().await.map_err(DbError::from)?;
    for (id, rarity) in spawns::without_deadline(&mut tx).await? {
        let rarity = Rarity::from_key(&rarity).unwrap_or(Rarity::Common);
        let deadline = rules::flee_deadline(now_ms, &config.pokemon.spawn, rarity, rng.random());
        spawns::set_deadline(&mut tx, id, deadline).await?;
        tracing::info!(id, "flee deadline given to an older spawn");
    }
    let mut fled = Vec::new();
    for spawn in spawns::due(&mut tx, now_ms).await? {
        let drop = leaves(&config, &spawn, channel(app), &mut rng);
        if let Some(done) = flee_one(&mut tx, spawn, now_ms, drop).await? {
            fled.push(done);
        }
    }
    tx.commit().await.map_err(DbError::from)?;
    for done in &fled {
        tracing::info!(id = done.spawn.id, "spawn fled");
        stats::record_end(app, now, &done.spawn, &done.spent, None).await;
    }
    if !fled.is_empty() {
        app.public_messages_changed();
    }
    Ok(fled.len())
}

/// Le balayage des fuites, chaque minute jusqu'à l'arrêt.
pub async fn run(app: App, mut shutdown: watch::Receiver<bool>) {
    loop {
        if let Err(error) = flee_due(&app).await {
            tracing::error!(?error, "pokemon flee sweep failed");
        }
        tokio::select! {
            () = tokio::time::sleep(TICK) => {}
            _ = shutdown.wait_for(|stop| *stop) => return,
        }
    }
}

#[cfg(test)]
mod tests;
