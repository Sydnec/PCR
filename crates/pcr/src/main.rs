//! `pcr` : lance le bot et le site, et porte les commandes de maintenance.

use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

use anyhow::Context as _;
use clap::{Parser, Subcommand};
use pcr_app::App;
use pcr_core::{
    clock::SystemClock,
    instance::{Env, Instance},
};
use pcr_db::Db;
use tokio::sync::watch;

#[derive(Debug, Parser)]
#[command(version, about = "PCR Discord bot")]
struct Cli {
    /// Réglages de l'instance (non secrets). Les secrets sont lus dans l'environnement.
    #[arg(long, env = "PCR_INSTANCE", default_value = "/etc/pcr/instance.toml")]
    config: PathBuf,
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Lance le bot et le site (par défaut).
    Serve,
    /// Valide le fichier d'instance puis s'arrête.
    CheckConfig,
    /// Copie cohérente de `pcr.db` vers `--out` (le bot peut tourner pendant ce temps).
    Backup {
        #[arg(long)]
        out: PathBuf,
    },
    /// Dev uniquement, bot arrêté : remplace `pcr.db` par une sauvegarde de prod, la migre et
    /// neutralise ce qui pointe vers la prod.
    ImportProd { file: PathBuf },
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
        Command::Backup { out } => {
            tokio::runtime::Runtime::new()?.block_on(backup(&instance, &out))
        }
        Command::ImportProd { file } => {
            tokio::runtime::Runtime::new()?.block_on(import_prod(&instance, &file))
        }
    }
}

fn database_path(instance: &Instance) -> PathBuf {
    instance.data_dir.join("pcr.db")
}

async fn backup(instance: &Instance, out: &Path) -> anyhow::Result<()> {
    let src = database_path(instance);
    anyhow::ensure!(src.exists(), "no database at {}", src.display());
    pcr_db::backup::vacuum_into(&src, out).await?;
    tracing::info!(out = %out.display(), "backup written");
    Ok(())
}

async fn import_prod(instance: &Instance, file: &Path) -> anyhow::Result<()> {
    // Garde-fou : écraser la base de prod par erreur serait irréparable.
    anyhow::ensure!(
        instance.env == Env::Dev,
        "import-prod only runs on the dev instance"
    );
    anyhow::ensure!(
        pcr_db::backup::is_pcr_database(file).await?,
        "{} is not a PCR 2.0 database",
        file.display()
    );

    let dest = database_path(instance);
    let staging = dest.with_extension("db.importing");
    let _ = std::fs::remove_file(&staging);
    pcr_db::backup::vacuum_into(file, &staging).await?;
    // Un WAL resté de l'ancienne base ne doit pas être rejoué sur la nouvelle.
    for suffix in ["db-wal", "db-shm"] {
        let _ = std::fs::remove_file(dest.with_extension(suffix));
    }
    std::fs::rename(&staging, &dest).context("replacing pcr.db")?;

    // Migre la copie au schéma de ce binaire. Dès qu'une table référencera un salon, un message
    // Discord ou une action envers des membres (spawns, échanges, rappels…), sa neutralisation
    // s'ajoutera ici : le bot de dev ne doit ni éditer la prod ni écrire à de vrais membres.
    let db = Db::open(&dest).await?;
    db.close().await;
    tracing::info!(from = %file.display(), "prod data imported");
    Ok(())
}

fn init_tracing() {
    use std::io::IsTerminal as _;
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));
    tracing_subscriber::fmt()
        .with_env_filter(filter)
        // journald ajoute ses propres horodatages et n'affiche pas les couleurs.
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

    let mut web = tokio::spawn(pcr_web::serve(app.clone(), changed(stopped.clone())));
    let mut discord = tokio::spawn(pcr_discord::run(app, token, stopped));
    // La première tâche qui s'arrête (signal, ou site incapable d'écouter) arrête l'autre : jamais de
    // bot sans site ni de site sans bot qui tournerait sans que personne le sache.
    let (web, discord) = tokio::select! {
        web_result = &mut web => {
            stop.send_replace(true);
            (web_result, discord.await)
        }
        discord_result = &mut discord => {
            stop.send_replace(true);
            (web.await, discord_result)
        }
    };

    db.close().await;
    discord.context("discord task panicked")??;
    web.context("web task panicked")?
        .context("web server failed")
}

/// Se résout dès que le drapeau d'arrêt est levé.
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
