//! `pcr` : lance le bot et le site, et porte les commandes de maintenance.

use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

use anyhow::Context as _;
use clap::{Parser, Subcommand};
use pcr_app::App;
use pcr_core::{
    clock::{Clock as _, SystemClock},
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
    /// Bot arrêté : convertit les données v1 de `<V1_DIR>` (`points.db`, `botdata-<année>.db`,
    /// `config.json`) en `pcr.db` et `stats-<année>.db`, et écrit le rapport à côté. Sur dev,
    /// neutralise en plus ce qui pointe vers la prod.
    MigrateV1 {
        v1_dir: PathBuf,
        /// Année du fichier `botdata-<année>.db` à reprendre (par défaut l'année en cours à Paris).
        #[arg(long)]
        year: Option<i16>,
    },
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
        Command::MigrateV1 { v1_dir, year } => {
            tokio::runtime::Runtime::new()?.block_on(migrate_v1(&instance, &v1_dir, year))
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
    for leftover in ["db.importing", "db.importing-wal", "db.importing-shm"] {
        let _ = std::fs::remove_file(dest.with_extension(leftover));
    }
    pcr_db::backup::vacuum_into(file, &staging).await?;
    // Migre et neutralise la copie *avant* de remplacer quoi que ce soit : un échec laisse la base de
    // dev intacte, et le bot de dev ne démarre jamais sur des données qui éditeraient la prod ou
    // écriraient à de vrais membres.
    let db = Db::open(&staging).await?;
    let neutralized = pcr_db::import_prod::neutralize(&db, SystemClock.now_ms()).await;
    db.close().await;
    let neutralized = neutralized?;
    tracing::info!(?neutralized, "prod references neutralized");
    // La fermeture rapatrie le WAL dans le fichier ; s'il en restait un, le renommage perdrait des pages.
    anyhow::ensure!(
        !staging.with_extension("importing-wal").exists(),
        "staging database still has a WAL file"
    );
    // Un WAL resté de l'ancienne base ne doit pas être rejoué sur la nouvelle.
    for suffix in ["db-wal", "db-shm"] {
        let _ = std::fs::remove_file(dest.with_extension(suffix));
    }
    std::fs::rename(&staging, &dest).context("replacing pcr.db")?;
    tracing::info!(from = %file.display(), "prod data imported");
    Ok(())
}

async fn migrate_v1(instance: &Instance, v1_dir: &Path, year: Option<i16>) -> anyhow::Result<()> {
    use pcr_db::migrate_v1::{Options, Sources, Targets, migrate};

    let clock = SystemClock;
    let year = year.unwrap_or_else(|| clock.today().year());
    let config = v1_dir.join("config.json");
    let sources = Sources {
        points: v1_dir.join("points.db"),
        botdata: v1_dir.join(format!("botdata-{year}.db")),
        // Absent quand personne n'a jamais rien réglé à chaud : rien à reprendre.
        config: config.exists().then_some(config),
    };
    for file in [&sources.points, &sources.botdata] {
        anyhow::ensure!(file.exists(), "no v1 file at {}", file.display());
    }
    std::fs::create_dir_all(&instance.data_dir)
        .with_context(|| format!("creating {}", instance.data_dir.display()))?;
    let targets = Targets {
        pcr_db: database_path(instance),
        stats_db: instance.data_dir.join(format!("stats-{year}.db")),
    };
    let options = Options {
        now_ms: clock.now_ms(),
        neutralize: instance.env == Env::Dev,
    };

    let report = migrate(&sources, &targets, options).await?;
    let path = instance.data_dir.join("migrate-v1-report.txt");
    std::fs::write(&path, report.to_string())
        .with_context(|| format!("writing {}", path.display()))?;
    if report.is_clean() {
        tracing::info!(report = %path.display(), "v1 data migrated");
    } else {
        tracing::warn!(
            report = %path.display(),
            "v1 data migrated with gaps: read the report before starting the bot"
        );
    }
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
    // Avant le bot et le site : aucune action ne doit partir avec les seules valeurs par défaut.
    pcr_app::config::reload(&app).await?;

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

    let stats = tokio::spawn(pcr_app::stats::run(app.clone(), stopped.clone()));
    let jobs = tokio::spawn(pcr_app::jobs::run(
        app.clone(),
        pcr_app::jobs::all(),
        stopped.clone(),
    ));
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

    // Une tâche en cours finit son passage avant la fermeture de la base.
    stop.send_replace(true);
    if let Err(error) = jobs.await {
        tracing::error!(?error, "jobs task panicked");
    }
    // Le dernier lot de stats part avant l'arrêt.
    if let Err(error) = stats.await {
        tracing::error!(?error, "stats task panicked");
    }
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
