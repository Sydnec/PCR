//! Les messages publics d'un pari, rendus depuis la base : le pari (réécrit à chaque mise, à sa
//! clôture, à son annulation, à sa résolution) et son résultat. Textes de la v1, dont les embeds
//! deviennent des conteneurs.
//!
//! Les montants en points sont au format français ; les estimations et le résultat restent tels que
//! tapés (une année n'a pas de séparateur de milliers).

use pcr_app::{
    App,
    bets::{self, Status, View},
};
use pcr_core::{
    bets::{self as rules, Action},
    format,
};
use twilight_model::{
    channel::message::{Component, component::ButtonStyle},
    id::Id,
};
use twilight_util::builder::message::{
    ActionRowBuilder, ButtonBuilder, ContainerBuilder, TextDisplayBuilder,
};

use crate::public_messages::{RenderFuture, Rendered};

/// Couleurs des embeds de la v1.
const GREEN: u32 = 0x00_ff_00;
const TEAL: u32 = 0x00_ff_aa;
const ORANGE: u32 = 0xff_a5_00;
const RED: u32 = 0xff_00_00;
const GOLD: u32 = 0xff_d7_00;
/// Gagnants nommés dans le résultat ; les suivants sont seulement comptés.
const NAMED_WINNERS: usize = 3;
/// Longueur d'un libellé de bouton que Discord accepte.
const BUTTON_LABEL: usize = 80;
/// Place laissée à la liste des estimations dans le message du pari.
const PARTICIPATIONS: usize = 3_000;

/// Le message du pari (`public_messages` de type `bet`).
pub(crate) fn bet(app: &App, id: i64) -> RenderFuture<'_> {
    Box::pin(async move {
        let Some(view) = bets::view(app, id).await? else {
            return Ok(None);
        };
        Ok(Some(bet_message(&view, app.instance.discord.bet_role_id)))
    })
}

/// Le message du résultat (`bet_result`).
pub(crate) fn result(app: &App, id: i64) -> RenderFuture<'_> {
    Box::pin(async move {
        let Some(view) = bets::view(app, id).await? else {
            return Ok(None);
        };
        Ok(result_message(&view))
    })
}

/// Le pari dans son état. `role` : appelé à la création, et sa mention reste en tête du message,
/// comme le contenu du message v1 que les modifications de l'embed ne touchaient pas.
pub(crate) fn bet_message(view: &View, role: Option<u64>) -> Rendered {
    let bet = &view.bet;
    let (title, color) = match (bet.status, bet.is_estimation) {
        (Status::Cancelled, _) => (format!("🚫 PARI ANNULÉ: {}", bet.title), RED),
        (Status::Locked, _) => (format!("🔒 PARI CLOS: {}", bet.title), ORANGE),
        (_, true) => (
            format!("Nouveau Pari d'Estimation #{}: {}", bet.id, bet.title),
            TEAL,
        ),
        (_, false) => (format!("Nouveau Pari #{}: {}", bet.id, bet.title), GREEN),
    };
    let description = match (bet.status, bet.is_estimation) {
        (Status::Cancelled, _) => {
            "Ce pari a été annulé par son créateur. Toutes les mises ont été remboursées."
                .to_owned()
        }
        (_, true) => estimates(view),
        (_, false) => options(view),
    };
    let mut container = ContainerBuilder::new()
        .accent_color(Some(color))
        .component(TextDisplayBuilder::new(format!("### {title}\n{description}")).build())
        .component(TextDisplayBuilder::new(format!("-# Créé par <@{}>", bet.creator_id)).build());
    if bet.status == Status::Open {
        container = container.component(join_row(view));
    }
    if bet.status.is_pending() {
        let resolve = ButtonBuilder::new(ButtonStyle::Secondary)
            .custom_id(Action::ResolveForm { bet: bet.id }.encode())
            .label("Déclarer le résultat")
            .build();
        container = container.component(ActionRowBuilder::new().component(resolve).build());
    }
    let mut components: Vec<Component> = Vec::new();
    if let Some(role) = role {
        components.push(
            TextDisplayBuilder::new(format!("<@&{role}>"))
                .build()
                .into(),
        );
    }
    components.push(container.build().into());
    Rendered {
        components,
        ping_roles: role.and_then(Id::new_checked).into_iter().collect(),
    }
}

/// Les options, puis leur part de la cagnotte dès la première mise.
fn options(view: &View) -> String {
    let mut text =
        String::from("Cliquez sur les boutons ci-dessous pour participer !\n\n**Options:**\n");
    if view.participations.is_empty() {
        let list: Vec<String> = view
            .options
            .iter()
            .map(|(index, label)| format!("{index}. {label}"))
            .collect();
        text.push_str(&list.join("\n"));
        return text;
    }
    let total = view.pool();
    let lines: Vec<String> = view
        .options
        .iter()
        .map(|(index, label)| {
            let amount = view.staked_on(*index);
            let percent = rules::percent(amount, total);
            format!(
                "{index}. {label}\n{} **{percent}%** ({} pts)",
                bar(percent),
                format::number(amount)
            )
        })
        .collect();
    text.push_str(&lines.join("\n\n"));
    text
}

/// Les estimations posées, avec leur mise.
fn estimates(view: &View) -> String {
    let mut text = String::from(
        "Cliquez sur le bouton ci-dessous pour proposer votre estimation !\n\
         Le gagnant sera celui qui sera le plus proche du résultat.\n\n**Participations:**\n",
    );
    if view.participations.is_empty() {
        text.push_str("(Aucune pour le moment)");
        return text;
    }
    let lines: Vec<String> = view
        .participations
        .iter()
        .filter_map(|p| {
            Some(format!(
                "<@{}> : **{}** ({} pts)",
                p.user_id,
                p.prediction?,
                format::number(p.amount)
            ))
        })
        .collect();
    // Un message ne dépasse pas 4 000 caractères : une très longue liste se coupe plutôt que de
    // bloquer toute réécriture du pari.
    text.push_str(&clip(&lines.join("\n"), PARTICIPATIONS));
    text
}

fn join_row(view: &View) -> Component {
    let bet = view.bet.id;
    let mut row = ActionRowBuilder::new();
    if view.bet.is_estimation {
        row = row.component(
            ButtonBuilder::new(ButtonStyle::Primary)
                .custom_id(Action::EstimateJoin { bet }.encode())
                .label("Proposer une estimation")
                .build(),
        );
    } else {
        for (index, label) in &view.options {
            row = row.component(
                ButtonBuilder::new(ButtonStyle::Primary)
                    .custom_id(
                        Action::Join {
                            bet,
                            option: *index,
                        }
                        .encode(),
                    )
                    .label(clip(&format!("{index}. {label}"), BUTTON_LABEL))
                    .build(),
            );
        }
    }
    row.build().into()
}

/// Le résultat d'un pari fermé ; rien pour un pari qui ne l'est pas.
pub(crate) fn result_message(view: &View) -> Option<Rendered> {
    let bet = &view.bet;
    if bet.status != Status::Closed {
        return None;
    }
    let components = match (bet.winning_option, bet.estimate_result) {
        (Some(winner), _) => classic_result(view, winner),
        (None, Some(result)) => estimate_result(view, result),
        (None, None) => return None,
    };
    Some(Rendered {
        components,
        ping_roles: Vec::new(),
    })
}

fn classic_result(view: &View, winner: i64) -> Vec<Component> {
    let label = view
        .label(winner)
        .map_or_else(|| format!("Option {winner}"), str::to_owned);
    let total = view.pool();
    let stats: Vec<String> = view
        .options
        .iter()
        .map(|(index, option)| {
            let amount = view.staked_on(*index);
            let percent = rules::percent(amount, total);
            let icon = if *index == winner { "✅" } else { "❌" };
            format!(
                "{icon} **{option}** : {percent}% ({} pts)\n{}",
                format::number(amount),
                bar(percent)
            )
        })
        .collect();
    let gains = view.gains();
    let winners = if gains.is_empty() {
        "Personne n'avait parié sur cette option. La banque gagne tout ! 💸".to_owned()
    } else {
        let mentions: Vec<String> = gains
            .iter()
            .take(NAMED_WINNERS)
            .map(|gain| format!("<@{}>", gain.user))
            .collect();
        let others = gains.len().saturating_sub(NAMED_WINNERS);
        let who = if others > 0 {
            format!("{} et {others} autres", mentions.join(", "))
        } else {
            mentions.join(", ")
        };
        format!(
            "{who} se répartissent **{}** points !",
            format::number(total)
        )
    };
    vec![
        ContainerBuilder::new()
            .accent_color(Some(GOLD))
            .component(
                TextDisplayBuilder::new(format!(
                    "### Résultat du pari : {}\nLa réponse gagnante est ... || **{label}** || !",
                    view.bet.title
                ))
                .build(),
            )
            .component(
                TextDisplayBuilder::new(format!("**Statistiques**\n{}", stats.join("\n\n")))
                    .build(),
            )
            .component(TextDisplayBuilder::new(format!("**Gagnants**\n{winners}")).build())
            .build()
            .into(),
    ]
}

fn estimate_result(view: &View, result: i64) -> Vec<Component> {
    let title = &view.bet.title;
    if view.participations.is_empty() {
        return vec![
            TextDisplayBuilder::new(format!(
                "Le pari **\"{title}\"** est terminé ! La réponse était **{result}**. Aucun participant."
            ))
            .build()
            .into(),
        ];
    }
    // La v1 répétait la bonne réponse (« La réponse correcte était… ») sous la première phrase.
    let lines: Vec<String> = view
        .gains()
        .iter()
        .map(|gain| {
            let prediction = gain.prediction.unwrap_or_default();
            format!(
                "<@{}> gagne **{}** points (Estimé: {prediction}, Diff: {})",
                gain.user,
                format::number(gain.gain),
                prediction.abs_diff(result)
            )
        })
        .collect();
    vec![
        ContainerBuilder::new()
            .accent_color(Some(GOLD))
            .component(
                TextDisplayBuilder::new(format!(
                    "### Résultat: {title}\nLa bonne réponse était **{result}**.\n\n{}",
                    lines.join("\n")
                ))
                .build(),
            )
            .component(
                TextDisplayBuilder::new(format!(
                    "-# Total en jeu: {} points",
                    format::number(view.pool())
                ))
                .build(),
            )
            .build()
            .into(),
    ]
}

/// La barre de 10 cases d'un pourcentage.
fn bar(percent: i64) -> String {
    let filled = usize::try_from(rules::filled_cells(percent)).unwrap_or(0);
    let cells = usize::try_from(rules::BAR_CELLS).unwrap_or(0);
    format!("{}{}", "🟩".repeat(filled), "⬛".repeat(cells - filled))
}

/// Coupe un texte trop long pour Discord (en caractères), avec une ellipse.
pub(crate) fn clip(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_owned();
    }
    let mut out: String = text.chars().take(max.saturating_sub(1)).collect();
    out.push('…');
    out
}
