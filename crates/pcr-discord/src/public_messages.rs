//! L'écriture des messages publics sur Discord : le port `PublicMessagePort` de `pcr-app`.
//!
//! Chaque type de message (`spawn`, `trade`, `drop`…) a son rendu, qui relit la base au moment
//! d'écrire : un contenu préparé trop tôt reposerait un état périmé. Les rendus arrivent avec leurs
//! fonctionnalités (P4, P5) ; d'ici là, tout message est laissé tel quel.

use std::sync::Arc;

use pcr_app::{
    App,
    public_messages::{PublicMessage, PublicMessagePort, WriteError, WriteFuture, Written},
};
use twilight_http::{Client, api_error::ApiError, error::ErrorType};
use twilight_model::{
    channel::message::{Component, MessageFlags},
    id::Id,
};

/// Codes Discord qui prouvent qu'un message ne se réécrira plus jamais (repris de la v1) : réessayer
/// ne servirait à rien, et le rattrapage tournerait en boucle.
const MESSAGE_GONE: [u64; 6] = [
    10003, // Unknown Channel
    10008, // Unknown Message
    50001, // Missing Access
    50005, // Cannot edit a message authored by another user
    50013, // Missing Permissions
    50083, // Thread is archived
];

type Render = for<'a> fn(&'a App, i64) -> RenderFuture<'a>;
type RenderFuture<'a> = std::pin::Pin<
    Box<dyn std::future::Future<Output = anyhow::Result<Option<Vec<Component>>>> + Send + 'a>,
>;

/// Le rendu d'un type de message ; `None` tant que sa fonctionnalité n'est pas portée.
fn renderer(_kind: &str) -> Option<Render> {
    None
}

#[derive(Debug)]
pub(crate) struct DiscordPublicMessages {
    pub app: App,
    pub http: Arc<Client>,
}

impl PublicMessagePort for DiscordPublicMessages {
    fn write<'a>(&'a self, message: &'a PublicMessage) -> WriteFuture<'a> {
        Box::pin(async move {
            let Some(render) = renderer(&message.kind) else {
                return Ok(Written::Skipped);
            };
            let components = match render(&self.app, message.entity_id).await {
                Ok(Some(components)) => components,
                Ok(None) => return Ok(Written::Skipped),
                Err(error) => return Err(WriteError::Permanent(error.to_string())),
            };
            self.post_or_edit(message, &components).await
        })
    }
}

impl DiscordPublicMessages {
    async fn post_or_edit(
        &self,
        message: &PublicMessage,
        components: &[Component],
    ) -> Result<Written, WriteError> {
        let channel = Id::new_checked(u64::try_from(message.channel_id).unwrap_or(0))
            .ok_or(WriteError::Gone)?;
        let response = match message.message_id {
            None => {
                self.http
                    .create_message(channel)
                    .components(components)
                    .flags(MessageFlags::IS_COMPONENTS_V2)
                    .await
            }
            Some(id) => {
                let id = Id::new_checked(u64::try_from(id).unwrap_or(0)).ok_or(WriteError::Gone)?;
                self.http
                    .update_message(channel, id)
                    .components(Some(components))
                    .await
            }
        };
        let posted = response
            .map_err(|error| classify(&error))?
            .model()
            .await
            .map_err(|error| WriteError::Transient(error.to_string()))?;
        Ok(Written::Done {
            message_id: i64::try_from(posted.id.get()).unwrap_or(i64::MAX),
        })
    }
}

/// Une panne passagère (limite de débit, 5xx, coupure) se réessaie ; un autre refus 4xx ne passera pas
/// mieux au deuxième essai.
fn classify(error: &twilight_http::Error) -> WriteError {
    match error.kind() {
        ErrorType::Response {
            error: ApiError::General(general),
            ..
        } if MESSAGE_GONE.contains(&general.code) => WriteError::Gone,
        ErrorType::Response { status, .. } if status.is_client_error() && status.get() != 429 => {
            WriteError::Permanent(error.to_string())
        }
        _ => WriteError::Transient(error.to_string()),
    }
}
