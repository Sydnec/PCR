//! Le vocal, pour les stats de l'année (`pcr_app::voice`).

use twilight_model::voice::VoiceState;

use crate::{Ctx, id};

/// Un état vocal : dans un salon, ou sorti du vocal. Ceux d'un autre serveur ne comptent pas.
pub async fn changed(ctx: Ctx, state: VoiceState) {
    if state.guild_id != Some(ctx.guild_id) {
        return;
    }
    let user = id(state.user_id.get());
    if let Err(error) = pcr_app::voice::changed(&ctx.app, user, state.channel_id.is_some()).await {
        tracing::error!(?error, "recording a voice change failed");
    }
}

/// À la connexion : les membres en vocal à cet instant.
pub async fn reset(ctx: Ctx, in_voice: Vec<i64>) {
    if let Err(error) = pcr_app::voice::reset(&ctx.app, &in_voice).await {
        tracing::error!(?error, "resetting voice sessions failed");
    }
}
