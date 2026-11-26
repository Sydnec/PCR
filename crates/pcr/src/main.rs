//! `pcr`: runs the bot and the website, plus maintenance commands.

use std::{path::PathBuf, sync::Arc};

use anyhow::Context as _;
use clap::{Parser, Subcommand};
use pcr_app::App;
use pcr_core::{clock::SystemClock, instance::Instance};
use pcr_db::Db;
use tokio::sync::watch;

#[derive(Debug, Parser)]
#[command(version, about = "PCR Discord bot")]
struct Cli {
    /// Instance settings (non-secret). Secrets are read from the environment.
    #[arg(long, env = "PCR_INSTANCE", default_value = "/etc/pcr/instance.toml")]
    config: PathBuf,
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Run the bot and the website (default).
    Serve,
    /// Validate the instance file and exit.
    CheckConfig,
}

fn main() -> anyhow::Result<()> {
    init_tracing();
    rustls::crypto::ring::default_provider()
        .install_default()
        .map_err(|_| anyhow::anyhow!("a TLS crypto provider is already installed"))?;

    let cli = Cli::parse();
    let text = std::fs::read_to_string(&cli.config)
        .with_context(|| format!("reading {}", cli.config.display()))?;
    let instance = Instance::from_toml(&text)?;

    match cli.command.unwrap_or(Command::Serve) {
        Command::CheckConfig => {
            tracing::info!(env = ?instance.env, "instance file is valid");
            Ok(())
        }
        Command::Serve => tokio::runtime::Runtime::new()?.block_on(serve(instance)),
    }
}

fn init_tracing() {
    use std::io::IsTerminal as _;
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));
    tracing_subscriber::fmt()
        .with_env_filter(filter)
        // journald adds its own timestamps and does not render colours.
        .with_ansi(std::io::stderr().is_terminal())
        .with_writer(std::io::stderr)
        .init();
}

async fn serve(instance: Instance) -> anyhow::Result<()> {
    let token = std::env::var("DISCORD_TOKEN").context("DISCORD_TOKEN is not set")?;
    std::fs::create_dir_all(&instance.data_dir)
        .with_context(|| format!("creating {}", instance.data_dir.display()))?;
    let db = Db::open(&instance.data_dir.join("pcr.db")).await?;
    let app = App::new(db.clone(), Arc::new(SystemClock), instance);

    let (stop, stopped) = watch::channel(false);
    let stop = Arc::new(stop);
    tokio::spawn({
        let stop = Arc::clone(&stop);
        async move {
            wait_for_signal().await;
            tracing::info!("shutdown requested");
            stop.send_replace(true);
        }
    });

    let web = tokio::spawn(pcr_web::serve(app.clone(), changed(stopped.clone())));
    let discord = pcr_discord::run(app, token, stopped).await;
    // Whatever ended the Discord loop (signal or fatal error), stop the website too.
    stop.send_replace(true);
    let web = web.await.context("web task panicked")?;

    db.close().await;
    discord?;
    web.context("web server failed")
}

/// Resolves once the stop flag is raised.
async fn changed(mut stopped: watch::Receiver<bool>) {
    let _ = stopped.wait_for(|stop| *stop).await;
}

async fn wait_for_signal() {
    use tokio::signal::unix::{SignalKind, signal};
    match signal(SignalKind::terminate()) {
        Ok(mut sigterm) => {
            tokio::select! {
                _ = tokio::signal::ctrl_c() => {}
                _ = sigterm.recv() => {}
            }
        }
        Err(error) => {
            tracing::warn!(?error, "SIGTERM handler unavailable, Ctrl-C only");
            let _ = tokio::signal::ctrl_c().await;
        }
    }
}
