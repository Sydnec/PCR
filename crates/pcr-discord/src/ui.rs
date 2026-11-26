//! Response helpers. Panels use Discord's components v2 (containers, sections, thumbnails), and
//! navigating a panel edits the same ephemeral message instead of posting a new one.

use twilight_model::{
    channel::message::{Component, MessageFlags},
    http::interaction::InteractionResponse,
};
use twilight_util::builder::interaction_response::{ChannelMessageBuilder, UpdateMessageBuilder};

/// A new personal panel, visible only to the user who clicked or typed.
pub fn ephemeral_panel(components: Vec<Component>) -> InteractionResponse {
    ChannelMessageBuilder::new()
        .components(components)
        .flags(MessageFlags::EPHEMERAL | MessageFlags::IS_COMPONENTS_V2)
        .build()
}

/// Replaces the panel the clicked component belongs to.
pub fn update_panel(components: Vec<Component>) -> InteractionResponse {
    UpdateMessageBuilder::new().components(components).build()
}

/// A plain ephemeral text answer (refusals, errors).
pub fn ephemeral_text(text: impl Into<String>) -> InteractionResponse {
    ChannelMessageBuilder::new()
        .content(text)
        .flags(MessageFlags::EPHEMERAL)
        .build()
}
