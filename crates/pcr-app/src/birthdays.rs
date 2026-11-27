//! Anniversaires : `/birthday add|list|remove` et les vœux du jour, à `birthday.hour` (heure de
//! Paris) dans le salon des anniversaires.
//!
//! Chaque fête est revendiquée en base (`last_wished_year`) avant de partir : une tâche rejouée après
//! une panne ne félicite jamais deux fois, et un envoi raté rend la fête au passage suivant.

use jiff::civil::Date;
use pcr_core::birthdays::{self as rules, Birthday};
use pcr_db::{DbError, birthdays};

use crate::{
    App,
    error::UseCaseError,
    jobs::{Job, JobFuture, daily_at},
    outbox::Ports,
};

/// La liste montre les prochaines fêtes, pas plus (comme en v1).
pub const UPCOMING: usize = 10;

/// `/birthday add date` : enregistre (ou remplace) la date de `user`.
pub async fn set(app: &App, user: i64, raw: &str) -> Result<Birthday, UseCaseError> {
    let birthday = rules::parse(raw, app.clock.today())
        .ok_or_else(|| UseCaseError::refused(rules::bad_date(raw)))?;
    birthdays::set(
        &app.db,
        user,
        birthday.day.into(),
        birthday.month.into(),
        birthday.year.map(i64::from),
    )
    .await?;
    Ok(birthday)
}

/// `/birthday remove` : `false` s'il n'y avait rien à supprimer.
pub async fn remove(app: &App, user: i64) -> Result<bool, DbError> {
    birthdays::remove(&app.db, user).await
}

/// Une fête à venir.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Upcoming {
    pub user: i64,
    pub birthday: Birthday,
    pub next: Date,
    /// 0 : aujourd'hui.
    pub days: i32,
    /// L'âge fêté, si l'année est connue.
    pub age: Option<i16>,
}

fn birthday_of(row: &birthdays::Row) -> Option<Birthday> {
    Some(Birthday {
        day: i8::try_from(row.day).ok()?,
        month: i8::try_from(row.month).ok()?,
        year: row.year.map(i16::try_from).transpose().ok()?,
    })
}

/// `/birthday list` : les prochaines fêtes, la plus proche d'abord.
pub async fn upcoming(app: &App) -> Result<Vec<Upcoming>, DbError> {
    let today = app.clock.today();
    let mut list: Vec<Upcoming> = birthdays::all(&app.db)
        .await?
        .iter()
        .filter_map(|row| {
            let birthday = birthday_of(row)?;
            let next = rules::next_occurrence(birthday, today)?;
            Some(Upcoming {
                user: row.user_id,
                birthday,
                next,
                days: rules::days_until(birthday, today)?,
                age: birthday.year.map(|year| next.year() - year),
            })
        })
        .collect();
    // Tri complet puis coupe : un tri partiel pourrait écarter un proche.
    list.sort_by_key(|entry| (entry.days, entry.next, entry.user));
    list.truncate(UPCOMING);
    Ok(list)
}

/// Les vœux du jour, à l'heure réglée ; coupés sans salon d'anniversaires.
pub const JOB: Job = Job {
    name: "birthdays",
    schedule: |app| {
        let config = app.game_config();
        (config.birthday.enabled && app.instance.discord.birthday_channel_id.is_some())
            .then(|| daily_at(config.birthday.hour))
            .flatten()
    },
    run: |app, ports, period| Box::pin(wish_today(app, ports, period)),
};

fn wish_today(app: App, ports: Ports, period: String) -> JobFuture {
    Box::pin(async move {
        let Some(channel) = app.instance.discord.birthday_channel_id else {
            return Ok(());
        };
        let channel = i64::try_from(channel)?;
        let today: Date = period.parse()?;
        let template = app.game_config().birthday.message.clone();
        let mut failed = None;
        for row in birthdays::all(&app.db).await? {
            let Some(birthday) = birthday_of(&row) else {
                continue;
            };
            if !rules::is_today(birthday, today)
                || !birthdays::claim(&app.db, row.user_id, today.year().into()).await?
            {
                continue;
            }
            let user = row.user_id;
            let name = ports
                .outbox
                .display_name(user)
                .await
                .ok()
                .flatten()
                .unwrap_or_else(|| user.to_string());
            let text = rules::wish(&template, &format!("<@{user}>"), &name);
            if let Err(error) = ports.outbox.post(channel, text, vec![user]).await {
                birthdays::release(&app.db, user, today.year().into()).await?;
                tracing::warn!(%error, user, "birthday wish not sent, retried later");
                failed = Some(error);
            } else {
                tracing::info!(user, "birthday wished");
            }
        }
        // Le passage reste à refaire : seules les fêtes rendues repartiront.
        failed.map_or(Ok(()), |error| Err(error.into()))
    })
}

#[cfg(test)]
mod tests;
