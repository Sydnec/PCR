//! Le message public d'une apparition, rendu depuis la base à chaque écriture : l'annonce tant que le
//! Pokémon est là (journal des derniers lancers compris), sa capture ou sa fuite ensuite, boutons
//! retirés. Textes de la v1, dont l'embed devient un conteneur.
//!
//! Le rôle Pokémon (et celui du Charme Chroma de sa génération, quand il brille pour ses seuls
//! porteurs) n'est appelé qu'à la publication ; la fin retire la mention, comme la v1 vidait le
//! contenu du message.

use pcr_app::{
    App,
    pokemon::spawn::{self, Status, View},
};
use pcr_core::{
    config::GameConfig,
    format,
    pokemon::{
        capture::{self, has_personal_price},
        display, items,
        spawn::Button,
    },
};
use twilight_model::{
    channel::message::{
        Component,
        component::{ButtonStyle, MediaGallery, MediaGalleryItem, UnfurledMediaItem},
    },
    id::Id,
};
use twilight_util::builder::message::{
    ActionRowBuilder, ButtonBuilder, ContainerBuilder, TextDisplayBuilder,
};

use crate::{
    public_messages::{RenderFuture, Rendered},
    ui,
};

mod end;

/// Le message d'une apparition (`public_messages` de type `spawn`).
pub(crate) fn render(app: &App, id: i64) -> RenderFuture<'_> {
    Box::pin(async move {
        let Some(view) = spawn::view(app, id).await? else {
            return Ok(None);
        };
        let config = app.game_config();
        Ok(match view.spawn.status {
            Status::Active => Some(active(app, &config, &view)),
            Status::Caught => Some(end::ended(&config, &view, true)),
            Status::Fled => Some(end::ended(&config, &view, false)),
            // Une touche de pêche n'a pas de message dans le salon.
            Status::Fishing => None,
        })
    })
}

pub(super) fn media(url: String) -> UnfurledMediaItem {
    UnfurledMediaItem {
        url,
        proxy_url: None,
        height: None,
        width: None,
        content_type: None,
    }
}

/// L'annonce : nom, rareté, type, chances par ball, derniers lancers, image, et les boutons.
fn active(app: &App, config: &GameConfig, view: &View) -> Rendered {
    let spawn = &view.spawn;
    let species = view.species;
    let image = MediaGallery {
        id: None,
        items: vec![MediaGalleryItem {
            description: None,
            media: media(species.sprite_url(spawn.is_shiny, spawn.form.as_deref())),
            spoiler: None,
        }],
    };
    let container = ContainerBuilder::new()
        .accent_color(Some(display::color(species, spawn.is_shiny)))
        .component(TextDisplayBuilder::new(announcement(config, view)).build())
        .component(Component::MediaGallery(image))
        .component(
            TextDisplayBuilder::new(format!("-# Spawn #{} · Pokédex n°{}", spawn.id, species.id))
                .build(),
        )
        .component(ball_row(config, spawn.id))
        .component(info_row(spawn.id));
    let roles = roles(app, view);
    let mut components: Vec<Component> = Vec::new();
    if !roles.is_empty() {
        let mentions: Vec<String> = roles.iter().map(|role| format!("<@&{role}>")).collect();
        components.push(TextDisplayBuilder::new(mentions.join(" ")).build().into());
    }
    components.push(container.build().into());
    Rendered {
        components,
        ping_roles: roles.into_iter().filter_map(Id::new_checked).collect(),
    }
}

/// Le texte de l'annonce : son titre, ce qu'en dit l'administrateur, puis les rubriques de l'embed v1.
fn announcement(config: &GameConfig, view: &View) -> String {
    let spawn = &view.spawn;
    let species = view.species;
    let pokemon = &config.pokemon;
    // Le sexe dans le titre : un symbole, que Discord affiche, et la marque shiny à part.
    let name = display::display_name(species, false, sex(view), spawn.form.as_deref());
    let title = if spawn.is_shiny {
        format!("### ✨ Un {name} SHINY apparaît ! ✨")
    } else {
        format!("### Un {name} sauvage apparaît !")
    };
    // Normal pour tout le salon, shiny pour les porteurs du charme de sa génération : ce sont eux
    // que son rôle a mentionnés.
    let charm = spawn
        .charm_shiny
        .then(|| items::charm_item(pokemon, species.generation))
        .flatten()
        .map(|charm| {
            format!(
                "✨ Il brille pour les porteurs du {} **{}** !",
                charm.emoji, charm.label
            )
        });
    let description: Vec<String> = [spawn.announcement.clone(), charm]
        .into_iter()
        .flatten()
        .collect();
    let catch_rate = u32::try_from(spawn.catch_rate).unwrap_or_default();
    let difficulty = capture::difficulty_of(&pokemon.capture, catch_rate);
    let chances: Vec<String> = capture::probabilities_by_ball(&pokemon.capture, catch_rate)
        .into_iter()
        .filter(|chance| chance.ball.guaranteed != Some(true))
        .map(|chance| {
            format!(
                "{} {}",
                chance.ball.emoji,
                display::chance(chance.probability)
            )
        })
        .collect();
    let mut body = vec![title];
    if !description.is_empty() {
        body.push(description.join("\n\n"));
    }
    body.push(format!(
        "**Rareté** {} {} · **Type** {}",
        view.rarity.icon(),
        view.rarity.label(),
        species.types.join(" / ")
    ));
    body.push(format!(
        "**Difficulté — {}**\n{}",
        difficulty.label,
        chances.join(" · ")
    ));
    body.push(format!(
        "**Lancers ({})**\n{}",
        spawn.throw_count,
        throw_log(config, view)
    ));
    body.join("\n")
}

/// Les rôles que l'annonce appelle : celui du jeu pour les raretés et les shiny, et celui du charme
/// de sa génération quand il brille pour ses porteurs (qui ont aussi le rôle du jeu : qui n'en veut
/// pas n'a ni l'un ni l'autre).
fn roles(app: &App, view: &View) -> Vec<u64> {
    let discord = &app.instance.discord;
    let spawn = &view.spawn;
    [
        spawn
            .pings_role
            .then_some(discord.pokemon_role_id)
            .flatten(),
        spawn
            .charm_shiny
            .then(|| {
                discord
                    .shiny_charm_role_ids
                    .get(&view.species.generation)
                    .copied()
            })
            .flatten(),
    ]
    .into_iter()
    .flatten()
    .collect()
}

pub(super) fn sex(view: &View) -> Option<pcr_core::pokemon::species::Sex> {
    view.spawn
        .sex
        .as_deref()
        .and_then(pcr_core::pokemon::species::Sex::from_code)
}

/// L'icône d'une ball (ordinaire, puis de la boutique), sa clé à défaut.
pub(super) fn ball_emoji<'a>(config: &'a GameConfig, key: &'a str) -> &'a str {
    let capture = &config.pokemon.capture;
    capture
        .special_balls
        .entries()
        .into_iter()
        .find_map(|(k, ball)| (k == key).then_some(ball.emoji.as_str()))
        .or_else(|| capture.balls.get(key).map(|ball| ball.emoji.as_str()))
        .unwrap_or(key)
}

/// Les derniers lancers : une pastille de ball plutôt que son nom, qui se lit d'un coup d'œil.
fn throw_log(config: &GameConfig, view: &View) -> String {
    if view.recent.is_empty() {
        return "*Personne n'a encore tenté sa chance.*".to_owned();
    }
    let lines: Vec<String> = view
        .recent
        .iter()
        .map(|throw| {
            format!(
                "{} <@{}> {}",
                if throw.caught { "✅" } else { "❌" },
                throw.user_id,
                ball_emoji(config, &throw.ball)
            )
        })
        .collect();
    lines.join("\n")
}

/// Les balls ordinaires et leur prix (sauf celui, personnel, de la Master Ball, que sa confirmation
/// donne), puis le menu des balls spéciales.
fn ball_row(config: &GameConfig, spawn: i64) -> Component {
    let mut row = ActionRowBuilder::new();
    for (key, ball) in config.pokemon.capture.balls.entries() {
        if ball.guaranteed == Some(true) {
            continue;
        }
        let label = if has_personal_price(ball) {
            ball.label.clone()
        } else {
            format!("{} ({})", ball.label, format::number(ball.price.into()))
        };
        let mut button = ButtonBuilder::new(ButtonStyle::Primary)
            .custom_id(Button::Throw { spawn, ball: key }.encode())
            .label(label);
        if let Some(emoji) = ui::emoji(&ball.emoji) {
            button = button.emoji(emoji);
        }
        row = row.component(button.build());
    }
    let special = ButtonBuilder::new(ButtonStyle::Secondary)
        .custom_id(Button::Special { spawn }.encode())
        .label("Balls spéciales")
        .emoji(
            twilight_model::channel::message::EmojiReactionType::Unicode {
                name: "🌟".to_owned(),
            },
        )
        .build();
    row.component(special).build().into()
}

/// Un message est le même pour tous ses lecteurs : ce bouton répond à chacun en privé, avec sa
/// collection.
fn info_row(spawn: i64) -> Component {
    let info = ButtonBuilder::new(ButtonStyle::Secondary)
        .custom_id(Button::Info { spawn }.encode())
        .label("Infos du Pokémon")
        .emoji(
            twilight_model::channel::message::EmojiReactionType::Unicode {
                name: "ℹ️".to_owned(),
            },
        )
        .build();
    ActionRowBuilder::new().component(info).build().into()
}
