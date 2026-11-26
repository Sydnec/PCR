//! Adaptateur Discord : boucle de la gateway, slash commands, boutons/menus/modals, messages publics.
//!
//! Les handlers restent minces : décoder l'interaction, appeler un cas d'usage de `pcr-app`, rendre
//! le résultat. Chaque handler de composant relit son état en base : les boutons marchent encore
//! après un redémarrage.

mod announce;
mod commands;
mod interactions;
mod ui;

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
    /// Les tâches de démarrage ne partent qu'au premier READY, pas à chaque reconnexion.
    pub started: Arc<AtomicBool>,
}

/// Seulement ce que le bot utilise : les intents privilégiés arrivent avec les fonctionnalités qui en ont besoin.
const INTENTS: Intents = Intents::GUILDS;

/// Se connecte à Discord, enregistre les commandes de guilde et traite les événements jusqu'à l'arrêt.
pub async fn run(
    app: App,
    token: String,
    mut shutdown: watch::Receiver<bool>,
) -> anyhow::Result<()> {
    let http = Arc::new(Client::new(token.clone()));
    let application_id = Id::new(app.instance.discord.application_id);
    let guild_id = Id::new(app.instance.discord.guild_id);

    let ctx = Ctx {
        app,
        http,
        application_id,
        started: Arc::default(),
    };
    // Une panne de Discord ne doit pas faire tomber le site : on réessaie jusqu'à réponse ou arrêt.
    if !register_commands(&ctx, guild_id, &mut shutdown).await {
        return Ok(());
    }
    let mut shard = Shard::new(ShardId::ONE, token, INTENTS);

    loop {
        let event = tokio::select! {
            event = shard.next_event(EventTypeFlags::all()) => event,
            () = stop_requested(&mut shutdown) => {
                close_gracefully(&mut shard).await;
                ctx.app.health.set_discord_ready(false);
                return Ok(());
            }
        };
        match event {
            Some(Ok(event)) => handle_event(&ctx, event),
            Some(Err(source)) => tracing::warn!(?source, "gateway event error"),
            None => {
                // Fermeture définitive (jeton refusé, intents non autorisés) : le site continue de
                // tourner, `/healthz` signale `discord: false`, et on attend l'arrêt demandé.
                ctx.app.health.set_discord_ready(false);
                tracing::error!("discord gateway closed for good, check the token and intents");
                stop_requested(&mut shutdown).await;
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
            }
        }
        Event::Resumed => ctx.app.health.set_discord_ready(true),
        Event::GatewayClose(_) => ctx.app.health.set_discord_ready(false),
        Event::InteractionCreate(interaction) => {
            // Chaque interaction a sa tâche : le délai de réponse de 3 s ne doit jamais attendre
            // derrière un autre handler.
            tokio::spawn(interactions::handle(ctx.clone(), interaction.0));
        }
        _ => {}
    }
}
