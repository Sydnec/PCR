//! `/solde [user]` : le solde d'un dresseur et le délai avant ses prochains points. Textes de la v1.
//!
//! Les balls en poche (P4) et le rappel de loterie (P5) s'ajouteront sous le montant ; d'ici là ces
//! lignes sont omises plutôt qu'annoncées vides.

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

use crate::{Ctx, interactions::Reply, ui};

/// La couleur des soldes en v1.
const GOLD: u32 = 0xf1_c4_0f;
const READ_FAILED: &str = "❌ Une erreur est survenue lors de la récupération du solde.";

#[derive(Debug, CommandModel, CreateCommand)]
#[command(name = "solde", desc = "Affiche le solde de points d'un utilisateur")]
pub struct SoldeCommand {
    /// L'utilisateur dont vous voulez voir le solde
    #[command(desc = "L'utilisateur dont vous voulez voir le solde")]
    pub user: Option<User>,
}

pub async fn run(ctx: &Ctx, interaction: &Interaction, data: &CommandData) -> Reply {
    let command = SoldeCommand::from_interaction(CommandInputData::from(data.clone())).ok();
    let Some(target) = command
        .and_then(|command| command.user)
        .or_else(|| interaction.author().cloned())
    else {
        return ui::ephemeral_text(READ_FAILED).into();
    };
    let user = i64::try_from(target.id.get()).unwrap_or(i64::MAX);
    match pcr_app::points::summary(&ctx.app, user).await {
        Ok(summary) => ui::ephemeral_panel(panel(&target, &summary)).into(),
        Err(error) => {
            tracing::error!(?error, "reading a balance failed");
            ui::ephemeral_text(READ_FAILED).into()
        }
    }
}

/// Le destinataire est nommé même quand c'est soi : la commande peut viser un autre dresseur, et
/// deux soldes affichés coup sur coup ne doivent pas pouvoir se confondre.
fn panel(user: &User, summary: &pcr_app::points::Summary) -> Vec<Component> {
    let mut lines = vec![format!(
        "### 💰 Solde de {}\n**{}** points",
        ui::display_name(user),
        format::number(summary.balance)
    )];
    // `next_points_at` n'est jamais dans le passé : `None` veut dire dès maintenant.
    lines.push(match summary.next_points_at {
        Some(at) => format!("⏳ Prochains points : <t:{}:R>", at.as_second()),
        None => "✨ Prochains points : **disponibles**".to_owned(),
    });
    let thumbnail = ThumbnailBuilder::new(UnfurledMediaItem {
        url: ui::avatar_url(user),
        proxy_url: None,
        height: None,
        width: None,
        content_type: None,
    })
    .build();
    let section = SectionBuilder::new(thumbnail)
        .component(TextDisplayBuilder::new(lines.join("\n")).build())
        .build();
    vec![
        ContainerBuilder::new()
            .accent_color(Some(GOLD))
            .component(section)
            .build()
            .into(),
    ]
}
