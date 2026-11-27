//! `/betstats [user]` : ce qu'un membre a misé et gagné aux paris cette année, et les chiffres du
//! serveur. En public, comme en v1. Textes de la v1.

use pcr_app::stats::BetStats;
use pcr_core::format;
use twilight_interactions::command::{CommandInputData, CommandModel, CreateCommand};
use twilight_model::{
    application::interaction::{Interaction, application_command::CommandData},
    channel::message::{Component, component::UnfurledMediaItem},
    user::User,
};
use twilight_util::builder::message::{
    ContainerBuilder, SectionBuilder, TextDisplayBuilder, ThumbnailBuilder,
};

use crate::{
    Ctx,
    interactions::{Edit, Reply},
    ui,
};

/// La couleur des stats en v1.
const BLUE: u32 = 0x00_99_ff;
const READ_FAILED: &str = "Erreur lors de la récupération des stats.";

#[derive(Debug, CommandModel, CreateCommand)]
#[command(name = "betstats", desc = "Affiche les statistiques des paris")]
pub struct BetstatsCommand {
    /// L'utilisateur dont voir les stats (optionnel)
    #[command(desc = "L'utilisateur dont voir les stats (optionnel)")]
    pub user: Option<User>,
}

/// Différé : lire les stats écrit d'abord le tampon de l'année.
pub fn run(ctx: &Ctx, interaction: &Interaction, data: &CommandData) -> Reply {
    let command = BetstatsCommand::from_interaction(CommandInputData::from(data.clone())).ok();
    let Some(target) = command
        .and_then(|command| command.user)
        .or_else(|| interaction.author().cloned())
    else {
        return ui::ephemeral_text(READ_FAILED).into();
    };
    let ctx = ctx.clone();
    Reply::later(false, async move {
        let user = i64::try_from(target.id.get()).unwrap_or(i64::MAX);
        Ok(match pcr_app::bets::stats(&ctx.app, user).await {
            Ok(stats) => Edit::Panel(panel(&target, &stats)),
            Err(error) => {
                tracing::error!(?error, "reading bet stats failed");
                Edit::Text(READ_FAILED.to_owned())
            }
        })
    })
}

fn panel(user: &User, stats: &BetStats) -> Vec<Component> {
    let player = format!(
        "### 📊 Statistiques de Paris : {}\n**👤 Joueur**\n**Total misé :** {} pts\n**Plus gros gain :** {} pts",
        user.name,
        format::number(stats.total_wagered),
        format::number(stats.max_win)
    );
    // Le détenteur du record n'est nommé que s'il y a un record : à zéro, la v1 désignait un
    // membre au hasard parmi ceux qui n'avaient rien gagné.
    let holder = stats
        .record_holder
        .map(|holder| format!(" (<@{holder}>)"))
        .unwrap_or_default();
    let server = format!(
        "**🌍 Serveur**\n**Volume total misé :** {} pts\n**Record de gain :** {} pts{holder}",
        format::number(stats.server_wagered),
        format::number(stats.server_max_win)
    );
    let thumbnail = ThumbnailBuilder::new(UnfurledMediaItem {
        url: ui::avatar_url(user),
        proxy_url: None,
        height: None,
        width: None,
        content_type: None,
    })
    .build();
    vec![
        ContainerBuilder::new()
            .accent_color(Some(BLUE))
            .component(
                SectionBuilder::new(thumbnail)
                    .component(TextDisplayBuilder::new(player).build())
                    .build(),
            )
            .component(TextDisplayBuilder::new(server).build())
            .build()
            .into(),
    ]
}
