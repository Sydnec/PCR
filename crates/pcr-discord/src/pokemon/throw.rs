//! Les panneaux de lancer : la réponse privée à un lancer porte elle-même les balls et se réécrit à
//! chaque jet, au lieu d'empiler un message par lancer. Messages classiques (un texte et une rangée de
//! boutons), comme en v1 : un refus qui croise une capture peut réécrire le seul texte sans toucher
//! aux boutons. Textes de la v1.
//!
//! Un clic sur l'annonce ouvre un nouveau panneau et fait disparaître le précédent : un dresseur n'en
//! a jamais qu'un ouvert (`Panels`, un cache d'interface).

use std::{collections::HashMap, sync::Arc};

use pcr_app::{
    App,
    pokemon::{
        charms,
        throw::{self, Thrown},
    },
};
use pcr_core::{
    format,
    pokemon::throw::{Button, Outcome, Promise},
};
use twilight_model::{
    application::interaction::Interaction, channel::message::component::ButtonStyle,
};
use twilight_util::builder::message::{ActionRowBuilder, ButtonBuilder};

use super::READ_FAILED;
use crate::{
    Ctx,
    interactions::{Edit, Reply},
    ui,
};

mod rows;

use rows::{ball_row, special_row, special_text};

/// Le panneau ouvert de chaque dresseur : le jeton de son interaction (seul moyen de toucher un
/// éphémère) et l'apparition qu'il vise.
pub type Panels = Arc<std::sync::Mutex<HashMap<i64, (String, i64)>>>;

/// D'où vient le clic : l'annonce publique ouvre un nouveau panneau, le panneau se réécrit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum From {
    Announcement,
    Panel,
}

/// Retient le panneau de `user`. Depuis l'annonce, le précédent est supprimé (au mieux : un jeton
/// expiré laisse simplement deux messages). Depuis un vieux panneau visant une autre apparition, on
/// ne touche à rien : le plus récent reste sa référence.
fn track(ctx: &Ctx, interaction: &Interaction, user: i64, spawn: i64, from: From) {
    let previous = {
        let mut panels = ctx
            .panels
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let previous = panels.get(&user).cloned();
        if from == From::Panel && previous.as_ref().is_some_and(|(_, s)| *s != spawn) {
            return;
        }
        panels.insert(user, (interaction.token.clone(), spawn));
        previous
    };
    if from == From::Announcement
        && let Some((token, _)) = previous
    {
        let http = Arc::clone(&ctx.http);
        let application = ctx.application_id;
        tokio::spawn(async move {
            let _ = http.interaction(application).delete_response(&token).await;
        });
    }
}

/// Un lancer, depuis l'annonce (`poke_throw`) ou le panneau (`poke_rethrow`, `poke_master_ok`). Le
/// tirage part sans attendre l'accusé de Discord : l'attendre ajouterait un aller-retour que le
/// site n'a pas, et dans une course au même Pokémon le clic Discord partirait perdant.
pub(crate) fn throw(
    ctx: &Ctx,
    interaction: &Interaction,
    user: i64,
    spawn: i64,
    ball: &str,
    promise: Promise,
    from: From,
) -> Reply {
    let app = ctx.app.clone();
    let ball = ball.to_owned();
    let task = tokio::spawn(async move {
        let request = throw::Request {
            user,
            spawn,
            ball: &ball,
            promise,
        };
        throw::throw(&app, &request, &mut App::rng()).await
    });
    let ctx = ctx.clone();
    let interaction = interaction.clone();
    let work = async move {
        track(&ctx, &interaction, user, spawn, from);
        let thrown: Thrown = match task.await? {
            Ok(thrown) => thrown,
            Err(error) => {
                tracing::error!(?error, "a throw failed");
                return Ok(answer(&ctx, user, spawn, READ_FAILED.to_owned(), from).await);
            }
        };
        if !thrown.charms.is_empty() {
            let app = ctx.app.clone();
            let outbox = Arc::clone(&ctx.outbox);
            let charms = thrown.charms.clone();
            tokio::spawn(async move { charms::announce(&app, &*outbox, user, &charms).await });
        }
        let message = thrown.outcome.message();
        if matches!(
            thrown.outcome,
            Outcome::Cooldown { .. } | Outcome::UnknownBall
        ) {
            return Ok(answer(&ctx, user, spawn, message, from).await);
        }
        // Plus rien à relancer : les boutons disparaissent. Après une ball de la boutique, le panneau
        // reste sur leur menu, les chances à jour sous le résultat.
        if thrown.outcome.is_final() {
            return Ok(Edit::Classic {
                content: message,
                components: Vec::new(),
            });
        }
        let (text, row) = if thrown.special {
            let menu = throw::special_menu(&ctx.app, user, spawn).await;
            (special_text(&menu), special_row(spawn, &menu, From::Panel))
        } else {
            let balls = throw::panel(&ctx.app, user).await;
            (String::new(), ball_row(spawn, &balls))
        };
        let content = if text.is_empty() {
            message
        } else {
            format!("{message}\n\n{text}")
        };
        Ok(Edit::Classic {
            content,
            components: vec![row],
        })
    };
    match from {
        From::Announcement => Reply::later(true, work),
        From::Panel => Reply::later_update(work),
    }
}

/// Un refus qui n'ira pas jusqu'au tirage. Depuis le panneau, le seul texte change : ce refus croise
/// peut-être la réponse d'un lancer précédent, et ne doit pas ressusciter ses boutons. Depuis
/// l'annonce, le nouveau panneau porte la rangée de balls, sans quoi le dresseur ferait face à un
/// cul-de-sac.
async fn answer(ctx: &Ctx, user: i64, spawn: i64, content: String, from: From) -> Edit {
    match from {
        From::Panel => Edit::Content(content),
        From::Announcement => Edit::Classic {
            content,
            components: vec![ball_row(spawn, &throw::panel(&ctx.app, user).await)],
        },
    }
}

/// Le menu des balls spéciales (`poke_special` depuis l'annonce, `poke_respecial` dans le panneau).
pub(crate) fn special(
    ctx: &Ctx,
    interaction: &Interaction,
    user: i64,
    spawn: i64,
    from: From,
) -> Reply {
    let ctx = ctx.clone();
    let interaction = interaction.clone();
    let work = async move {
        track(&ctx, &interaction, user, spawn, from);
        let menu = throw::special_menu(&ctx.app, user, spawn).await;
        Ok(Edit::Classic {
            content: special_text(&menu),
            components: vec![special_row(spawn, &menu, from)],
        })
    };
    match from {
        From::Announcement => Reply::later(true, work),
        From::Panel => Reply::later_update(work),
    }
}

/// Retour aux balls ordinaires (`poke_reback`), ou annulation de la Master Ball (`poke_master_cancel`,
/// qui restaure le panneau plutôt que de laisser un message sans boutons).
pub(crate) fn back(ctx: &Ctx, user: i64, spawn: Option<i64>, content: &'static str) -> Reply {
    let app = ctx.app.clone();
    Reply::later_update(async move {
        let components = match spawn {
            Some(spawn) => vec![ball_row(spawn, &throw::panel(&app, user).await)],
            None => Vec::new(),
        };
        Ok(Edit::Classic {
            content: content.to_owned(),
            components,
        })
    })
}

/// La confirmation de la Master Ball (`poke_master` depuis le menu de l'annonce, `poke_remaster` dans
/// le panneau) : c'est ici que le dresseur apprend son prix, qui monte à chaque achat. Offerte, elle
/// se confirme aussi : elle ne se retrouve pas.
pub(crate) fn master(
    ctx: &Ctx,
    interaction: &Interaction,
    user: i64,
    spawn: i64,
    from: From,
) -> Reply {
    let ctx = ctx.clone();
    let interaction = interaction.clone();
    let work = async move {
        track(&ctx, &interaction, user, spawn, from);
        let quote = match throw::master_quote(&ctx.app, user).await {
            Ok(Some(quote)) => quote,
            Ok(None) => {
                return Ok(answer(&ctx, user, spawn, "❌ Ball inconnue.".to_owned(), from).await);
            }
            Err(error) => {
                tracing::error!(?error, "reading the Master Ball quote failed");
                return Ok(answer(&ctx, user, spawn, READ_FAILED.to_owned(), from).await);
            }
        };
        let offered = quote.held > 0;
        if !offered && quote.balance < quote.price {
            let text = format!(
                "❌ Une **{}** coûte **{}** points, tu en as **{}**.",
                quote.label,
                format::number(quote.price),
                format::number(quote.balance)
            );
            return Ok(answer(&ctx, user, spawn, text, from).await);
        }
        // Le bouton porte la promesse : offerte, le lancer refusera si elle a disparu ; payante, si le
        // prix a monté entre-temps.
        let promise = if offered {
            Promise::Offered
        } else {
            Promise::Price(quote.price)
        };
        let label = if offered {
            "Utiliser ma Master Ball".to_owned()
        } else {
            format!("Confirmer (-{})", format::number(quote.price))
        };
        let mut confirm = ButtonBuilder::new(ButtonStyle::Danger)
            .custom_id(Button::MasterOk { spawn, promise }.encode())
            .label(label);
        if let Some(emoji) = ui::emoji(&quote.emoji) {
            confirm = confirm.emoji(emoji);
        }
        let cancel = ButtonBuilder::new(ButtonStyle::Secondary)
            .custom_id(Button::MasterCancel { spawn: Some(spawn) }.encode())
            .label("Annuler")
            .build();
        let content = if offered {
            format!(
                "⚠️ Tu vas utiliser ta **{}** offerte : la capture est garantie, mais elle est perdue \
                 si quelqu'un t'attrape le Pokémon avant.\nIl t'en reste **{}**.",
                quote.label,
                format::number(quote.held)
            )
        } else {
            format!(
                "⚠️ La **{}** garantit la capture mais coûte **{}** points, et ils sont perdus si \
                 quelqu'un t'attrape le Pokémon avant.\nTon solde : **{}** points.",
                quote.label,
                format::number(quote.price),
                format::number(quote.balance)
            )
        };
        Ok(Edit::Classic {
            content,
            components: vec![
                ActionRowBuilder::new()
                    .component(confirm.build())
                    .component(cancel)
                    .build()
                    .into(),
            ],
        })
    };
    match from {
        From::Announcement => Reply::later(true, work),
        From::Panel => Reply::later_update(work),
    }
}
