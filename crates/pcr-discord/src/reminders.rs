//! Rappels côté Discord : la réponse publique de `/rappel` et son bouton « Me rappeler aussi »
//! (`rappel|…`, décodable depuis la v1), et les panneaux de `/mesrappels`. Textes de la v1.

use pcr_app::{error::UseCaseError, reminders::Created};
use twilight_model::{
    application::interaction::Interaction,
    channel::message::{Component, EmojiReactionType, component::ButtonStyle},
};
use twilight_util::builder::message::{
    ActionRowBuilder, ButtonBuilder, ContainerBuilder, TextDisplayBuilder,
};

use crate::{
    Ctx,
    interactions::{Edit, Reply},
};

/// Le préfixe des boutons de rappel.
pub const PREFIX: &str = "rappel|";
pub const FAILED: &str = "❌ Une erreur est survenue lors de la création du rappel.";
const GREEN: u32 = 0x00_ff_00;

/// « <t:…:R> » et « <t:…:F> » : Discord les affiche dans le fuseau de chacun.
pub fn relative(at_ms: i64) -> String {
    format!("<t:{}:R>", at_ms.div_euclid(1000))
}

pub fn full(at_ms: i64) -> String {
    format!("<t:{}:F>", at_ms.div_euclid(1000))
}

/// Le panneau d'un rappel posé : `public`, la réponse à `/rappel` (avec le bouton) ; sinon la
/// confirmation privée d'un clic sur le bouton.
pub fn created_panel(created: &Created, user: i64, public: bool) -> Vec<Component> {
    let at_ms = created.trigger_at.as_millisecond();
    let header = if public {
        format!(
            "### ✅ Rappel créé !\n<@{user}> recevra un rappel {}",
            relative(at_ms)
        )
    } else {
        format!(
            "### ✅ Rappel créé !\nJe te rappellerai {}",
            relative(at_ms)
        )
    };
    let footer = if public {
        "-# Clique sur le bouton ci-dessous pour créer le même rappel pour toi !"
    } else {
        "-# Tu recevras un DM à l'heure prévue"
    };
    let mut container = ContainerBuilder::new()
        .accent_color(Some(GREEN))
        .component(TextDisplayBuilder::new(header).build())
        .component(
            TextDisplayBuilder::new(format!(
                "**📝 Message**\n{}\n**📅 Date**\n{}",
                created.message,
                full(at_ms)
            ))
            .build(),
        )
        .component(TextDisplayBuilder::new(footer).build());
    if public {
        let button = ButtonBuilder::new(ButtonStyle::Primary)
            .custom_id(created.button.clone())
            .label("Me rappeler aussi")
            .emoji(EmojiReactionType::Unicode {
                name: "🔔".to_owned(),
            })
            .build();
        container = container.component(ActionRowBuilder::new().component(button).build());
    }
    vec![container.build().into()]
}

/// Un refus se dit, une panne se journalise.
pub fn failure(error: UseCaseError, failed: &str) -> Edit {
    match error {
        UseCaseError::Refused(refusal) => Edit::Text(refusal.text().to_owned()),
        UseCaseError::Db(error) => {
            tracing::error!(?error, "reminder action failed");
            Edit::Text(failed.to_owned())
        }
    }
}

/// Le bouton « Me rappeler aussi » : le même rappel, pour celui qui clique, en privé.
pub fn button(ctx: &Ctx, interaction: &Interaction, custom_id: &str) -> Reply {
    let app = ctx.app.clone();
    let custom_id = custom_id.to_owned();
    let user = interaction.author_id().map(|id| crate::id(id.get()));
    let channel = interaction
        .channel
        .as_ref()
        .map_or(0, |channel| crate::id(channel.id.get()));
    Reply::later(true, async move {
        let Some(user) = user else {
            return Ok(Edit::Text(FAILED.to_owned()));
        };
        Ok(
            match pcr_app::reminders::copy(&app, user, channel, &custom_id).await {
                Ok(created) => Edit::Panel(created_panel(&created, user, false)),
                Err(error) => failure(error, FAILED),
            },
        )
    })
}
