//! Ce que les boutons d'un pari ouvrent : la modale de mise, celle d'estimation, et pour le créateur
//! le menu (ou la modale) de résolution. Simple lecture : un refus s'affiche avant toute saisie, et
//! l'envoi revérifiera tout.

use pcr_app::bets::{self as cases, BetsError, ResolveForm};
use pcr_core::{bets::Action, format};
use twilight_model::channel::message::{
    Component, MessageFlags,
    component::{SelectMenuType, TextInput, TextInputStyle},
};
use twilight_util::builder::{
    interaction_response::{ChannelMessageBuilder, ModalBuilder},
    message::{ActionRowBuilder, LabelBuilder, SelectMenuBuilder, SelectMenuOptionBuilder},
};

use super::{AMOUNT, PREDICTION, RESULT, render::clip};
use crate::{Ctx, interactions::Reply, ui};

/// Les choix du menu de résolution autres qu'une option.
pub(super) const LOCK: &str = "lock";
pub(super) const CANCEL: &str = "cancel";

/// Longueurs que Discord accepte : titre de modale, libellé de champ, option de menu.
const MODAL_TITLE: usize = 45;
const SELECT_LABEL: usize = 100;

/// Un refus se dit ; une panne de lecture se journalise.
fn refused(error: BetsError, failed: &str) -> Reply {
    match error {
        BetsError::Refused(refusal) => ui::ephemeral_text(refusal.text()).into(),
        BetsError::Db(error) => {
            tracing::error!(?error, "reading a bet failed");
            ui::ephemeral_text(failed).into()
        }
    }
}

/// Un champ de saisie d'une ligne, sous son libellé.
fn input(
    custom_id: &str,
    label: &str,
    placeholder: Option<String>,
    value: Option<String>,
) -> Component {
    // `label` du champ est déprécié : c'est le composant `Label` qui le porte désormais.
    #[allow(deprecated)]
    let input = TextInput {
        custom_id: custom_id.to_owned(),
        id: None,
        label: None,
        max_length: None,
        min_length: None,
        placeholder,
        required: Some(true),
        style: TextInputStyle::Short,
        value,
    };
    LabelBuilder::new(label, Component::TextInput(input))
        .build()
        .into()
}

fn modal(custom_id: String, title: &str, fields: Vec<Component>) -> Reply {
    ModalBuilder::new(custom_id, clip(title, MODAL_TITLE), fields)
        .build()
        .into()
}

/// `bet_join` : la modale de mise, ou d'ajout à la mise sur la même option.
pub(super) async fn stake(ctx: &Ctx, bet: i64, user: i64, option: i64) -> Reply {
    let form = match cases::stake_form(&ctx.app, bet, user, option).await {
        Ok(form) => form,
        Err(error) => {
            return refused(error, "Erreur lors de la vérification de ta participation.");
        }
    };
    let balance = format::number(form.balance);
    let (title, label) = if form.staked.is_some() {
        (
            format!("Ajouter à la mise (Solde: {balance})"),
            "Montant à ajouter",
        )
    } else {
        (format!("Miser (Solde: {balance})"), "Montant de la mise")
    };
    modal(
        Action::Stake { bet, option }.encode(),
        &title,
        vec![input(AMOUNT, label, Some(format!("Max: {balance}")), None)],
    )
}

/// `bet_estimate_join` : la modale d'estimation, préremplie si on en a déjà posé une.
pub(super) async fn estimate(ctx: &Ctx, bet: i64, user: i64) -> Reply {
    let form = match cases::estimate_form(&ctx.app, bet, user).await {
        Ok(form) => form,
        Err(error) => return refused(error, "Pari introuvable."),
    };
    let title = if form.current.is_some() {
        "Modifier ton estimation"
    } else {
        "Proposer une estimation"
    };
    modal(
        Action::Estimate { bet }.encode(),
        title,
        vec![
            input(
                PREDICTION,
                "Ton estimation",
                None,
                form.current.map(|(prediction, _)| prediction.to_string()),
            ),
            input(
                AMOUNT,
                "Montant de la mise",
                Some(format!("Solde: {}", format::number(form.balance))),
                form.current.map(|(_, amount)| amount.to_string()),
            ),
        ],
    )
}

/// `bet_resolve_modal` : la modale du résultat d'une estimation, ou le menu des options (clore les
/// mises tant qu'elles sont ouvertes, annuler).
pub(super) async fn resolve(ctx: &Ctx, bet: i64, user: i64) -> Reply {
    let form = match cases::resolve_form(&ctx.app, bet, user).await {
        Ok(form) => form,
        Err(error) => return refused(error, "Pari introuvable."),
    };
    let (options, open) = match form {
        ResolveForm::Estimate => {
            return modal(
                Action::ResolveEstimate { bet }.encode(),
                "Résultat de l'estimation",
                vec![input(RESULT, "La bonne réponse", None, None)],
            );
        }
        ResolveForm::Classic { options, open } => (options, open),
    };
    let mut menu =
        SelectMenuBuilder::new(Action::ResolveSelect { bet }.encode(), SelectMenuType::Text)
            .placeholder("Sélectionne l'option gagnante");
    for (index, label) in &options {
        menu = menu.option(
            SelectMenuOptionBuilder::new(
                clip(&format!("{index}. {label}"), SELECT_LABEL),
                index.to_string(),
            )
            .build(),
        );
    }
    if open {
        menu = menu.option(
            SelectMenuOptionBuilder::new("🔒 Clôturer les paris", LOCK)
                .description("Empêche de nouveaux paris sans déclarer de vainqueur")
                .build(),
        );
    }
    menu = menu.option(
        SelectMenuOptionBuilder::new("❌ Annuler le pari", CANCEL)
            .description("Rembourse tous les participants")
            .build(),
    );
    ChannelMessageBuilder::new()
        .content("Sélectionne le résultat du pari :")
        .components([ActionRowBuilder::new().component(menu.build()).build()])
        .flags(MessageFlags::EPHEMERAL)
        .build()
        .into()
}
