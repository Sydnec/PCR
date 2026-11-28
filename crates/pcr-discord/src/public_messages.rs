//! L'écriture des messages publics sur Discord : le port `PublicMessagePort` de `pcr-app`.
//!
//! Chaque type de message (`spawn`, `trade`, `drop`…) a son rendu, qui relit la base au moment
//! d'écrire : un contenu préparé trop tôt reposerait un état périmé. Les rendus arrivent avec leurs
//! fonctionnalités (paris en P3b, apparitions en P4b, le reste du jeu en P4 et P5) ; d'ici là, un
//! message sans rendu est laissé tel quel.
//!
//! Les mentions d'un message public n'appellent personne, sauf les rôles que son rendu désigne (le
//! rôle des paris ou des dresseurs, à la création) : un pari ou une capture cite des membres sans les
//! déranger.

use std::sync::Arc;

use pcr_app::{
    App, bets, pokemon,
    public_messages::{PublicMessage, PublicMessagePort, WriteError, WriteFuture, Written},
};
use twilight_http::{Client, api_error::ApiError, error::ErrorType};
use twilight_model::{
    channel::message::{AllowedMentions, Component, MessageFlags},
    id::{Id, marker::RoleMarker},
};

use crate::bets::render;

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

/// Le contenu d'un message public.
#[derive(Debug)]
pub(crate) struct Rendered {
    pub components: Vec<Component>,
    /// Les rôles que le message appelle (seulement quand il est posté : une modification n'appelle
    /// jamais personne).
    pub ping_roles: Vec<Id<RoleMarker>>,
}

impl Rendered {
    /// Les seules mentions qui notifient : les rôles désignés.
    pub fn mentions(&self) -> AllowedMentions {
        AllowedMentions {
            roles: self.ping_roles.clone(),
            ..AllowedMentions::default()
        }
    }
}

type Render = for<'a> fn(&'a App, i64) -> RenderFuture<'a>;
pub(crate) type RenderFuture<'a> = std::pin::Pin<
    Box<dyn std::future::Future<Output = anyhow::Result<Option<Rendered>>> + Send + 'a>,
>;

/// Le rendu d'un type de message ; `None` tant que sa fonctionnalité n'est pas portée.
fn renderer(kind: &str) -> Option<Render> {
    match kind {
        bets::MESSAGE => Some(render::bet),
        bets::RESULT_MESSAGE => Some(render::result),
        pokemon::spawn::MESSAGE => Some(crate::pokemon::spawn::render),
        pokemon::drops::MESSAGE => Some(crate::pokemon::drop::render),
        _ => None,
    }
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
            let rendered = match render(&self.app, message.entity_id).await {
                Ok(Some(rendered)) => rendered,
                Ok(None) => return Ok(Written::Skipped),
                Err(error) => return Err(WriteError::Permanent(error.to_string())),
            };
            self.post_or_edit(message, &rendered).await
        })
    }
}

impl DiscordPublicMessages {
    async fn post_or_edit(
        &self,
        message: &PublicMessage,
        rendered: &Rendered,
    ) -> Result<Written, WriteError> {
        let channel = Id::new_checked(u64::try_from(message.channel_id).unwrap_or(0))
            .ok_or(WriteError::Gone)?;
        let mentions = rendered.mentions();
        let response = match message.message_id {
            None => {
                self.http
                    .create_message(channel)
                    .components(&rendered.components)
                    .allowed_mentions(Some(&mentions))
                    .flags(MessageFlags::IS_COMPONENTS_V2)
                    .await
            }
            Some(id) => {
                let id = Id::new_checked(u64::try_from(id).unwrap_or(0)).ok_or(WriteError::Gone)?;
                // Rien n'appelle dans une modification : la mention du rôle a servi à la création.
                self.http
                    .update_message(channel, id)
                    .components(Some(&rendered.components))
                    .allowed_mentions(Some(&AllowedMentions::default()))
                    .await
            }
        };
        let posting = message.message_id.is_none();
        // Discord a accepté : réessayer tout de suite reposterait un second message. Le rattrapage
        // retentera plus tard, au risque d'un doublon, moins grave qu'un message perdu.
        let posted = response
            .map_err(|error| classify(&error, posting))?
            .model()
            .await
            .map_err(|error| WriteError::Permanent(error.to_string()))?;
        Ok(Written::Done {
            message_id: i64::try_from(posted.id.get()).unwrap_or(i64::MAX),
        })
    }
}

/// Une panne passagère (limite de débit, 5xx, coupure) se réessaie ; un autre refus 4xx ne passera pas
/// mieux au deuxième essai. Pour un message à poster, un droit manquant (50001, 50013) n'est pas une
/// disparition : la v1 ne tirait cette conclusion que d'une édition, et le droit peut revenir.
fn classify(error: &twilight_http::Error, posting: bool) -> WriteError {
    match error.kind() {
        ErrorType::Response {
            error: ApiError::General(general),
            ..
        } if MESSAGE_GONE.contains(&general.code)
            && !(posting && matches!(general.code, 50001 | 50013)) =>
        {
            WriteError::Gone
        }
        ErrorType::Response { status, .. } if status.is_client_error() && status.get() != 429 => {
            WriteError::Permanent(error.to_string())
        }
        _ => WriteError::Transient(error.to_string()),
    }
}
