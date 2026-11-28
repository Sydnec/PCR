//! Adaptateur Discord : boucle de la gateway, slash commands, boutons/menus/modals, messages publics.
//!
//! Les handlers restent minces : décoder l'interaction, appeler un cas d'usage de `pcr-app`, rendre
//! le résultat. Chaque handler de composant relit son état en base : les boutons marchent encore
//! après un redémarrage.

mod announce;
mod arrivals;
mod bets;
mod commands;
mod interactions;
mod links;
mod members;
mod messages;
mod outbox;
mod pokemon;
mod polls;
mod public_messages;
mod reactions;
mod reminders;
mod roles;
mod threads;
mod ui;
mod voice;

use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use pcr_app::App;
use tokio::sync::watch;
use twilight_gateway::{
    CloseFrame, Event, EventTypeFlags, Intents, Shard, ShardId, StreamExt as _,
};
use twilight_http::Client;
use twilight_model::gateway::payload::incoming::GuildCreate;
use twilight_model::id::{
    Id,
    marker::{ApplicationMarker, GuildMarker},
};

/// Partagé par tous les handlers.
#[derive(Debug, Clone)]
pub(crate) struct Ctx {
    pub app: App,
    pub http: Arc<Client>,
    pub application_id: Id<ApplicationMarker>,
    pub guild_id: Id<GuildMarker>,
    /// Les pages lues par le bot (saints du jour).
    pub web: Arc<dyn pcr_app::outbox::Web>,
    /// Les tâches de démarrage ne partent qu'au premier READY, pas à chaque reconnexion.
    pub started: Arc<AtomicBool>,
    /// Les utilisations de chaque invitation, pour reconnaître celle d'un nouveau membre (un cache :
    /// relu au démarrage).
    pub invites: Arc<std::sync::Mutex<std::collections::HashMap<String, u64>>>,
    /// Les `/admin purge-membre` en cours, par membre visé : un anti-doublon, pas un état de jeu (un
    /// redémarrage interrompt la purge, la relancer reprend ce qui reste).
    pub purges: commands::admin::purge_member::Running,
    /// Une liste des fils réécrite à la fois.
    pub thread_list: Arc<tokio::sync::Mutex<()>>,
    /// La file des changements de vocal (`voice::run`).
    pub voice: voice::Sender,
    /// Ce que le bot envoie de lui-même (annonce d'un Charme Chroma après une capture…).
    pub outbox: Arc<dyn pcr_app::outbox::Outbox>,
    /// Le panneau de lancer ouvert par chaque dresseur : un cache d'interface, pour qu'il n'en ait
    /// qu'un à la fois (perdu au redémarrage : au pire un panneau de trop survit).
    pub panels: pokemon::throw::Panels,
}

/// Un identifiant Discord tel qu'il vit en base.
pub(crate) fn id(value: u64) -> i64 {
    i64::try_from(value).unwrap_or(i64::MAX)
}

/// Seulement ce que le bot utilise. Les messages du serveur et les MP (comme en v1) rapportent des
/// points ; leur contenu, privilégié, nourrit les stats de mots et d'emoji et la réécriture des
/// liens. Les réactions et le vocal font des stats (et donnent les rôles en libre-service) ; les
/// arrivées (privilégié, « Server Members ») et les invitations donnent le rôle d'arrivée.
const INTENTS: Intents = Intents::GUILDS
    .union(Intents::GUILD_MESSAGES)
    .union(Intents::DIRECT_MESSAGES)
    .union(Intents::MESSAGE_CONTENT)
    .union(Intents::GUILD_MESSAGE_REACTIONS)
    .union(Intents::GUILD_VOICE_STATES)
    .union(Intents::GUILD_MEMBERS)
    .union(Intents::GUILD_INVITES);

/// Se connecte à Discord, enregistre les commandes de guilde et traite les événements jusqu'à l'arrêt.
pub async fn run(
    app: App,
    token: String,
    mut shutdown: watch::Receiver<bool>,
) -> anyhow::Result<()> {
    let http = Arc::new(Client::new(token.clone()));
    let application_id = Id::new(app.instance.discord.application_id);
    let guild_id = Id::new(app.instance.discord.guild_id);

    let (voice_tx, voice_rx) = tokio::sync::mpsc::unbounded_channel();
    let voice_queue = tokio::spawn(voice::run(app.clone(), guild_id, voice_rx));
    // Les tâches de calendrier, les rappels et les annonces du jeu écrivent sur Discord : ils vivent
    // avec la connexion, et sont attendus avant la fermeture de la base.
    let outbox: Arc<dyn pcr_app::outbox::Outbox> = Arc::new(outbox::DiscordOutbox {
        http: Arc::clone(&http),
        guild: guild_id,
    });
    let ctx = Ctx {
        app,
        http,
        application_id,
        guild_id,
        web: web(),
        started: Arc::default(),
        invites: Arc::default(),
        purges: Arc::default(),
        thread_list: Arc::default(),
        voice: voice_tx,
        outbox: Arc::clone(&outbox),
        panels: Arc::default(),
    };
    // Le worker vit avec la connexion Discord : sans elle, il n'aurait rien à écrire. Il est attendu
    // avant de rendre la main, donc avant la fermeture de la base : un message posté est toujours noté.
    let worker = tokio::spawn(pcr_app::public_messages::run(
        ctx.app.clone(),
        Arc::new(public_messages::DiscordPublicMessages {
            app: ctx.app.clone(),
            http: Arc::clone(&ctx.http),
        }),
        shutdown.clone(),
    ));
    // Le pot commun lit les membres sur Discord : il vit, lui aussi, avec la connexion.
    let pot = tokio::spawn(pcr_app::redistribution::run(
        ctx.app.clone(),
        Arc::new(members::DiscordMembers {
            http: Arc::clone(&ctx.http),
            guild: guild_id,
        }),
        shutdown.clone(),
    ));
    let ports = pcr_app::outbox::Ports {
        outbox: Arc::clone(&outbox),
        web: Arc::clone(&ctx.web),
    };
    let jobs = tokio::spawn(pcr_app::jobs::run(
        ctx.app.clone(),
        pcr_app::jobs::all(),
        ports,
        shutdown.clone(),
    ));
    let reminders = tokio::spawn(pcr_app::reminders::run(
        ctx.app.clone(),
        outbox,
        shutdown.clone(),
    ));
    // La fuite des Pokémon réécrit leur message : elle vit avec le worker, donc avec la connexion.
    let flee = tokio::spawn(pcr_app::pokemon::spawn::run(
        ctx.app.clone(),
        shutdown.clone(),
    ));
    let result = gateway(&ctx, guild_id, token, &mut shutdown).await;
    // Plus rien n'arrive de la gateway : ce qui reste en file n'a plus d'importance, le démarrage
    // suivant relève qui est en vocal.
    voice_queue.abort();
    for (name, task) in [
        ("public messages worker", worker),
        ("pot commun loop", pot),
        ("jobs loop", jobs),
        ("reminders loop", reminders),
        ("pokemon flee loop", flee),
    ] {
        if let Err(error) = task.await {
            tracing::error!(?error, task = name, "background task panicked");
        }
    }
    result
}

/// Le client des pages lues par le bot (saints du jour). Sans magasin de certificats sur la machine,
/// ces pages restent injoignables, sans arrêter le reste.
fn web() -> Arc<dyn pcr_app::outbox::Web> {
    match pcr_app::http::Http::new() {
        Ok(http) => Arc::new(http),
        Err(error) => {
            tracing::error!(%error, "no HTTP client, the saints of the day stay silent");
            Arc::new(pcr_app::outbox::Offline(error))
        }
    }
}

/// La gateway jusqu'à l'arrêt demandé (ou une fermeture définitive, puis l'arrêt).
async fn gateway(
    ctx: &Ctx,
    guild_id: Id<GuildMarker>,
    token: String,
    shutdown: &mut watch::Receiver<bool>,
) -> anyhow::Result<()> {
    // Une panne de Discord ne doit pas faire tomber le site : on réessaie jusqu'à réponse ou arrêt.
    if !register_commands(ctx, guild_id, shutdown).await {
        return Ok(());
    }
    let mut shard = Shard::new(ShardId::ONE, token, INTENTS);

    loop {
        let event = tokio::select! {
            event = shard.next_event(EventTypeFlags::all()) => event,
            () = stop_requested(shutdown) => {
                close_gracefully(&mut shard).await;
                ctx.app.health.set_discord_ready(false);
                return Ok(());
            }
        };
        match event {
            Some(Ok(event)) => handle_event(ctx, event),
            Some(Err(source)) => tracing::warn!(?source, "gateway event error"),
            None => {
                // Fermeture définitive (jeton refusé, intents non autorisés) : le site continue de
                // tourner, `/healthz` signale `discord: false`, et on attend l'arrêt demandé.
                ctx.app.health.set_discord_ready(false);
                tracing::error!("discord gateway closed for good, check the token and intents");
                stop_requested(shutdown).await;
                return Ok(());
            }
        }
    }
}

/// Envoie la trame de fermeture : twilight ne l'émet que si la shard est encore lue ensuite.
/// Sans elle, Discord affiche le bot en ligne jusqu'à l'expiration de sa présence.
async fn close_gracefully(shard: &mut Shard) {
    const CLOSE_TIMEOUT: Duration = Duration::from_secs(5);

    shard.close(CloseFrame::NORMAL);
    // Les trames de fermeture passent toujours le filtre : `empty()` ignore tout le reste.
    let drain = async {
        while let Some(item) = shard.next_event(EventTypeFlags::empty()).await {
            if matches!(item, Ok(Event::GatewayClose(_))) {
                break;
            }
        }
    };
    if tokio::time::timeout(CLOSE_TIMEOUT, drain).await.is_ok() {
        tracing::info!("discord gateway closed");
    } else {
        tracing::warn!("discord gateway did not acknowledge the close in time");
    }
}

/// Attend que l'arrêt soit demandé. Le verrou de lecture du `watch` est relâché avant de rendre la
/// main : le garder à travers un `await` rendrait la tâche non `Send`.
async fn stop_requested(shutdown: &mut watch::Receiver<bool>) {
    let _ = shutdown.wait_for(|stop| *stop).await;
}

/// Remplace en bloc les commandes de guilde, en réessayant avec un délai croissant.
/// Renvoie `false` si l'arrêt a été demandé avant.
async fn register_commands(
    ctx: &Ctx,
    guild_id: Id<GuildMarker>,
    shutdown: &mut watch::Receiver<bool>,
) -> bool {
    const FIRST_RETRY: Duration = Duration::from_secs(5);
    const MAX_RETRY: Duration = Duration::from_mins(5);

    let commands = commands::all();
    let mut delay = FIRST_RETRY;
    loop {
        match ctx
            .http
            .interaction(ctx.application_id)
            .set_guild_commands(guild_id, &commands)
            .await
        {
            Ok(_) => return true,
            Err(error) => {
                tracing::warn!(%error, retry_in = ?delay, "could not register guild commands");
            }
        }
        tokio::select! {
            () = tokio::time::sleep(delay) => {}
            () = stop_requested(shutdown) => return false,
        }
        delay = (delay * 2).min(MAX_RETRY);
    }
}

fn handle_event(ctx: &Ctx, event: Event) {
    match event {
        Event::Ready(_) => {
            ctx.app.health.set_discord_ready(true);
            if !ctx.started.swap(true, Ordering::Relaxed) {
                tokio::spawn(announce::run(ctx.clone()));
                tokio::spawn(roles::sync_message(ctx.clone()));
            }
        }
        // Le serveur au complet, à chaque connexion : qui est en vocal, et les invitations.
        Event::GuildCreate(guild) => {
            if let GuildCreate::Available(guild) = *guild
                && guild.id == ctx.guild_id
            {
                let in_voice: Vec<i64> = guild
                    .voice_states
                    .iter()
                    .filter(|state| state.channel_id.is_some())
                    .map(|state| id(state.user_id.get()))
                    .collect();
                let _ = ctx.voice.send(voice::Change::Reset(in_voice));
                tokio::spawn(arrivals::cache_invites(ctx.clone()));
            }
        }
        Event::ReactionAdd(reaction) => {
            tokio::spawn(reactions::handle(ctx.clone(), reaction.0, true));
        }
        Event::ReactionRemove(reaction) => {
            tokio::spawn(reactions::handle(ctx.clone(), reaction.0, false));
        }
        Event::VoiceStateUpdate(update) => {
            let _ = ctx.voice.send(update.0.into());
        }
        Event::MemberAdd(member) => {
            tokio::spawn(arrivals::member_added(ctx.clone(), *member));
        }
        Event::InviteCreate(invite) => arrivals::invite_created(ctx, &invite),
        Event::Resumed => ctx.app.health.set_discord_ready(true),
        Event::GatewayClose(_) => ctx.app.health.set_discord_ready(false),
        Event::ThreadCreate(thread) => {
            tokio::spawn(polls::on_thread_create(ctx.clone(), thread.0.clone()));
            tokio::spawn(threads::on_thread_create(ctx.clone(), thread.0));
        }
        Event::MessageCreate(message) => {
            tokio::spawn(messages::handle(ctx.clone(), message.message));
        }
        Event::InteractionCreate(interaction) => {
            // Chaque interaction a sa tâche : le délai de réponse de 3 s ne doit jamais attendre
            // derrière un autre handler.
            tokio::spawn(interactions::handle(ctx.clone(), interaction.0));
        }
        _ => {}
    }
}
