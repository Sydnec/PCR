//! Adaptateur Discord : boucle de la gateway, slash commands, boutons/menus/modals, messages publics.
//!
//! Les handlers restent minces : décoder l'interaction, appeler un cas d'usage de `pcr-app`, rendre
//! le résultat. Chaque handler de composant relit son état en base : les boutons marchent encore
//! après un redémarrage.

mod commands;
mod interactions;
mod ui;

use std::{sync::Arc, time::Duration};

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
    };
    // Une panne de Discord ne doit pas faire tomber le site : on réessaie jusqu'à réponse ou arrêt.
    if !register_commands(&ctx, guild_id, &mut shutdown).await {
        return Ok(());
    }
    let mut shard = Shard::new(ShardId::ONE, token, INTENTS);

    loop {
        let event = tokio::select! {
            event = shard.next_event(EventTypeFlags::all()) => event,
            _ = shutdown.changed() => {
                shard.close(CloseFrame::NORMAL);
                ctx.app.health.set_discord_ready(false);
                tracing::info!("discord gateway closed");
                return Ok(());
            }
        };
        match event {
            Some(Ok(event)) => handle_event(&ctx, event),
            Some(Err(source)) => tracing::warn!(?source, "gateway event error"),
            None => return Ok(()),
        }
    }
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
            _ = shutdown.wait_for(|stop| *stop) => return false,
        }
        delay = (delay * 2).min(MAX_RETRY);
    }
}

fn handle_event(ctx: &Ctx, event: Event) {
    match event {
        Event::Ready(_) | Event::Resumed => ctx.app.health.set_discord_ready(true),
        Event::GatewayClose(_) => ctx.app.health.set_discord_ready(false),
        Event::InteractionCreate(interaction) => {
            // Chaque interaction a sa tâche : le délai de réponse de 3 s ne doit jamais attendre
            // derrière un autre handler.
            tokio::spawn(interactions::handle(ctx.clone(), interaction.0));
        }
        _ => {}
    }
}
