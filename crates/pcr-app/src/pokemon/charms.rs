//! Le Charme Chroma côté cas d'usage : qui le porte, le don quand une espèce complète un Pokédex (dans
//! la transaction qui l'a fait entrer en boîte), et l'annonce dans le salon des apparitions, après
//! le commit. Les rôles du charme arrivent avec P5.

use std::collections::BTreeSet;

use pcr_core::{config::GameConfig, pokemon::charms as rules};
use pcr_db::{
    Conn, DbError,
    pokemon::{collection, items},
};

use crate::{App, outbox::Outbox};

/// Les générations dont `user` porte le charme.
pub(crate) async fn held(
    conn: &mut Conn,
    config: &GameConfig,
    user: i64,
) -> Result<Vec<u8>, DbError> {
    let inventory = items::inventory(conn, user).await?;
    Ok(rules::held(
        &config.pokemon,
        inventory.iter().map(|(key, _)| key.as_str()),
    ))
}

/// Donne à `user` le charme des générations ouvertes dont il possède désormais toutes les espèces.
/// Sûr à rappeler : le don ne passe qu'une fois (`grant_once`). Rend les générations données.
pub(crate) async fn check(
    conn: &mut Conn,
    config: &GameConfig,
    generation: u8,
    user: i64,
    now_ms: i64,
) -> Result<Vec<u8>, DbError> {
    let owned: BTreeSet<u16> = collection::species(conn, user)
        .await?
        .into_iter()
        .filter_map(|id| u16::try_from(id).ok())
        .collect();
    let mut granted = Vec::new();
    for (charm_generation, item) in rules::earned(&config.pokemon, generation, &owned) {
        let source = format!("pokedex:{charm_generation}");
        if items::grant_once(conn, user, item.key, &source, now_ms).await? {
            granted.push(charm_generation);
        }
    }
    Ok(granted)
}

/// Annonce les charmes que `user` vient de recevoir, dans le salon des apparitions (seul lui est
/// mentionné). Une annonce perdue ne reprend pas le charme : elle est journalisée.
pub async fn announce(app: &App, outbox: &dyn Outbox, user: i64, generations: &[u8]) {
    let config = app.game_config();
    let Some(channel) = super::spawn::channel(app) else {
        return;
    };
    for generation in generations {
        tracing::info!(user, generation, "shiny charm granted");
        let Some(item) = pcr_core::pokemon::items::charm_item(&config.pokemon, *generation) else {
            continue;
        };
        let text = rules::announcement(&config.pokemon, user, *generation, &item);
        if let Err(error) = outbox.post(channel, text, vec![user]).await {
            tracing::warn!(%error, user, generation, "announcing a shiny charm failed");
        }
    }
}
