//! Le vocal, pour les stats de l'année (`pcr_app::voice`). Les changements passent par une file
//! unique, traitée dans l'ordre d'arrivée : une arrivée et un départ rapprochés d'un même membre, ou
//! le relevé du démarrage, ne s'appliquent jamais à l'envers.

use pcr_app::App;
use tokio::sync::mpsc;
use twilight_model::{
    id::{Id, marker::GuildMarker},
    voice::VoiceState,
};

use crate::id;

/// Ce que la file reçoit.
#[derive(Debug)]
pub enum Change {
    /// Un membre (de ce serveur ou d'un autre), dans un salon vocal ou non.
    State {
        guild: Option<Id<GuildMarker>>,
        user: i64,
        in_channel: bool,
    },
    /// À la connexion : les membres en vocal à cet instant.
    Reset(Vec<i64>),
}

pub type Sender = mpsc::UnboundedSender<Change>;

impl From<VoiceState> for Change {
    fn from(state: VoiceState) -> Self {
        Self::State {
            guild: state.guild_id,
            user: id(state.user_id.get()),
            in_channel: state.channel_id.is_some(),
        }
    }
}

/// Traite la file jusqu'à ce que la connexion s'arrête.
pub async fn run(app: App, guild: Id<GuildMarker>, mut changes: mpsc::UnboundedReceiver<Change>) {
    while let Some(change) = changes.recv().await {
        let done = match change {
            // Ceux d'un autre serveur ne comptent pas.
            Change::State {
                guild: Some(of),
                user,
                in_channel,
            } if of == guild => pcr_app::voice::changed(&app, user, in_channel).await,
            Change::State { .. } => Ok(()),
            Change::Reset(in_voice) => pcr_app::voice::reset(&app, &in_voice).await,
        };
        if let Err(error) = done {
            tracing::error!(?error, "recording a voice change failed");
        }
    }
}
