//! Rappels : `/rappel`, le bouton « Me rappeler aussi », `/mesrappels`, et le balayage qui envoie
//! chaque minute les rappels échus en MP puis efface ceux envoyés depuis quelques jours.
//!
//! L'envoi précède la marque « envoyé » : un arrêt entre les deux renvoie le rappel au passage
//! suivant, un doublon valant mieux qu'un rappel perdu. Un membre injoignable (parti, MP fermés) est
//! marqué tout de suite : il ne se retenterait sinon qu'indéfiniment.

use std::{sync::Arc, time::Duration};

use jiff::{SignedDuration, Timestamp};
use pcr_core::reminders::{self as rules, Button};
use pcr_db::{
    DbError,
    reminders::{self, Reminder},
};
use tokio::sync::watch;

use crate::{
    App,
    error::UseCaseError,
    outbox::{Delivery, Outbox},
};

/// Cadence du balayage : un rappel part au plus une minute après son heure, comme en v1.
const TICK: Duration = Duration::from_mins(1);
/// Rappels envoyés par passage : un retard après une longue panne s'étale sur plusieurs.
const BATCH: i64 = 100;

/// Des jours de 24 heures, comme les délais de la v1.
fn days(count: u32) -> SignedDuration {
    SignedDuration::from_hours(i64::from(count) * 24)
}

/// Un rappel posé.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Created {
    pub id: i64,
    pub trigger_at: Timestamp,
    pub message: String,
    /// Le `custom_id` du bouton « Me rappeler aussi ».
    pub button: String,
}

/// La date tapée dans `/rappel`, en heure de Paris, si elle est valable : sans rien écrire, pour
/// qu'un refus se dise en privé avant la réponse publique.
pub fn validate(app: &App, when: &str) -> Result<Timestamp, UseCaseError> {
    let now = app.clock.now();
    let at = rules::parse_when(when, now).ok_or_else(|| UseCaseError::refused(rules::BAD_DATE))?;
    if at <= now {
        return Err(UseCaseError::refused(rules::IN_THE_PAST));
    }
    let max_days = app.game_config().reminders.max_days_ahead;
    if at > now.checked_add(days(max_days)).unwrap_or(Timestamp::MAX) {
        return Err(rules::too_far(max_days).into());
    }
    Ok(at)
}

/// `/rappel date [message]` : la date tapée est en heure de Paris.
pub async fn create(
    app: &App,
    user: i64,
    channel: i64,
    when: &str,
    message: Option<&str>,
) -> Result<Created, UseCaseError> {
    let at = validate(app, when)?;
    let message = message
        .map(str::trim)
        .filter(|message| !message.is_empty())
        .unwrap_or(rules::DEFAULT_MESSAGE);
    insert(app, user, channel, at, message).await
}

/// Le bouton « Me rappeler aussi » : le même rappel, pour celui qui clique.
pub async fn copy(
    app: &App,
    user: i64,
    channel: i64,
    custom_id: &str,
) -> Result<Created, UseCaseError> {
    let button =
        Button::parse(custom_id).ok_or_else(|| UseCaseError::refused(rules::ALREADY_PAST))?;
    let (at_ms, message) = match button {
        Button::Inline { at_ms, message } => (at_ms, message),
        Button::Copy { at_ms, reminder } => {
            let source = reminders::get(&app.db, reminder).await?;
            (
                at_ms,
                source
                    .map(|source| source.message)
                    .ok_or_else(|| UseCaseError::refused(rules::SOURCE_GONE))?,
            )
        }
    };
    let at = Timestamp::from_millisecond(at_ms)
        .map_err(|_| UseCaseError::refused(rules::ALREADY_PAST))?;
    if at <= app.clock.now() {
        return Err(UseCaseError::refused(rules::ALREADY_PAST));
    }
    insert(app, user, channel, at, &message).await
}

async fn insert(
    app: &App,
    user: i64,
    channel: i64,
    at: Timestamp,
    message: &str,
) -> Result<Created, UseCaseError> {
    let at_ms = at.as_millisecond();
    let mut conn = app.db.writer().acquire().await.map_err(DbError::from)?;
    let id =
        reminders::create(&mut conn, user, channel, message, at_ms, app.clock.now_ms()).await?;
    Ok(Created {
        id,
        trigger_at: at,
        message: message.to_owned(),
        button: Button::for_reminder(at_ms, message, id),
    })
}

/// `/mesrappels liste` : les rappels à venir de `user`.
pub async fn pending(app: &App, user: i64) -> Result<Vec<Reminder>, DbError> {
    reminders::pending_of(&app.db, user).await
}

/// `/mesrappels supprimer id` : seulement un rappel à soi, pas encore parti.
pub async fn delete(app: &App, user: i64, id: i64) -> Result<Reminder, UseCaseError> {
    reminders::delete_pending(&app.db, id, user)
        .await?
        .ok_or_else(|| UseCaseError::refused(rules::NOT_YOURS))
}

/// Un passage : efface les vieux rappels envoyés, puis envoie les rappels échus. Renvoie le nombre
/// de rappels traités.
pub async fn sweep(app: &App, outbox: &dyn Outbox) -> Result<usize, DbError> {
    let now = app.clock.now();
    let keep = app.game_config().reminders.keep_sent_days;
    let before = now.checked_sub(days(keep)).unwrap_or(Timestamp::MIN);
    let purged = reminders::purge_sent(&app.db, before.as_millisecond()).await?;
    if purged > 0 {
        tracing::info!(purged, "old reminders deleted");
    }
    let due = reminders::due(&app.db, now.as_millisecond(), BATCH).await?;
    let allowlist = &app.instance.discord.dm_allowlist;
    let mut handled = 0;
    for reminder in &due {
        // Garde-fou du dev : une copie de la prod ne doit écrire à aucun vrai membre.
        let allowed = allowlist.is_empty()
            || u64::try_from(reminder.user_id).is_ok_and(|user| allowlist.contains(&user));
        if allowed {
            match outbox.remind(reminder).await {
                Ok(Delivery::Sent) => tracing::info!(id = reminder.id, "reminder sent"),
                Ok(Delivery::Unreachable) => {
                    tracing::warn!(id = reminder.id, "reminder recipient unreachable");
                }
                Err(error) => {
                    // Laissé à envoyer : le passage suivant réessaie.
                    tracing::warn!(%error, id = reminder.id, "reminder not sent, retried later");
                    continue;
                }
            }
        } else {
            tracing::info!(
                id = reminder.id,
                "reminder not sent: user outside dm_allowlist"
            );
        }
        reminders::mark_sent(&app.db, reminder.id, app.clock.now_ms()).await?;
        handled += 1;
    }
    Ok(handled)
}

/// Le balayage, chaque minute jusqu'à l'arrêt (lancé avec la connexion Discord).
pub async fn run(app: App, outbox: Arc<dyn Outbox>, mut shutdown: watch::Receiver<bool>) {
    loop {
        if let Err(error) = sweep(&app, &*outbox).await {
            tracing::error!(?error, "reminder sweep failed");
        }
        tokio::select! {
            () = tokio::time::sleep(TICK) => {}
            _ = shutdown.wait_for(|stop| *stop) => return,
        }
    }
}

#[cfg(test)]
mod tests;
