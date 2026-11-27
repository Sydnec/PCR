//! Pot commun : une fois par échéance, chacun cotise une part de sa fortune et la cagnotte repart en
//! parts égales entre les porteurs du rôle par défaut (`pcr_core::redistribution`).
//!
//! Le prélèvement est obligatoire, automatique et silencieux : rien n'est publié, le récapitulatif
//! n'existe que pour les administrateurs (`/admin potcommun`) et dans le journal du bot.
//!
//! L'échéance vit en base et une boucle horaire la regarde. Tout ce qui peut échouer côté Discord
//! (la liste des membres) se joue avant la transaction ; la transaction revendique l'échéance,
//! applique les mouvements et journalise d'un bloc. Une panne en cours de route défait donc tout,
//! échéance comprise : le tour suivant réessaie, et aucun pot ne se rejoue après avoir payé.

use std::{sync::Arc, time::Duration};

use pcr_core::{
    redistribution::{self as rules, Plan},
    refusal::Refusal,
};
use pcr_db::{
    DbError,
    points::{self, Overdraft, Source},
    redistribution::{self, Journal},
};
use rand::Rng;
use tokio::sync::watch;

use crate::{
    App,
    members::{self, MembersPort, RoleMembers, Wanted},
};

/// Cadence de la boucle : l'échéance part au plus une heure après son heure, comme en v1.
const TICK: Duration = Duration::from_hours(1);

const EMPTY_POT: &str = "Personne n'a de quoi cotiser : le pot serait vide.";

#[derive(Debug, thiserror::Error)]
pub enum PotError {
    #[error("{0}")]
    Refused(Refusal),
    #[error(transparent)]
    Db(#[from] DbError),
}

/// Un pot calculé (et appliqué, sauf simulation).
#[derive(Debug, Clone, PartialEq)]
pub struct Outcome {
    pub plan: Plan,
    pub percent: f64,
    pub role_name: String,
}

/// Ce qu'un tour de la boucle a fait.
#[derive(Debug, PartialEq)]
pub enum Tick {
    Disabled,
    /// Première échéance posée sur une base neuve, sans prélever personne.
    Scheduled,
    NotDue,
    /// Échéance intacte : réessai au tour suivant (Discord indisponible, rôle introuvable…).
    Postponed(String),
    /// Échéance consommée sans pot (personne n'avait de quoi cotiser).
    Skipped(Refusal),
    Ran(Outcome),
}

/// Qui déclenche le pot appliqué.
#[derive(Debug, Clone, Copy)]
enum Trigger {
    /// L'échéance `due`, revendiquée dans la transaction du pot.
    Schedule { due: i64 },
    /// `/admin potcommun` : l'échéance ne bouge pas.
    Admin(i64),
}

/// Le pot que donneraient les soldes actuels de ces membres ; rien n'est écrit.
pub async fn simulate(
    app: &App,
    members: &RoleMembers,
    rng: &mut (impl Rng + Send),
) -> Result<Outcome, PotError> {
    let percent = app.game_config().redistribution.contribution_percent;
    let mut reader = app.db.reader().acquire().await.map_err(DbError::from)?;
    let balances = points::balances(&mut reader, &members.members).await?;
    let plan = rules::plan(&with_balances(members, &balances), percent, rng);
    if plan.pot <= 0 {
        return Err(PotError::Refused(Refusal::new(EMPTY_POT)));
    }
    Ok(Outcome {
        plan,
        percent,
        role_name: members.role_name.clone(),
    })
}

/// `/admin potcommun` : un pot hors calendrier, qui s'ajoute à l'échéance sans la déplacer.
pub async fn force(
    app: &App,
    members: &RoleMembers,
    admin: i64,
    rng: &mut (impl Rng + Send),
) -> Result<Outcome, PotError> {
    apply(app, members, Trigger::Admin(admin), rng)
        .await
        .map(|outcome| outcome.expect("an admin pot claims nothing"))
}

/// L'échéance du prochain pot automatique (0 : pas encore posée).
pub async fn next_due(app: &App) -> Result<i64, DbError> {
    redistribution::next_due_now(&app.db).await
}

/// Un tour de la boucle : rien tant que l'échéance n'est pas atteinte.
pub async fn tick(
    app: &App,
    port: &dyn MembersPort,
    rng: &mut (impl Rng + Send),
) -> Result<Tick, PotError> {
    let settings = app.game_config().redistribution.clone();
    if !settings.enabled {
        return Ok(Tick::Disabled);
    }
    let now = app.clock.now_ms();
    let interval = rules::interval_ms(settings.interval_hours);
    let mut conn = app.db.writer().acquire().await.map_err(DbError::from)?;
    if redistribution::schedule_first(&mut conn, now + interval).await? {
        return Ok(Tick::Scheduled);
    }
    drop(conn);
    // Coup d'œil avant d'appeler Discord : 167 tours sur 168 n'ont rien à faire.
    let due = redistribution::next_due_now(&app.db).await?;
    if due > now {
        return Ok(Tick::NotDue);
    }
    let members = match default_members(app, port).await {
        Ok(Ok(members)) => members,
        Ok(Err(refusal)) => return Ok(Tick::Postponed(refusal.text().to_owned())),
        Err(reason) => return Ok(Tick::Postponed(reason)),
    };
    match apply(app, &members, Trigger::Schedule { due }, rng).await {
        Ok(Some(outcome)) => Ok(Tick::Ran(outcome)),
        Ok(None) => Ok(Tick::NotDue),
        Err(PotError::Refused(refusal)) => Ok(Tick::Skipped(refusal)),
        Err(error) => Err(error),
    }
}

/// Les membres du rôle par défaut, lus sur Discord : `Err` pour une panne passagère, un refus si le
/// rôle manque ou que personne ne le porte.
pub async fn default_members(
    app: &App,
    port: &dyn MembersPort,
) -> Result<Result<RoleMembers, Refusal>, String> {
    let Some(role) = app.instance.discord.default_role_id else {
        return Ok(Err(members::missing(Wanted::Default)));
    };
    let roster = port.roster(i64_id(role)).await?;
    Ok(members::role_members(
        &roster,
        i64_id(role),
        i64_id(app.instance.discord.guild_id),
        Wanted::Default,
    ))
}

fn i64_id(id: u64) -> i64 {
    i64::try_from(id).unwrap_or(i64::MAX)
}

fn with_balances(
    members: &RoleMembers,
    balances: &std::collections::HashMap<i64, i64>,
) -> Vec<(i64, i64)> {
    // Un membre sans ligne n'a jamais rien gagné : solde nul, il touche sa part sans cotiser.
    members
        .members
        .iter()
        .map(|&user| (user, balances.get(&user).copied().unwrap_or(0)))
        .collect()
}

/// Revendique l'échéance (pot automatique), calcule et applique le pot, le journalise : une
/// transaction. `None` : l'échéance n'était plus celle attendue, un autre tour l'a prise.
async fn apply(
    app: &App,
    members: &RoleMembers,
    trigger: Trigger,
    rng: &mut (impl Rng + Send),
) -> Result<Option<Outcome>, PotError> {
    let settings = app.game_config().redistribution.clone();
    let percent = settings.contribution_percent;
    let now = app.clock.now_ms();
    let mut tx = app.db.writer().begin().await.map_err(DbError::from)?;
    if let Trigger::Schedule { due } = trigger {
        let next = rules::next_due(due, now, rules::interval_ms(settings.interval_hours));
        if !redistribution::claim(&mut tx, due, next).await? {
            return Ok(None);
        }
    }
    let balances = points::balances(&mut tx, &members.members).await?;
    let plan = rules::plan(&with_balances(members, &balances), percent, rng);
    if plan.pot <= 0 {
        // Pas passager : réessayer dans une heure ne donnerait rien de plus. L'échéance revendiquée
        // est donc consommée ; un pot forcé, lui, n'a rien écrit.
        tx.commit().await.map_err(DbError::from)?;
        return Err(PotError::Refused(Refusal::new(EMPTY_POT)));
    }
    for entry in &plan.entries {
        // Le net seulement : personne ne voit son solde plonger le temps du calcul.
        points::move_balance(
            &mut tx,
            entry.user,
            entry.delta(),
            Overdraft::Allowed,
            Source::Redistribution,
            now,
        )
        .await?;
    }
    let triggered_by = match trigger {
        Trigger::Schedule { .. } => None,
        Trigger::Admin(admin) => Some(admin),
    };
    redistribution::journal(
        &mut tx,
        &Journal {
            ran_at: now,
            triggered_by,
            percent,
            participants: plan.participants,
            contributors: plan.contributors,
            pot: plan.pot,
            share: plan.share,
        },
    )
    .await?;
    tx.commit().await.map_err(DbError::from)?;
    tracing::info!(
        pot = plan.pot,
        contributors = plan.contributors,
        share = plan.share,
        participants = plan.participants,
        role = %members.role_name,
        ?triggered_by,
        "pot commun applied"
    );
    Ok(Some(Outcome {
        plan,
        percent,
        role_name: members.role_name.clone(),
    }))
}

/// La boucle horaire du pot commun, jusqu'à l'arrêt. Le premier tour part au démarrage : une
/// échéance passée pendant l'arrêt est rattrapée tout de suite.
pub async fn run(app: App, port: Arc<dyn MembersPort>, mut shutdown: watch::Receiver<bool>) {
    loop {
        let mut rng = App::rng();
        match tick(&app, &*port, &mut rng).await {
            Ok(Tick::Scheduled) => tracing::info!("pot commun: first deadline scheduled"),
            Ok(Tick::Postponed(reason)) => {
                tracing::warn!(%reason, "pot commun postponed, deadline kept");
            }
            Ok(Tick::Skipped(refusal)) => {
                tracing::info!(reason = %refusal, "pot commun skipped, deadline consumed");
            }
            Ok(Tick::Disabled | Tick::NotDue | Tick::Ran(_)) => {}
            Err(error) => tracing::error!(?error, "pot commun failed, deadline kept"),
        }
        tokio::select! {
            () = tokio::time::sleep(TICK) => {}
            _ = shutdown.wait_for(|stop| *stop) => return,
        }
    }
}

#[cfg(test)]
mod tests;
