//! Aides de réponse. Les panneaux utilisent les composants v2 de Discord (conteneurs, sections,
//! vignettes), et naviguer dans un panneau édite le même message éphémère au lieu d'en poster un autre.

use twilight_model::{
    application::command::CommandOptionChoice,
    channel::message::{Component, MessageFlags},
    http::interaction::InteractionResponse,
    user::User,
};
use twilight_util::builder::interaction_response::{
    AutocompleteBuilder, ChannelMessageBuilder, UpdateMessageBuilder,
};

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

/// Les propositions d'une autocomplétion.
pub fn autocomplete(choices: Vec<CommandOptionChoice>) -> InteractionResponse {
    AutocompleteBuilder::new(choices).build()
}

/// Le nom d'affichage d'un utilisateur Discord (son nom global, à défaut son identifiant de compte),
/// comme `User.displayName` en v1.
pub fn display_name(user: &User) -> &str {
    user.global_name.as_deref().unwrap_or(&user.name)
}

/// L'avatar d'un utilisateur, ou l'avatar par défaut que Discord lui attribue.
pub fn avatar_url(user: &User) -> String {
    if let Some(hash) = user.avatar {
        let extension = if hash.is_animated() { "gif" } else { "png" };
        return format!(
            "https://cdn.discordapp.com/avatars/{}/{hash}.{extension}",
            user.id
        );
    }
    // Les anciens comptes à discriminant gardent leur règle, les nouveaux dérivent de l'id.
    let index = if user.discriminator == 0 {
        (user.id.get() >> 22) % 6
    } else {
        u64::from(user.discriminator % 5)
    };
    format!("https://cdn.discordapp.com/embed/avatars/{index}.png")
}

/// Les mentions d'un texte écrit par un membre et relayé par le bot (sondages, pile ou face) : ses
/// mentions de membres et de rôles appellent, comme en v1, jamais `@everyone` ni `@here`.
pub fn relayed() -> twilight_model::channel::message::AllowedMentions {
    use twilight_model::channel::message::{AllowedMentions, MentionType};
    AllowedMentions {
        parse: vec![MentionType::Users, MentionType::Roles],
        ..AllowedMentions::default()
    }
}
