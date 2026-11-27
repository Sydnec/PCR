//! La fin d'une apparition sur son message : la capture, annoncée par la ball qui l'a emportée, ou
//! la fuite, avec les participants et les points partis en fumée. Boutons et mention retirés.

use pcr_app::pokemon::spawn::{Spending, View};
use pcr_core::{
    config::GameConfig,
    format,
    pokemon::{display, items},
};
use twilight_util::builder::message::{
    ContainerBuilder, SectionBuilder, TextDisplayBuilder, ThumbnailBuilder,
};

use super::{ball_emoji, media, sex};
use crate::public_messages::Rendered;

/// La couleur d'une fuite (gris de la v1).
const FLED_COLOR: u32 = 0x4f_54_5c;
/// Participants nommés à la fin ; les suivants sont comptés.
const PARTICIPANTS_SHOWN: usize = 5;
const MEDALS: [&str; 3] = ["🥇", "🥈", "🥉"];

/// La capture (annoncée par la ball qui l'a emportée, son vainqueur nommé dans la même ligne) ou la
/// fuite, avec les participants. Tout ce qui porte un emoji du serveur ou une mention est hors du
/// titre, où Discord ne les rendrait pas.
pub(super) fn ended(config: &GameConfig, view: &View, caught: bool) -> Rendered {
    let spawn = &view.spawn;
    let species = view.species;
    // Capturé par un porteur du Charme Chroma : c'est un shiny qui a rejoint sa boîte.
    let charmed = caught && spawn.charm_shiny && spawn.is_shiny;
    let name = display::display_name(species, spawn.is_shiny, sex(view), spawn.form.as_deref());
    let heading = if caught {
        let ball = spawn
            .caught_ball
            .as_deref()
            .map_or("", |key| ball_emoji(config, key));
        let winner = spawn
            .caught_by
            .map_or_else(String::new, |user| format!("<@{user}>"));
        let charm = charmed
            .then(|| items::charm_item(&config.pokemon, species.generation))
            .flatten();
        let end = charm.map_or_else(
            || " !".to_owned(),
            |charm| {
                format!(
                    ", et il brillait grâce à son {} **{}** !",
                    charm.emoji, charm.label
                )
            },
        );
        format!("{ball} **{name}** a été capturé par {winner}{end}")
    } else {
        format!("### 💨 {name} s'est enfui...\nPersonne n'a réussi à le capturer à temps.")
    };
    let mut body = vec![format!("**Lancers** {}", spawn.throw_count)];
    if let Some(item) = spawn
        .held_item
        .as_deref()
        .and_then(|key| items::get(&config.pokemon, key))
    {
        // Trois états, et le troisième compte : dire « il emporte » d'un objet qui gît dans le salon,
        // bouton compris, ferait renoncer à le ramasser.
        let verb = match (view.dropped, caught) {
            (true, _) => "Il a lâché",
            (false, true) => "Il tenait",
            (false, false) => "Et il emporte",
        };
        body.push(format!("**{verb}** {} **{}**", item.emoji, item.label));
    }
    body.push(format!(
        "**Participants**\n{}",
        participants(config, &view.spending)
    ));
    let thumbnail = ThumbnailBuilder::new(media(
        species.sprite_url(spawn.is_shiny, spawn.form.as_deref()),
    ))
    .build();
    let color = if caught {
        display::color(species, spawn.is_shiny)
    } else {
        FLED_COLOR
    };
    let container = ContainerBuilder::new()
        .accent_color(Some(color))
        .component(
            SectionBuilder::new(thumbnail)
                .component(TextDisplayBuilder::new(heading).build())
                .build(),
        )
        .component(TextDisplayBuilder::new(body.join("\n")).build())
        // Le total reste visible : c'est la mesure du puits, raison d'être du système.
        .component(
            TextDisplayBuilder::new(format!(
                "-# Spawn #{} · Pokédex n°{} · {} pts partis en fumée",
                spawn.id,
                species.id,
                format::number(view.spending.burned)
            ))
            .build(),
        );
    Rendered {
        components: vec![container.build().into()],
        ping_roles: Vec::new(),
    }
}

/// Qui a lancé quoi : le plus investi d'abord, médailles comprises, coupé aux cinq premiers.
fn participants(config: &GameConfig, spending: &Spending) -> String {
    if spending.participants.is_empty() {
        return "*Personne n'a tenté sa chance.*".to_owned();
    }
    // L'ordre du catalogue, de la moins chère à la plus chère : la ligne se lit toujours dans le
    // même sens d'un dresseur à l'autre.
    let capture = &config.pokemon.capture;
    let order: Vec<&str> = capture
        .balls
        .entries()
        .into_iter()
        .map(|(key, _)| key)
        .chain(
            capture
                .special_balls
                .entries()
                .into_iter()
                .map(|(key, _)| key),
        )
        .collect();
    let mut lines: Vec<String> = spending
        .participants
        .iter()
        .take(PARTICIPANTS_SHOWN)
        .enumerate()
        .map(|(rank, participant)| {
            let mut balls: Vec<&(String, i64)> =
                participant.balls.iter().filter(|(_, n)| *n > 0).collect();
            balls.sort_by_key(|(key, _)| order.iter().position(|k| k == key).unwrap_or(usize::MAX));
            let balls: Vec<String> = balls
                .iter()
                .map(|(key, count)| format!("{count}×{}", ball_emoji(config, key)))
                .collect();
            format!(
                "{} <@{}> ({})",
                MEDALS.get(rank).copied().unwrap_or("▪️"),
                participant.user_id,
                balls.join(" ")
            )
        })
        .collect();
    let rest = spending
        .participants
        .len()
        .saturating_sub(PARTICIPANTS_SHOWN);
    if rest > 0 {
        lines.push(format!(
            "*et {rest} autre{}*",
            if rest > 1 { "s" } else { "" }
        ));
    }
    lines.join("\n")
}
