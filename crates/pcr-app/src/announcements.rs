//! Annonce de version sur Discord.
//!
//! - Prod : les entrées `announce = true` de la version qui tourne, une seule fois par version.
//! - Dev : un aperçu des entrées en attente, une fois par commit déployé, pour relire le texte joueur
//!   avant la release.
//!
//! Le marqueur en base n'est posé qu'après l'envoi : un échec réessaie au démarrage suivant.

use pcr_core::{
    build::{GIT_SHA, VERSION},
    changelog::{self, Announcement, Changelog},
    instance::Env,
};
use pcr_db::{DbError, meta};

use crate::App;

/// Ce qu'il reste à poster, et le marqueur qui dira que c'est fait.
#[derive(Debug)]
pub struct Pending {
    pub title: String,
    pub description: String,
    pub footer: &'static str,
    pub sections: Vec<(&'static str, String)>,
    marker: (&'static str, String),
}

#[derive(Debug, thiserror::Error)]
pub enum AnnounceError {
    #[error(transparent)]
    Db(#[from] DbError),
    #[error("invalid changelog: {0}")]
    Changelog(#[from] toml::de::Error),
}

pub async fn pending(app: &App) -> Result<Option<Pending>, AnnounceError> {
    let (key, value) = match app.instance.env {
        Env::Prod => ("last_announced_version", VERSION.to_owned()),
        Env::Dev => ("last_preview_commit", GIT_SHA.to_owned()),
    };
    if meta::get(&app.db, key).await?.as_deref() == Some(value.as_str()) {
        return Ok(None);
    }

    let announcement = match app.instance.env {
        Env::Prod => {
            let changelog = Changelog::parse(changelog::RELEASES)?;
            changelog
                .find(VERSION)
                .and_then(|release| changelog::announcement(&release.entries))
        }
        Env::Dev => {
            let entries = changelog::UNRELEASED
                .iter()
                .map(|text| changelog::parse_entry(text))
                .collect::<Result<Vec<_>, _>>()?;
            changelog::announcement(&entries)
        }
    };
    let Some(Announcement { count, sections }) = announcement else {
        // Rien à dire pour cette version : on ne reposera pas la question à chaque démarrage.
        meta::set(&app.db, key, &value).await?;
        return Ok(None);
    };

    let (title, description, footer) = match app.instance.env {
        Env::Prod => (
            format!("🚀 PCR Bot v{VERSION} déployé !"),
            format!("Release {VERSION}\n\n{count} nouvelle(s) fonctionnalité(s) incluse(s)."),
            "Déploiement automatique",
        ),
        Env::Dev => (
            "🧪 Aperçu des annonces en attente".to_owned(),
            format!("Commit `{GIT_SHA}`\n\n{count} entrée(s) annoncée(s) à la prochaine release."),
            "Bot de développement",
        ),
    };
    Ok(Some(Pending {
        title,
        description,
        footer,
        sections,
        marker: (key, value),
    }))
}

/// À appeler une fois le message envoyé.
pub async fn mark_posted(app: &App, pending: &Pending) -> Result<(), DbError> {
    meta::set(&app.db, pending.marker.0, &pending.marker.1).await
}
