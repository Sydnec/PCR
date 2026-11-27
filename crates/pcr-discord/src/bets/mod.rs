//! Les paris côté Discord : `/bet`, `/estimate` (le message public est la réponse à la commande),
//! leurs boutons, modales et menu (`bet_*`, grammaire v1), et les rendus des messages publics.
//!
//! Un clic qui ouvre une modale répond tout de suite (une modale ne se diffère pas) après une simple
//! lecture ; tout ce qui écrit attend l'écrivain unique de la base, donc se diffère. Les réponses
//! personnelles reprennent les textes v1, au tutoiement.

mod forms;
pub(crate) mod render;

use pcr_app::bets::{self as cases, BetsError, Resolved};
use pcr_core::{bets::Action, format};
use twilight_model::{
    application::interaction::{
        Interaction,
        message_component::MessageComponentInteractionData,
        modal::{ModalInteractionComponent, ModalInteractionData},
    },
    channel::message::MessageFlags,
};
use twilight_util::builder::interaction_response::ChannelMessageBuilder;

use crate::{
    Ctx,
    interactions::{EXPIRED, Edit, Reply},
    ui,
};

/// Le préfixe commun des `custom_id` de paris.
pub const PREFIX: &str = "bet_";

/// Les champs des modales.
const AMOUNT: &str = "amount";
const PREDICTION: &str = "prediction";
const RESULT: &str = "result";

const CREATE_FAILED: &str = "Erreur création pari.";

/// Membre, salon : des identifiants Discord en `i64`, comme en base.
fn id(value: u64) -> i64 {
    i64::try_from(value).unwrap_or(i64::MAX)
}

fn author(interaction: &Interaction) -> Option<i64> {
    interaction.author_id().map(|user| id(user.get()))
}

fn channel(interaction: &Interaction) -> Option<i64> {
    interaction
        .channel
        .as_ref()
        .map(|channel| id(channel.id.get()))
}

/// Un refus se dit ; une panne se journalise et se dit avec le texte de son étape.
fn answer<T>(result: Result<T, BetsError>, failed: &str, ok: impl FnOnce(T) -> String) -> Edit {
    Edit::Text(match result {
        Ok(value) => ok(value),
        Err(BetsError::Refused(refusal)) => refusal.text().to_owned(),
        Err(BetsError::Db(error)) => {
            tracing::error!(?error, "bet action failed");
            failed.to_owned()
        }
    })
}

/// Répond à `/bet` ou `/estimate` par le message du pari, qui devient son message public.
pub(crate) async fn post(
    ctx: &Ctx,
    interaction: &Interaction,
    created: Result<i64, BetsError>,
) -> Reply {
    let bet = match created {
        Ok(bet) => bet,
        Err(BetsError::Refused(refusal)) => return ui::ephemeral_text(refusal.text()).into(),
        Err(BetsError::Db(error)) => {
            tracing::error!(?error, "creating a bet failed");
            return ui::ephemeral_text(CREATE_FAILED).into();
        }
    };
    let rendered = match cases::view(&ctx.app, bet).await {
        Ok(Some(view)) => render::bet_message(&view, ctx.app.instance.discord.bet_role_id),
        Ok(None) => return ui::ephemeral_text(CREATE_FAILED).into(),
        Err(error) => {
            tracing::error!(?error, "reading a new bet failed");
            return ui::ephemeral_text(CREATE_FAILED).into();
        }
    };
    let response = ChannelMessageBuilder::new()
        .components(rendered.components.clone())
        .allowed_mentions(rendered.mentions())
        .flags(MessageFlags::IS_COMPONENTS_V2)
        .build();
    let app = ctx.app.clone();
    let channel = channel(interaction);
    Reply::Posted {
        response: Box::new(response),
        then: Box::new(move |message_id| {
            Box::pin(async move {
                // Sans salon connu, le message ne pourrait pas être réécrit : il reste tel quel.
                let Some(channel) = channel else {
                    return;
                };
                if let Err(error) = cases::posted(&app, bet, channel, message_id).await {
                    tracing::error!(?error, bet, "recording a bet message failed");
                }
            })
        }),
    }
}

/// Un bouton ou le menu d'un message de pari.
pub(crate) async fn component(
    ctx: &Ctx,
    interaction: &Interaction,
    data: &MessageComponentInteractionData,
) -> Reply {
    let (Some(action), Some(user)) = (Action::parse(&data.custom_id), author(interaction)) else {
        return ui::ephemeral_text(EXPIRED).into();
    };
    match action {
        Action::Join { bet, option } => forms::stake(ctx, bet, user, option).await,
        Action::EstimateJoin { bet } => forms::estimate(ctx, bet, user).await,
        Action::ResolveForm { bet } => forms::resolve(ctx, bet, user).await,
        Action::ResolveSelect { bet } => {
            let choice = data.values.first().cloned().unwrap_or_default();
            resolve_select(ctx, bet, user, choice, channel(interaction))
        }
        // Les `custom_id` de modale n'arrivent jamais d'un bouton.
        Action::Stake { .. } | Action::Estimate { .. } | Action::ResolveEstimate { .. } => {
            ui::ephemeral_text(EXPIRED).into()
        }
    }
}

/// Le choix du menu de résolution : clore, annuler, ou une option gagnante. Le menu éphémère est
/// remplacé par le résultat.
fn resolve_select(ctx: &Ctx, bet: i64, user: i64, choice: String, channel: Option<i64>) -> Reply {
    let app = ctx.app.clone();
    Reply::later_update(async move {
        Ok(match choice.as_str() {
            forms::LOCK => answer(
                cases::lock(&app, bet, user).await,
                "Erreur lors de la clôture du pari.",
                |()| "Les paris sont désormais clos.".to_owned(),
            ),
            forms::CANCEL => answer(
                cases::cancel(&app, bet, user).await,
                "Erreur lors de l'annulation du pari.",
                |_| "Le pari a été annulé et les mises remboursées.".to_owned(),
            ),
            option => {
                let (Ok(option), Some(channel)) = (option.parse::<i64>(), channel) else {
                    return Ok(Edit::Text(pcr_core::bets::BAD_WINNER.to_owned()));
                };
                answer(
                    cases::resolve(&app, bet, user, option, channel).await,
                    "Erreur lors de la clôture du pari.",
                    |()| "Pari terminé !".to_owned(),
                )
            }
        })
    })
}

/// Une modale de pari envoyée : mise, estimation, ou résultat d'une estimation.
pub(crate) fn modal(ctx: &Ctx, interaction: &Interaction, data: &ModalInteractionData) -> Reply {
    let (Some(action), Some(user)) = (Action::parse(&data.custom_id), author(interaction)) else {
        return ui::ephemeral_text(EXPIRED).into();
    };
    let app = ctx.app.clone();
    let amount = field(&data.components, AMOUNT);
    match action {
        Action::Stake { bet, option } => Reply::later(true, async move {
            Ok(answer(
                cases::stake(&app, bet, user, option, &amount).await,
                "Erreur lors de l'enregistrement de ton pari.",
                |staked| {
                    if staked.added {
                        format!(
                            "Tu as ajouté **{}** points à ta mise sur l'option **{option}** du pari #{bet}. Total misé: **{}**.",
                            format::number(staked.amount),
                            format::number(staked.total)
                        )
                    } else {
                        format!(
                            "Tu as misé **{}** points sur l'option **{option}** du pari #{bet}.",
                            format::number(staked.amount)
                        )
                    }
                },
            ))
        }),
        Action::Estimate { bet } => {
            let prediction = field(&data.components, PREDICTION);
            Reply::later(true, async move {
                Ok(answer(
                    cases::estimate(&app, bet, user, &prediction, &amount).await,
                    "Erreur lors de l'enregistrement de ton estimation.",
                    |done| {
                        let verb = if done.updated {
                            "mise à jour"
                        } else {
                            "enregistrée"
                        };
                        format!(
                            "Estimation {verb}: **{}** avec **{}** points.",
                            done.prediction,
                            format::number(done.amount)
                        )
                    },
                ))
            })
        }
        Action::ResolveEstimate { bet } => {
            let result = field(&data.components, RESULT);
            let Some(channel) = channel(interaction) else {
                return ui::ephemeral_text(EXPIRED).into();
            };
            Reply::later(true, async move {
                Ok(answer(
                    cases::resolve_estimate(&app, bet, user, &result, channel).await,
                    "Erreur lors de la clôture du pari.",
                    |resolved| match resolved {
                        Resolved::Paid => "Résultats publiés !".to_owned(),
                        Resolved::Empty => "Pari terminé (aucun participant).".to_owned(),
                    },
                ))
            })
        }
        Action::Join { .. }
        | Action::EstimateJoin { .. }
        | Action::ResolveForm { .. }
        | Action::ResolveSelect { .. } => ui::ephemeral_text(EXPIRED).into(),
    }
}

/// La valeur saisie dans le champ `custom_id` d'une modale (vide s'il manque) : dans un `Label`
/// (modales actuelles) ou une rangée (celles de la v1).
fn field(components: &[ModalInteractionComponent], custom_id: &str) -> String {
    for component in components {
        let found = match component {
            ModalInteractionComponent::TextInput(input) if input.custom_id == custom_id => {
                Some(input.value.clone())
            }
            ModalInteractionComponent::Label(label) => {
                Some(field(std::slice::from_ref(&label.component), custom_id))
                    .filter(|value| !value.is_empty())
            }
            ModalInteractionComponent::ActionRow(row) => {
                Some(field(&row.components, custom_id)).filter(|value| !value.is_empty())
            }
            _ => None,
        };
        if let Some(value) = found {
            return value;
        }
    }
    String::new()
}
