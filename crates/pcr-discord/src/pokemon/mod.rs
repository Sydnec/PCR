//! Le jeu Pokémon côté Discord : le message public des apparitions (`spawn`, boutons `poke_*` de la
//! v1), celui des objets au sol (`drop`), les panneaux de lancer (`throw`) et la fiche d'une espèce
//! (`sheet`). Les panneaux du jeu (`pk:`) arrivent avec P4e et P4f.

pub(crate) mod drop;
pub(crate) mod sheet;
pub(crate) mod spawn;
pub(crate) mod throw;

use pcr_app::{error::UseCaseError, pokemon::sheet as sheets};
use pcr_core::pokemon::{
    spawn::Button,
    throw::{Button as Panel, Promise},
};
use twilight_model::application::interaction::Interaction;

use crate::{
    Ctx,
    commands::solde,
    interactions::{EXPIRED, Edit, Reply},
    ui,
};
use throw::From;

/// Le préfixe des boutons du jeu posés par la v1 (messages publics et panneaux de lancer).
pub const PREFIX: &str = "poke_";
/// L'erreur générique de la v1, commune aux boutons du jeu.
const READ_FAILED: &str = "❌ Erreur base de données.";

/// Un bouton `poke_*` : celui d'une annonce, d'un objet au sol ou d'un panneau de lancer.
pub async fn component(ctx: &Ctx, interaction: &Interaction, custom_id: &str) -> Reply {
    let Some(user) = interaction.author_id() else {
        return ui::ephemeral_text(EXPIRED).into();
    };
    let user = crate::id(user.get());
    if let Some(button) = pcr_core::pokemon::drop::Button::parse(custom_id) {
        return drop::pick(ctx, user, button.drop).await;
    }
    if let Some(button) = Button::parse(custom_id) {
        return match button {
            Button::Info { spawn } => info(ctx, user, spawn),
            Button::Throw { spawn, ball } => throw::throw(
                ctx,
                interaction,
                user,
                spawn,
                ball,
                Promise::Unspecified,
                From::Announcement,
            ),
            Button::Special { spawn } => {
                throw::special(ctx, interaction, user, spawn, From::Announcement)
            }
        };
    }
    match Panel::parse(custom_id) {
        Some(Panel::Rethrow { spawn, ball, item }) => {
            // Annoncée offerte, la ball ne se paie jamais en points.
            let promise = if item {
                Promise::Offered
            } else {
                Promise::Unspecified
            };
            throw::throw(ctx, interaction, user, spawn, ball, promise, From::Panel)
        }
        // La ball garantie se reconnaît à la config, pas à sa clé.
        Some(Panel::MasterOk { spawn, promise }) => {
            let config = ctx.app.game_config();
            match pcr_core::pokemon::throw::guaranteed(&config.pokemon) {
                Some((key, _)) => {
                    throw::throw(ctx, interaction, user, spawn, key, promise, From::Panel)
                }
                None => ui::ephemeral_text(EXPIRED).into(),
            }
        }
        Some(Panel::Respecial { spawn }) => {
            throw::special(ctx, interaction, user, spawn, From::Panel)
        }
        Some(Panel::Reback { spawn }) => throw::back(ctx, user, Some(spawn), "Choisis ta ball."),
        Some(Panel::Master { spawn }) => {
            throw::master(ctx, interaction, user, spawn, From::Announcement)
        }
        Some(Panel::Remaster { spawn }) => {
            throw::master(ctx, interaction, user, spawn, From::Panel)
        }
        Some(Panel::MasterCancel { spawn }) => {
            throw::back(ctx, user, spawn, "Annulé, tes points sont intacts.")
        }
        // Un bouton d'une version précédente, ou d'une fonctionnalité pas encore portée.
        None => ui::ephemeral_text(EXPIRED).into(),
    }
}

/// « Infos du Pokémon » : la fiche de l'espèce, pour celui qui clique, suivie de son solde et de
/// ses balls en poche (l'autre question qu'on se pose devant une apparition).
fn info(ctx: &Ctx, user: i64, spawn: i64) -> Reply {
    let app = ctx.app.clone();
    Reply::later(true, async move {
        let info = match sheets::for_spawn(&app, user, spawn).await {
            Ok(info) => info,
            Err(UseCaseError::Refused(refusal)) => {
                return Ok(Edit::Text(refusal.text().to_owned()));
            }
            Err(UseCaseError::Db(error)) => {
                tracing::error!(?error, "reading a species sheet failed");
                return Ok(Edit::Text(READ_FAILED.to_owned()));
            }
        };
        let config = app.game_config();
        let mut panels = vec![sheet::panel(&config, &info.sheet)];
        // Un solde illisible n'est pas affiché : mieux vaut aucun solde qu'un solde faux.
        if let Some(balance) = info.balance {
            panels.push(solde::panel(&solde::Wallet {
                title: "Ton solde".to_owned(),
                avatar: None,
                points: balance,
                next_points: None,
                balls: info.balls.as_deref(),
            }));
        }
        Ok(Edit::Panel(panels))
    })
}
