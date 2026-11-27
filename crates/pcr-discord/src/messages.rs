//! Les messages des membres : points et statistiques (`pcr_app::points::on_message`), la prochaine
//! apparition Pokémon (`pcr_app::pokemon::spawn::on_message`), puis la réécriture de leurs liens X et
//! Instagram (`links`).
//!
//! Les bots ne gagnent rien et ne comptent nulle part. Les MP comptent pour les points comme en v1 (ils
//! sont soumis à la même carence que les messages du serveur), pas pour les apparitions.

use twilight_model::channel::Message;

use crate::Ctx;

pub async fn handle(ctx: Ctx, message: Message) {
    if message.author.bot {
        return;
    }
    let author = i64::try_from(message.author.id.get()).unwrap_or(i64::MAX);
    let channel = i64::try_from(message.channel_id.get()).unwrap_or(i64::MAX);
    if let Err(error) =
        pcr_app::points::on_message(&ctx.app, author, channel, &message.content).await
    {
        tracing::error!(?error, "message reward failed");
    }
    if message.guild_id.is_some()
        && let Err(error) = pcr_app::pokemon::spawn::on_message(&ctx.app).await
    {
        tracing::error!(?error, "counting a message for the next spawn failed");
    }
    crate::links::rewrite(&ctx, &message).await;
}
