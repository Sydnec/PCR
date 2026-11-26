//! `/classement` : les plus gros soldes du serveur, en public. Textes de la v1.

use pcr_core::format;
use twilight_interactions::command::{CommandModel, CreateCommand};
use twilight_model::id::Id;
use twilight_util::builder::message::{ContainerBuilder, TextDisplayBuilder};

use crate::{
    Ctx,
    interactions::{Edit, Reply},
};

const GOLD: u32 = 0xff_d7_00;
const MEDALS: [&str; 3] = ["🥇", "🥈", "🥉"];

#[derive(Debug, CommandModel, CreateCommand)]
#[command(
    name = "classement",
    desc = "Affiche le classement des utilisateurs avec le plus de points"
)]
pub struct ClassementCommand;

/// Différé : retrouver le pseudo de dix dresseurs demande dix appels à Discord.
pub fn run(ctx: &Ctx) -> Reply {
    let ctx = ctx.clone();
    Reply::later(false, async move {
        let rows = match pcr_app::points::leaderboard(&ctx.app).await {
            Ok(rows) => rows,
            Err(error) => {
                tracing::error!(?error, "reading the leaderboard failed");
                return Ok(Edit::Text(
                    "Une erreur est survenue lors de la récupération du classement.".to_owned(),
                ));
            }
        };
        if rows.is_empty() {
            return Ok(Edit::Text(
                "Aucun point n'a encore été distribué.".to_owned(),
            ));
        }
        let mut lines = Vec::with_capacity(rows.len());
        for (rank, (user, balance)) in rows.into_iter().enumerate() {
            let medal = MEDALS
                .get(rank)
                .map_or_else(|| format!("{}.", rank + 1), |medal| (*medal).to_owned());
            lines.push(format!(
                "{medal} {} - {} points",
                name(&ctx, user).await,
                format::number(balance)
            ));
        }
        let text = format!("### 🏆 Classement des points\n{}", lines.join("\n"));
        Ok(Edit::Panel(vec![
            ContainerBuilder::new()
                .accent_color(Some(GOLD))
                .component(TextDisplayBuilder::new(text).build())
                .build()
                .into(),
        ]))
    })
}

/// Le pseudo en gras ; un compte que Discord ne retrouve plus (parti, supprimé) reste désigné par sa
/// mention, que Discord affiche comme il peut, plutôt que par un numéro.
async fn name(ctx: &Ctx, user: i64) -> String {
    let Some(id) = u64::try_from(user).ok().and_then(Id::new_checked) else {
        return format!("<@{user}>");
    };
    match ctx.http.user(id).await {
        Ok(response) => match response.model().await {
            Ok(found) => format!("**{}**", found.name),
            Err(_) => format!("<@{user}>"),
        },
        Err(_) => format!("<@{user}>"),
    }
}
