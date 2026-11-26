//! La configuration de jeu en service : les valeurs par défaut du code, plus les surcharges en base,
//! gardées en mémoire et remplacées d'un bloc à chaque modification (`ArcSwap`) : un cas d'usage lit
//! une configuration cohérente, jamais une moitié d'ancienne et une moitié de nouvelle.
//!
//! La base est la seule source de vérité : après chaque écriture, tout est relu et reconstruit. Les
//! modifications passent une à une (`App::config_writes`) : sans cela, deux `/admin config`
//! simultanés pouvaient remettre en service une lecture qui ignorait l'écriture de l'autre.

use std::sync::Arc;

use pcr_core::{
    config::{GameConfig, edit},
    refusal::Refusal,
};
use pcr_db::DbError;
use serde_json::Value;

use crate::App;

/// Ce qui est en service.
#[derive(Debug)]
pub struct Snapshot {
    pub config: Arc<GameConfig>,
    /// La même configuration en arbre JSON, pour l'administration.
    pub tree: Value,
    /// Les surcharges en base écartées (réglage disparu, valeur invalide) : leurs défauts s'appliquent.
    pub rejected: Vec<String>,
}

impl Default for Snapshot {
    fn default() -> Self {
        Self {
            config: Arc::default(),
            tree: edit::defaults().clone(),
            rejected: Vec::new(),
        }
    }
}

/// Un réglage modifié.
#[derive(Debug)]
pub struct Change {
    pub path: String,
    pub before: Value,
    pub after: Value,
}

#[derive(Debug, thiserror::Error)]
pub enum SetError {
    #[error("{0}")]
    Refused(Refusal),
    #[error(transparent)]
    Db(#[from] DbError),
}

/// Relit les surcharges en base et met la configuration qui en résulte en service.
pub async fn reload(app: &App) -> Result<(), DbError> {
    let overrides = read_overrides(app).await?;
    let (config, tree, rejected) = edit::build(&overrides);
    if !rejected.is_empty() {
        tracing::warn!(?rejected, "stored game settings ignored, defaults apply");
    }
    app.config.store(Arc::new(Snapshot {
        config: Arc::new(config),
        tree,
        rejected,
    }));
    Ok(())
}

/// `/admin config` : convertit `raw`, vérifie que la configuration complète l'accepte, l'enregistre
/// et la met en service.
pub async fn set(app: &App, path: &str, raw: &str, by: u64) -> Result<Change, SetError> {
    let (path, value) = edit::parse(path, raw).map_err(SetError::Refused)?;
    let _one_at_a_time = app.config_writes.lock().await;

    // Avec les autres surcharges : une liste mal formée, ou un nombre trop grand pour son type, ne se
    // voit qu'à la relecture de la configuration entière.
    let mut overrides = read_overrides(app).await?;
    overrides.retain(|(key, _)| key != &path);
    overrides.push((path.clone(), value.clone()));
    if edit::build(&overrides).2.contains(&path) {
        return Err(SetError::Refused(Refusal::new(format!(
            "`{raw}` ne convient pas à ce réglage."
        ))));
    }

    let before = edit::get(&app.config.load().tree, &path)
        .cloned()
        .unwrap_or(Value::Null);
    pcr_db::config::set(
        &app.db,
        &path,
        &value.to_string(),
        app.clock.now_ms(),
        // Un snowflake tient toujours dans un i64.
        i64::try_from(by).unwrap_or(i64::MAX),
    )
    .await?;
    reload(app).await?;
    tracing::info!(%path, %before, after = %value, by, "game setting changed");
    Ok(Change {
        path,
        before,
        after: value,
    })
}

async fn read_overrides(app: &App) -> Result<Vec<(String, Value)>, DbError> {
    let rows = pcr_db::config::list(&app.db).await?;
    // Une valeur illisible en base (écrite à la main) est écartée comme une surcharge invalide.
    Ok(rows
        .into_iter()
        .map(|(key, value)| (key, serde_json::from_str(&value).unwrap_or(Value::Null)))
        .collect())
}

#[cfg(test)]
mod tests {
    use pcr_core::{clock::SystemClock, instance::Instance};
    use pcr_db::Db;
    use serde_json::json;

    use super::*;

    const INSTANCE: &str = include_str!("../../../deploy/instance.example.toml");

    fn new_app(db: Db) -> App {
        let instance = Instance::from_toml(INSTANCE).expect("example instance");
        App::new(db, Arc::new(SystemClock), instance)
    }

    #[tokio::test]
    async fn a_setting_is_stored_and_applied_and_a_malformed_one_is_refused() {
        let dir = std::env::temp_dir().join(format!("pcr-app-config-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        let db = Db::open(&dir.join("pcr.db")).await.expect("open");
        let app = new_app(db.clone());

        let change = set(&app, "pokemon.spawn.shinyOdds", "256", 1)
            .await
            .expect("valid setting");
        assert_eq!((change.before, change.after), (json!(500), json!(256)));
        assert_eq!(app.game_config().pokemon.spawn.shiny_odds, 256);

        // Une liste de paliers qui ne sont pas des paliers : seule la relecture complète le voit.
        let refused = set(&app, "pokemon.starters.rewards", "[1, 2]", 1).await;
        assert!(
            matches!(&refused, Err(SetError::Refused(r)) if r.text() == "`[1, 2]` ne convient pas à ce réglage."),
            "{refused:?}"
        );

        // Après un redémarrage, la base seule redonne la même configuration.
        let restarted = new_app(db.clone());
        reload(&restarted).await.expect("reload");
        assert_eq!(restarted.game_config().pokemon.spawn.shiny_odds, 256);
        assert_eq!(pcr_db::config::list(&db).await.expect("list").len(), 1);

        db.close().await;
        std::fs::remove_dir_all(&dir).ok();
    }
}
