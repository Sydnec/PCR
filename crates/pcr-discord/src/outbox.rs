//! Le port `Outbox` de `pcr-app` : ce que les tâches de fond postent sur Discord (rappels en MP,
//! vœux, saints du jour, fils de l'Avent).
//!
//! Chaque envoi dit qui il peut appeler : rien d'autre ne notifie, quoi que contienne le texte (un
//! prénom de saint ou un message de rappel ne mentionne jamais `@everyone`).

use std::sync::Arc;

use pcr_app::outbox::{Delivery, Outbox, OutboxFuture, Reminder};
use pcr_core::reminders::created_label;
use twilight_http::{Client, api_error::ApiError, error::ErrorType};
use twilight_model::{
    channel::{
        ChannelType,
        message::{AllowedMentions, MessageFlags},
        thread::AutoArchiveDuration,
    },
    id::{
        Id,
        marker::{ChannelMarker, GuildMarker, UserMarker},
    },
};
use twilight_util::builder::message::{ContainerBuilder, TextDisplayBuilder};

use crate::{bets::render::clip, members::display_name};

/// Longueur d'un message texte que Discord accepte.
const MESSAGE_MAX: usize = 2000;
/// Codes Discord d'un MP impossible : MP fermés, compte inconnu.
const DM_CLOSED: [u64; 2] = [50007, 10013];
/// L'or des rappels en v1.
const GOLD: u32 = 0xff_d7_00;

#[derive(Debug)]
pub(crate) struct DiscordOutbox {
    pub http: Arc<Client>,
    pub guild: Id<GuildMarker>,
}

fn channel_id(id: i64) -> Result<Id<ChannelMarker>, String> {
    u64::try_from(id)
        .ok()
        .and_then(Id::new_checked)
        .ok_or_else(|| format!("invalid channel id {id}"))
}

fn user_id(id: i64) -> Option<Id<UserMarker>> {
    u64::try_from(id).ok().and_then(Id::new_checked)
}

fn api_code(error: &twilight_http::Error) -> Option<u64> {
    match error.kind() {
        ErrorType::Response {
            error: ApiError::General(general),
            ..
        } => Some(general.code),
        _ => None,
    }
}

impl Outbox for DiscordOutbox {
    fn post(&self, channel: i64, text: String, ping: Vec<i64>) -> OutboxFuture<'_, ()> {
        Box::pin(async move {
            let mentions = AllowedMentions {
                users: ping.into_iter().filter_map(user_id).collect(),
                ..AllowedMentions::default()
            };
            self.http
                .create_message(channel_id(channel)?)
                .content(&clip(&text, MESSAGE_MAX))
                .allowed_mentions(Some(&mentions))
                .await
                .map_err(|e| e.to_string())?;
            Ok(())
        })
    }

    fn open_thread(&self, channel: i64, name: String, text: String) -> OutboxFuture<'_, ()> {
        Box::pin(async move {
            let thread = self
                .http
                .create_thread(channel_id(channel)?, &name, ChannelType::PublicThread)
                .auto_archive_duration(AutoArchiveDuration::Day)
                .await
                .map_err(|e| e.to_string())?
                .model()
                .await
                .map_err(|e| e.to_string())?;
            let silent = AllowedMentions::default();
            let message = self
                .http
                .create_message(thread.id)
                .content(&clip(&text, MESSAGE_MAX))
                .allowed_mentions(Some(&silent))
                .await
                .map_err(|e| e.to_string())?
                .model()
                .await
                .map_err(|e| e.to_string())?;
            // Une épingle manquée ne vaut pas de rouvrir un second fil.
            if let Err(error) = self.http.create_pin(thread.id, message.id).await {
                tracing::warn!(?error, "could not pin the advent message");
            }
            Ok(())
        })
    }

    fn display_name(&self, user: i64) -> OutboxFuture<'_, Option<String>> {
        Box::pin(async move { Ok(display_name(&self.http, self.guild, user).await) })
    }

    fn remind<'a>(&'a self, reminder: &'a Reminder) -> OutboxFuture<'a, Delivery> {
        Box::pin(async move {
            let Some(user) = user_id(reminder.user_id) else {
                return Ok(Delivery::Unreachable);
            };
            let dm = match self.http.create_private_channel(user).await {
                Ok(response) => response.model().await.map_err(|e| e.to_string())?,
                Err(error) if api_code(&error).is_some_and(|code| DM_CLOSED.contains(&code)) => {
                    return Ok(Delivery::Unreachable);
                }
                Err(error) => return Err(error.to_string()),
            };
            let guild = match self.http.guild(self.guild).await {
                Ok(response) => response.model().await.ok().map(|guild| guild.name),
                Err(_) => None,
            };
            let components = reminder_panel(reminder, guild.as_deref());
            let silent = AllowedMentions::default();
            match self
                .http
                .create_message(dm.id)
                .components(&components)
                .flags(MessageFlags::IS_COMPONENTS_V2)
                .allowed_mentions(Some(&silent))
                .await
            {
                Ok(_) => Ok(Delivery::Sent),
                Err(error) if api_code(&error).is_some_and(|code| DM_CLOSED.contains(&code)) => {
                    Ok(Delivery::Unreachable)
                }
                Err(error) => Err(error.to_string()),
            }
        })
    }
}

/// Le MP d'un rappel, texte de la v1. Le contexte n'est donné que si le serveur se lit : une lecture
/// ratée l'omet plutôt que d'inventer un nom.
fn reminder_panel(
    reminder: &Reminder,
    guild: Option<&str>,
) -> Vec<twilight_model::channel::message::Component> {
    let mut container = ContainerBuilder::new().accent_color(Some(GOLD)).component(
        TextDisplayBuilder::new(clip(
            &format!("### ⏰ Rappel !\n{}", reminder.message),
            MESSAGE_MAX,
        ))
        .build(),
    );
    if let Some(guild) = guild {
        container = container.component(
            TextDisplayBuilder::new(format!(
                "**📍 Contexte**\nCréé dans <#{}> sur **{guild}**",
                reminder.channel_id
            ))
            .build(),
        );
    }
    if let Some(created) = created_label(reminder.created_at) {
        container = container.component(TextDisplayBuilder::new(format!("-# {created}")).build());
    }
    vec![container.build().into()]
}
