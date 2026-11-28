//! Les objets au sol : la pose (dans la transaction de la capture ou de la fuite qui le lâche, avec
//! son message public), le ramassage (une course à un seul vainqueur, jamais le capteur), et ce que
//! montre leur message.

use pcr_core::pokemon::{
    bag::{self, Overflow},
    drop as rules, items,
};
use pcr_db::{
    Conn, DbError,
    pokemon::{drops, spawn::Spawn},
    public_messages,
};

use super::items::grant;
use crate::{App, error::UseCaseError};

/// Le type de message public d'un objet au sol.
pub const MESSAGE: &str = "drop";

/// Pose l'objet `item` de l'apparition au sol, et déclare son message dans `channel`.
pub(crate) async fn place(
    conn: &mut Conn,
    spawn: &Spawn,
    item: &str,
    channel: i64,
    now_ms: i64,
) -> Result<i64, DbError> {
    let id = drops::create(conn, spawn.id, item, spawn.species_id, now_ms).await?;
    public_messages::create(conn, MESSAGE, id, channel, now_ms).await?;
    tracing::info!(id, spawn = spawn.id, item, "item dropped");
    Ok(id)
}

/// Un objet ramassé.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Picked {
    pub emoji: String,
    pub label: String,
    /// Ce qu'est devenu un exemplaire de trop (vente d'office), à ne dire qu'au ramasseur.
    pub notice: Option<String>,
}

/// Ramasse l'objet `drop` : le premier qui clique l'emporte, sauf celui qui a capturé le Pokémon qui
/// l'a lâché. Il entre dans le sac sous sa limite de détention.
pub async fn claim(app: &App, user: i64, drop: i64) -> Result<Picked, UseCaseError> {
    let config = app.game_config();
    let now_ms = app.clock.now_ms();
    let mut tx = app.db.writer().begin().await.map_err(DbError::from)?;
    if !drops::claim(&mut tx, drop, user, now_ms).await? {
        let found = drops::get(&mut tx, drop).await?;
        let captor = found.as_ref().is_some_and(|found| found.status == "OPEN")
            && drops::is_captor(&mut tx, drop, user).await?;
        return Err(UseCaseError::refused(if captor {
            rules::CAPTOR
        } else {
            rules::TOO_LATE
        }));
    }
    let Some(found) = drops::get(&mut tx, drop).await? else {
        return Err(UseCaseError::refused(rules::TOO_LATE));
    };
    let source = format!("sol:{drop}");
    let item = items::get(&config.pokemon, &found.item_key);
    let granted = grant(
        &mut tx,
        &config.pokemon,
        user,
        &found.item_key,
        1,
        Overflow::Sell,
        &source,
        now_ms,
    )
    .await?;
    // Une clé sortie du catalogue entre le dépôt et le ramassage : rien n'est écrit, l'objet reste au
    // sol plutôt que de disparaître dans le vide. C'est une panne de config, pas un refus de jeu.
    let (Some(item), Some(granted)) = (item, granted) else {
        tracing::error!(drop, key = %found.item_key, "a dropped item left the catalogue");
        return Err(UseCaseError::refused(rules::BROKEN));
    };
    public_messages::touch(&mut tx, MESSAGE, drop, now_ms).await?;
    tx.commit().await.map_err(DbError::from)?;
    app.public_messages_changed();
    tracing::info!(drop, user, item = item.key, "item picked up");
    Ok(Picked {
        emoji: item.emoji.to_owned(),
        label: item.label.to_owned(),
        notice: bag::overflow_notice(&config.pokemon, &item, &granted),
    })
}

/// Ce que montre le message d'un objet au sol.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct View {
    pub emoji: String,
    pub label: String,
    /// Qui l'a ramassé ; `None` : encore au sol.
    pub claimed_by: Option<i64>,
}

/// L'objet au sol `id` ; `None` s'il n'existe pas ou que sa clé a quitté le catalogue.
pub async fn view(app: &App, id: i64) -> Result<Option<View>, DbError> {
    let mut conn = app.db.reader().acquire().await?;
    let Some(found) = drops::get(&mut conn, id).await? else {
        return Ok(None);
    };
    // Un objet perdu (v1) n'a rien à montrer : son message reste tel quel.
    if found.status == "LOST" {
        return Ok(None);
    }
    let config = app.game_config();
    Ok(
        items::get(&config.pokemon, &found.item_key).map(|item| View {
            emoji: item.emoji.to_owned(),
            label: item.label.to_owned(),
            claimed_by: (found.status == "CLAIMED")
                .then_some(found.claimed_by)
                .flatten(),
        }),
    )
}

#[cfg(test)]
mod tests;
