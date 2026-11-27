//! Les réactions, pour les stats de l'année : posées par membre, reçues par message, par emoji (son
//! nom, comme en v1), et celles d'un `/randomizabaise`. Une réaction retirée se décompte.

use crate::{App, stats::Counter};

/// Une réaction posée (`added`) ou retirée par `user` sur `message`, avec l'emoji `emoji`.
pub fn counted(app: &App, user: i64, message: i64, emoji: &str, added: bool) {
    let now = app.clock.now();
    let delta = if added { 1 } else { -1 };
    app.stats.add(now, Counter::Reaction { user }, delta);
    app.stats
        .add(now, Counter::MessageReaction { message }, delta);
    if !emoji.is_empty() {
        app.stats.add(
            now,
            Counter::Emoji {
                user,
                emoji: emoji.to_owned(),
            },
            delta,
        );
    }
    app.stats.add(now, Counter::ShipReaction { message }, delta);
}
