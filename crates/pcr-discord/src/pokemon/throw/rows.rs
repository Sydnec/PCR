//! Les rangées de boutons des panneaux de lancer : balls ordinaires (offertes ou à leur prix), menu
//! des balls spéciales et leurs chances.

use pcr_app::pokemon::throw::{PanelBall, SpecialMenu};
use pcr_core::{
    format,
    pokemon::{display, spawn, throw::Button},
};
use twilight_model::channel::message::{Component, EmojiReactionType, component::ButtonStyle};
use twilight_util::builder::message::{ActionRowBuilder, ButtonBuilder};

use super::From;
use crate::ui;

fn emoji(text: &str) -> Option<EmojiReactionType> {
    ui::emoji(text)
}

/// Les balls ordinaires du panneau : une ball en poche y est dite offerte et se lance sans jamais
/// prendre de points (`|item`) ; les autres affichent leur prix.
pub(crate) fn ball_row(spawn: i64, balls: &[PanelBall]) -> Component {
    let mut row = ActionRowBuilder::new();
    for ball in balls {
        let held = ball.held.unwrap_or(0);
        let label = if held > 0 {
            format!("{} (offerte ×{})", ball.label, format::number(held))
        } else if let Some(price) = ball.price {
            format!("{} ({})", ball.label, format::number(price))
        } else {
            ball.label.clone()
        };
        let mut button = ButtonBuilder::new(ButtonStyle::Primary)
            .custom_id(
                Button::Rethrow {
                    spawn,
                    ball: ball.key,
                    item: held > 0,
                }
                .encode(),
            )
            .label(label);
        if let Some(emoji) = emoji(&ball.emoji) {
            button = button.emoji(emoji);
        }
        row = row.component(button.build());
    }
    let special = ButtonBuilder::new(ButtonStyle::Secondary)
        .custom_id(Button::Respecial { spawn }.encode())
        .label("Balls spéciales")
        .emoji(EmojiReactionType::Unicode {
            name: "🌟".to_owned(),
        })
        .build();
    row.component(special).build().into()
}

/// Le menu des balls spéciales : la Master Ball (toujours par sa confirmation : à son prix, un
/// mésclic n'est pas rattrapable), puis les balls de la boutique qui servent à cette apparition, et
/// « Retour » dans le panneau. Une lecture ratée grise les boutons.
pub(super) fn special_row(spawn: i64, menu: &SpecialMenu, from: From) -> Component {
    let mut row = ActionRowBuilder::new();
    if let Some(master) = &menu.master {
        let held = master.held.unwrap_or(0);
        let label = if held > 0 {
            format!("{} (offerte ×{})", master.label, format::number(held))
        } else if let Some(price) = master.price {
            format!("{} ({})", master.label, format::number(price))
        } else {
            master.label.clone()
        };
        let id = match from {
            From::Panel => Button::Remaster { spawn }.encode(),
            From::Announcement => Button::Master { spawn }.encode(),
        };
        let mut button = ButtonBuilder::new(ButtonStyle::Danger)
            .custom_id(id)
            .label(label)
            .disabled(menu.failed);
        if let Some(emoji) = emoji(&master.emoji) {
            button = button.emoji(emoji);
        }
        row = row.component(button.build());
    }
    for choice in &menu.choices {
        let id = match from {
            From::Panel => Button::Rethrow {
                spawn,
                ball: choice.key,
                item: false,
            }
            .encode(),
            From::Announcement => spawn::Button::Throw {
                spawn,
                ball: choice.key,
            }
            .encode(),
        };
        let mut button = ButtonBuilder::new(ButtonStyle::Primary)
            .custom_id(id)
            .label(format!(
                "{} (×{})",
                choice.label,
                format::number(choice.usable)
            ))
            .disabled(menu.failed);
        if let Some(emoji) = emoji(&choice.emoji) {
            button = button.emoji(emoji);
        }
        row = row.component(button.build());
    }
    if from == From::Panel {
        row = row.component(
            ButtonBuilder::new(ButtonStyle::Secondary)
                .custom_id(Button::Reback { spawn }.encode())
                .label("Retour")
                .disabled(menu.failed)
                .build(),
        );
    }
    row.build().into()
}

/// Au-dessus du menu : la chance de chaque ball de la boutique en poche contre ce Pokémon, bonus
/// compris. Rien en poche (ou lecture ratée), rien à dire.
pub(super) fn special_text(menu: &SpecialMenu) -> String {
    if menu.failed || menu.choices.is_empty() {
        return String::new();
    }
    let chances: Vec<String> = menu
        .choices
        .iter()
        .map(|choice| {
            format!(
                "{} {} **{}**",
                choice.emoji,
                choice.label,
                display::chance(choice.probability)
            )
        })
        .collect();
    format!("🎯 Tes chances sur ce Pokémon : {}", chances.join(" · "))
}
