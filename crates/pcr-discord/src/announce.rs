//! Poste l'annonce de version (prod) ou l'aperçu des annonces à venir (dev), au premier READY.

use pcr_app::announcements;
use twilight_model::{id::Id, util::Timestamp};
use twilight_util::builder::embed::{EmbedBuilder, EmbedFieldBuilder, EmbedFooterBuilder};

use crate::Ctx;

/// Vert des annonces v1.
const COLOR: u32 = 0x00_ff_00;

pub async fn run(ctx: Ctx) {
    let Some(channel_id) = ctx.app.instance.discord.changelog_channel_id else {
        return;
    };
    let pending = match announcements::pending(&ctx.app).await {
        Ok(Some(pending)) => pending,
        Ok(None) => return,
        Err(error) => {
            tracing::error!(%error, "cannot prepare the release announcement");
            return;
        }
    };

    let mut embed = EmbedBuilder::new()
        .title(&pending.title)
        .description(&pending.description)
        .color(COLOR)
        .footer(EmbedFooterBuilder::new(pending.footer));
    if let Ok(now) = Timestamp::from_micros(ctx.app.clock.now().as_microsecond()) {
        embed = embed.timestamp(now);
    }
    for (name, value) in &pending.sections {
        embed = embed.field(EmbedFieldBuilder::new(*name, value));
    }

    let embeds = [embed.build()];
    match ctx
        .http
        .create_message(Id::new(channel_id))
        .embeds(&embeds)
        .await
    {
        Ok(_) => {
            if let Err(error) = announcements::mark_posted(&ctx.app, &pending).await {
                tracing::error!(%error, "announcement posted but not recorded");
            }
        }
        Err(error) => tracing::warn!(%error, "cannot post the release announcement"),
    }
}
