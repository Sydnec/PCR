//! Aides de réponse. Les panneaux utilisent les composants v2 de Discord (conteneurs, sections,
//! vignettes), et naviguer dans un panneau édite le même message éphémère au lieu d'en poster un autre.

use twilight_model::{
    channel::message::{Component, MessageFlags},
    http::interaction::InteractionResponse,
};
use twilight_util::builder::interaction_response::{ChannelMessageBuilder, UpdateMessageBuilder};

/// Un nouveau panneau personnel, visible du seul utilisateur qui a cliqué ou tapé.
pub fn ephemeral_panel(components: Vec<Component>) -> InteractionResponse {
    ChannelMessageBuilder::new()
        .components(components)
        .flags(MessageFlags::EPHEMERAL | MessageFlags::IS_COMPONENTS_V2)
        .build()
}

/// Remplace le panneau auquel appartient le composant cliqué.
pub fn update_panel(components: Vec<Component>) -> InteractionResponse {
    UpdateMessageBuilder::new().components(components).build()
}

/// Une simple réponse texte éphémère (refus, erreurs).
pub fn ephemeral_text(text: impl Into<String>) -> InteractionResponse {
    ChannelMessageBuilder::new()
        .content(text)
        .flags(MessageFlags::EPHEMERAL)
        .build()
}
