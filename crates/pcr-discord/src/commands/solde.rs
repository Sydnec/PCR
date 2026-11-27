//! `/solde [user]` : le solde d'un dresseur, le délai avant ses prochains points et ses balls en
//! poche (une ball en poche se lance sans toucher au solde). Textes de la v1. Le même panneau suit la
//! fiche d'une apparition. Le rappel de loterie (P5) s'ajoutera sous le montant.

use pcr_app::pokemon::items::BallStock;
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
    let summary = match pcr_app::points::summary(&ctx.app, user).await {
        Ok(summary) => summary,
        Err(error) => {
            tracing::error!(?error, "reading a balance failed");
            return ui::ephemeral_text(READ_FAILED).into();
        }
    };
    // Un sac illisible n'empêche pas de donner le solde : la ligne des balls est omise plutôt que
    // d'en annoncer zéro.
    let balls = pcr_app::pokemon::items::ball_stock(&ctx.app, user)
        .await
        .inspect_err(|error| tracing::warn!(?error, "reading balls for /solde failed"))
        .ok();
    // Le destinataire est nommé même quand c'est soi : la commande peut viser un autre dresseur, et
    // deux soldes affichés coup sur coup ne doivent pas pouvoir se confondre.
    let panel = panel(&Wallet {
        title: format!("Solde de {}", ui::display_name(&target)),
        avatar: Some(ui::avatar_url(&target)),
        points: summary.balance,
        next_points: Some(
            summary
                .next_points_at
                .map_or(NextPoints::Now, |at| NextPoints::At(at.as_second())),
        ),
        balls: balls.as_deref(),
    });
    ui::ephemeral_panel(vec![panel]).into()
}

/// Ce que montre un panneau de solde.
pub(crate) struct Wallet<'a> {
    /// « Ton solde » sous une apparition, où le solde ne peut être que celui du cliqueur.
    pub title: String,
    pub avatar: Option<String>,
    pub points: i64,
    /// Le prochain gain ; `None` : la ligne est omise (la fiche d'une apparition n'en parle pas).
    pub next_points: Option<NextPoints>,
    /// Les balls en poche ; `None` : non lues, la liste est omise.
    pub balls: Option<&'a [BallStock]>,
}

/// Quand un message rapportera de nouveau des points.
#[derive(Debug, Clone, Copy)]
pub(crate) enum NextPoints {
    Now,
    /// En secondes Unix.
    At(i64),
}

/// Tout tient sous le montant : c'est une seule réponse (de quoi lancer), pas des rubriques à
/// parcourir.
pub(crate) fn panel(wallet: &Wallet<'_>) -> Component {
    let mut lines = vec![format!(
        "### 💰 {}\n**{}** points",
        wallet.title,
        format::number(wallet.points)
    )];
    match wallet.next_points {
        Some(NextPoints::At(at)) => lines.push(format!("⏳ Prochains points : <t:{at}:R>")),
        Some(NextPoints::Now) => lines.push("✨ Prochains points : **disponibles**".to_owned()),
        None => {}
    }
    if let Some(balls) = wallet.balls {
        lines.push(String::new());
        if balls.is_empty() {
            lines.push("*Aucune ball en poche.*".to_owned());
        }
        for ball in balls {
            lines.push(format!(
                "{} {} **×{}**",
                ball.emoji,
                ball.label,
                format::number(ball.count)
            ));
        }
    }
    let text = TextDisplayBuilder::new(lines.join("\n")).build();
    let container = ContainerBuilder::new().accent_color(Some(GOLD));
    let container = match &wallet.avatar {
        Some(url) => {
            let thumbnail = ThumbnailBuilder::new(UnfurledMediaItem {
                url: url.clone(),
                proxy_url: None,
                height: None,
                width: None,
                content_type: None,
            })
            .build();
            container.component(SectionBuilder::new(thumbnail).component(text).build())
        }
        None => container.component(text),
    };
    container.build().into()
}
