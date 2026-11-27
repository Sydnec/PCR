//! Le jeu Pokémon côté Discord : le message public des apparitions (`spawn`, boutons `poke_*` de la
//! v1) et la fiche d'une espèce (`sheet`). Les panneaux du jeu (`pk:`) arrivent avec P4e et P4f.

pub(crate) mod sheet;
pub(crate) mod spawn;

use pcr_app::{error::UseCaseError, pokemon::sheet as sheets};
use pcr_core::pokemon::spawn::Button;
use twilight_model::application::interaction::Interaction;

use crate::{
    Ctx,
    commands::solde,
    interactions::{EXPIRED, Edit, Reply},
    ui,
};

/// Le préfixe des boutons des messages publics du jeu (v1).
pub const PREFIX: &str = "poke_";
const READ_FAILED: &str = "❌ Erreur base de données.";
/// Les lancers arrivent avec P4c : d'ici là, leurs boutons le disent au lieu de se taire.
const THROWS_LATER: &str = "⏳ Les lancers ne sont pas encore ouverts sur cette version du bot.";

/// Un bouton `poke_*` d'un message public.
pub fn component(ctx: &Ctx, interaction: &Interaction, custom_id: &str) -> Reply {
    let Some(user) = interaction.author_id() else {
        return ui::ephemeral_text(EXPIRED).into();
    };
    let user = crate::id(user.get());
    match Button::parse(custom_id) {
        Some(Button::Info { spawn }) => info(ctx, user, spawn),
        Some(Button::Throw { .. } | Button::Special { .. }) => {
            ui::ephemeral_text(THROWS_LATER).into()
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
