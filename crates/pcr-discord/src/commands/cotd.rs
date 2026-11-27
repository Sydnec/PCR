//! `/cotd` : les saints et les fêtes du jour, en privé (`pcr_app::cotd`).

use twilight_interactions::command::{CommandModel, CreateCommand};

use crate::{
    Ctx,
    bets::render::clip,
    interactions::{Edit, Reply},
};

/// La v1 laissait l'interaction sans réponse quand le site ne répondait pas.
const FAILED: &str = "❌ Impossible de récupérer les saints du jour.";

#[derive(Debug, CommandModel, CreateCommand)]
#[command(name = "cotd", desc = "Affiche les saints du jour")]
pub struct CotdCommand;

/// Différé : deux pages à lire sur le web.
pub fn run(ctx: &Ctx) -> Reply {
    let web = ctx.web.clone();
    Reply::later(true, async move {
        Ok(Edit::Text(match pcr_app::cotd::today(&*web).await {
            Ok(Some(text)) => clip(&text, 2000),
            Ok(None) => FAILED.to_owned(),
            Err(error) => {
                tracing::warn!(%error, "saints of the day unavailable");
                FAILED.to_owned()
            }
        }))
    })
}
