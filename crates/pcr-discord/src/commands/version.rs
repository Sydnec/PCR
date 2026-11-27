//! `/version` : la version du bot (texte de la v1), et ce que la v2 y ajoute : le commit,
//! l'environnement et l'état de la base.

use pcr_core::{
    build::{GIT_SHA, VERSION},
    instance::Env,
};
use twilight_interactions::command::{CommandModel, CreateCommand};
use twilight_model::channel::message::{Component, component::ButtonStyle};
use twilight_util::builder::message::{
    ActionRowBuilder, ButtonBuilder, ContainerBuilder, TextDisplayBuilder,
};

use crate::Ctx;

pub const REFRESH: &str = "version|refresh";

#[derive(Debug, CommandModel, CreateCommand)]
#[command(name = "version", desc = "Affiche la version actuelle du bot")]
pub struct VersionCommand;

pub async fn panel(ctx: &Ctx) -> Vec<Component> {
    let env = match ctx.app.instance.env {
        Env::Prod => "production",
        Env::Dev => "développement",
    };
    let database = if ctx.app.db.ping().await.is_ok() {
        "OK"
    } else {
        "indisponible"
    };
    let text = format!(
        "La version actuelle du bot est : **v{VERSION}**\n-# Commit `{GIT_SHA}` · {env} · base de données : {database}"
    );
    let refresh = ButtonBuilder::new(ButtonStyle::Secondary)
        .custom_id(REFRESH)
        .label("Actualiser")
        .build();
    let container = ContainerBuilder::new()
        .component(TextDisplayBuilder::new(text).build())
        .component(ActionRowBuilder::new().component(refresh).build())
        .build();
    vec![container.into()]
}
