//! `/admin restart` : le bot s'arrête proprement (tâches finies, stats écrites, base fermée) et le
//! service (`Restart=always`) le relance. Texte de la v1.

use std::time::Duration;

use twilight_interactions::command::{CommandModel, CreateCommand};

use crate::{
    Ctx,
    interactions::{Edit, Reply},
};

/// La réponse a le temps de partir avant que l'arrêt ne commence.
const GRACE: Duration = Duration::from_secs(2);

#[derive(Debug, CommandModel, CreateCommand)]
#[command(name = "restart", desc = "Redémarre le bot")]
pub struct RestartCommand;

pub fn run(ctx: &Ctx, admin: u64) -> Reply {
    let app = ctx.app.clone();
    tracing::warn!(admin, "/admin restart");
    tokio::spawn(async move {
        tokio::time::sleep(GRACE).await;
        app.request_restart();
    });
    Reply::later(true, async move {
        Ok(Edit::Text("Redémarrage en cours...".to_owned()))
    })
}
