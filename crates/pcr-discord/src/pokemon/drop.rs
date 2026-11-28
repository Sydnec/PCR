//! Le message public d'un objet au sol et son bouton « Ramasser » (`poke_drop`, v1). Le ramassage est
//! une course à un seul vainqueur, gardée en base : le gagnant réécrit le message (le bouton tombe pour
//! tout le monde), les autres reçoivent un mot en privé. Textes de la v1.

use pcr_app::{
    App,
    error::UseCaseError,
    pokemon::drops::{self, View},
};
use pcr_core::pokemon::drop::Button;
use twilight_model::channel::message::{Component, EmojiReactionType, component::ButtonStyle};
use twilight_util::builder::message::{
    ActionRowBuilder, ButtonBuilder, ContainerBuilder, TextDisplayBuilder,
};

use crate::{
    Ctx,
    interactions::{Edit, Reply},
    public_messages::{RenderFuture, Rendered},
    ui,
};

/// Les couleurs de la v1 : l'or d'un objet à prendre, le gris d'un objet pris.
const OPEN_COLOR: u32 = 0xc2_7c_0e;
const CLAIMED_COLOR: u32 = 0x4f_54_5c;
const READ_FAILED: &str = "❌ Erreur base de données.";

/// Le message d'un objet au sol (`public_messages` de type `drop`).
pub(crate) fn render(app: &App, id: i64) -> RenderFuture<'_> {
    Box::pin(async move {
        Ok(drops::view(app, id).await?.map(|view| Rendered {
            components: components(id, &view),
            ping_roles: Vec::new(),
        }))
    })
}

fn components(id: i64, view: &View) -> Vec<Component> {
    let container = if let Some(user) = view.claimed_by {
        ContainerBuilder::new()
            .accent_color(Some(CLAIMED_COLOR))
            .component(
                TextDisplayBuilder::new(format!(
                    "{} <@{user}> ramasse **{}** !",
                    view.emoji, view.label
                ))
                .build(),
            )
    } else {
        let button = ButtonBuilder::new(ButtonStyle::Success)
            .custom_id(Button { drop: id }.encode())
            .label("Ramasser")
            .emoji(EmojiReactionType::Unicode {
                name: "🤚".to_owned(),
            })
            .build();
        ContainerBuilder::new()
            .accent_color(Some(OPEN_COLOR))
            .component(
                TextDisplayBuilder::new(format!(
                    "{} Il a laissé tomber **{}** !\n*Au plus rapide.*",
                    view.emoji, view.label
                ))
                .build(),
            )
            .component(ActionRowBuilder::new().component(button).build())
    };
    vec![container.build().into()]
}

/// « Ramasser » : la course se tranche en base, puis le clic réécrit son propre message (le worker
/// le réécrira aussi, d'après la base). Une vente d'office ne regarde que le ramasseur : elle part en
/// privé, à la suite.
pub(crate) async fn pick(ctx: &Ctx, user: i64, drop: i64) -> Reply {
    let picked = match drops::claim(&ctx.app, user, drop).await {
        Ok(picked) => picked,
        Err(UseCaseError::Refused(refusal)) => return ui::ephemeral_text(refusal.text()).into(),
        Err(UseCaseError::Db(error)) => {
            tracing::error!(?error, "picking up an item failed");
            return ui::ephemeral_text(READ_FAILED).into();
        }
    };
    let view = View {
        emoji: picked.emoji.clone(),
        label: picked.label.clone(),
        claimed_by: Some(user),
    };
    let message = components(drop, &view);
    match picked.notice {
        None => ui::update_panel(message).into(),
        Some(notice) => {
            let notice = TextDisplayBuilder::new(format!("{} {notice}", picked.emoji)).build();
            Reply::later_update(async move { Ok(Edit::Panels(vec![message, vec![notice.into()]])) })
        }
    }
}
