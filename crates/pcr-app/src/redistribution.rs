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
mod tests {
    use std::sync::Mutex;

    use rand::{SeedableRng as _, rngs::StdRng};

    use super::*;
    use crate::{
        members::{Member, Roster},
        testing::{TestApp, at},
    };

    /// `default_role_id` de `deploy/instance.example.toml`.
    const ROLE: i64 = 555_555_555_555_555_555;
    const HOUR: i64 = 3_600_000;
    const WEEK: i64 = 168 * HOUR;

    /// Le serveur vu par le pot : une liste fixe, ou une panne de Discord.
    #[derive(Debug)]
    struct Port(Mutex<Result<Roster, String>>);

    impl Port {
        fn with(ids: &[i64]) -> Self {
            Self(Mutex::new(Ok(Roster {
                role_name: Some("Dresseurs".to_owned()),
                members: ids
                    .iter()
                    .map(|&id| Member {
                        id,
                        bot: false,
                        roles: vec![ROLE],
                    })
                    .collect(),
            })))
        }
    }

    impl MembersPort for Port {
        fn roster(&self, _role: i64) -> members::PortFuture<'_, Roster> {
            let roster = self.0.lock().expect("lock").clone();
            Box::pin(async move { roster })
        }
    }

    fn rng() -> StdRng {
        StdRng::seed_from_u64(1)
    }

    async fn balances(t: &TestApp) -> (i64, i64) {
        (
            t.scalar("SELECT balance FROM points WHERE user_id = 1")
                .await,
            t.scalar("SELECT balance FROM points WHERE user_id = 2")
                .await,
        )
    }

    async fn deadline(t: &TestApp) -> i64 {
        t.scalar("SELECT next_redistribution_at FROM economy_state")
            .await
    }

    #[tokio::test]
    async fn the_first_tick_schedules_then_the_due_pot_runs_once_without_drift() {
        let t = TestApp::new("pot-schedule", "2026-10-06T10:00:00Z").await;
        t.sql("INSERT INTO points (user_id, balance) VALUES (1, 10000), (2, 0)")
            .await;
        let port = Port::with(&[1, 2]);
        let start = at("2026-10-06T10:00:00Z").as_millisecond();

        // Base neuve : la première échéance se pose, personne n'est prélevé.
        assert_eq!(
            tick(&t.app, &port, &mut rng()).await.expect("tick"),
            Tick::Scheduled
        );
        assert_eq!(deadline(&t).await, start + WEEK);
        let early = t.at("2026-10-07T10:00:00Z");
        assert_eq!(
            tick(&early, &port, &mut rng()).await.expect("tick"),
            Tick::NotDue
        );

        // Deux heures après l'échéance : 5 % de 10 000, la moitié revient à son cotisant.
        let due = t.at("2026-10-13T12:00:00Z");
        let Tick::Ran(outcome) = tick(&due, &port, &mut rng()).await.expect("tick") else {
            panic!("the pot should run");
        };
        assert_eq!((outcome.plan.pot, outcome.plan.share), (500, 250));
        assert_eq!(balances(&t).await, (9750, 250));
        assert_eq!(
            deadline(&t).await,
            start + 2 * WEEK,
            "from the old deadline"
        );
        assert_eq!(
            t.scalar("SELECT count(*) FROM points_redistributions WHERE triggered_by IS NULL")
                .await,
            1
        );
        assert_eq!(
            tick(&due, &port, &mut rng()).await.expect("tick"),
            Tick::NotDue
        );
        t.close().await;
    }

    #[tokio::test]
    async fn a_long_outage_gives_a_single_catch_up_pot() {
        let t = TestApp::new("pot-outage", "2026-10-06T10:00:00Z").await;
        t.sql("INSERT INTO points (user_id, balance) VALUES (1, 10000), (2, 0)")
            .await;
        let now = at("2026-10-06T10:00:00Z").as_millisecond();
        t.sql(format!(
            "UPDATE economy_state SET next_redistribution_at = {}",
            now - 3 * WEEK - HOUR
        ))
        .await;
        let port = Port::with(&[1, 2]);
        assert!(matches!(
            tick(&t.app, &port, &mut rng()).await,
            Ok(Tick::Ran(_))
        ));
        assert_eq!(
            tick(&t.app, &port, &mut rng()).await.expect("tick"),
            Tick::NotDue
        );
        assert_eq!(balances(&t).await, (9750, 250));
        assert!(deadline(&t).await > now);
        t.close().await;
    }

    #[tokio::test]
    async fn discord_down_or_an_empty_pot() {
        let t = TestApp::new("pot-postponed", "2026-10-06T10:00:00Z").await;
        t.sql("INSERT INTO points (user_id, balance) VALUES (1, 0), (2, -20)")
            .await;
        let now = at("2026-10-06T10:00:00Z").as_millisecond();
        t.sql(format!(
            "UPDATE economy_state SET next_redistribution_at = {}",
            now - HOUR
        ))
        .await;
        // Discord indisponible : l'échéance reste, le tour suivant réessaiera.
        let down = Port(Mutex::new(Err("timeout".to_owned())));
        assert_eq!(
            tick(&t.app, &down, &mut rng()).await.expect("tick"),
            Tick::Postponed("timeout".to_owned())
        );
        assert_eq!(deadline(&t).await, now - HOUR);
        // Personne n'a de quoi cotiser : la semaine est consommée, rien ne bouge.
        let port = Port::with(&[1, 2]);
        let skipped = tick(&t.app, &port, &mut rng()).await.expect("tick");
        assert_eq!(skipped, Tick::Skipped(Refusal::new(EMPTY_POT)));
        assert!(deadline(&t).await > now);
        assert_eq!(balances(&t).await, (0, -20));
        t.close().await;
    }

    #[tokio::test]
    async fn a_pot_that_fails_halfway_moves_nothing_and_keeps_its_deadline() {
        let t = TestApp::new("pot-failure", "2026-10-06T10:00:00Z").await;
        t.sql("INSERT INTO points (user_id, balance) VALUES (1, 10000), (2, 0)")
            .await;
        let now = at("2026-10-06T10:00:00Z").as_millisecond();
        t.sql(format!(
            "UPDATE economy_state SET next_redistribution_at = {}",
            now - HOUR
        ))
        .await;
        t.sql(
            "CREATE TRIGGER panne BEFORE INSERT ON points_redistributions
             BEGIN SELECT RAISE(ABORT, 'panne'); END",
        )
        .await;
        let port = Port::with(&[1, 2]);
        assert!(tick(&t.app, &port, &mut rng()).await.is_err());
        assert_eq!(balances(&t).await, (10000, 0));
        assert_eq!(deadline(&t).await, now - HOUR);
        assert_eq!(t.scalar("SELECT count(*) FROM points_log").await, 0);
        t.close().await;
    }

    #[tokio::test]
    async fn a_forced_pot_keeps_the_deadline_and_a_simulation_writes_nothing() {
        let t = TestApp::new("pot-forced", "2026-10-06T10:00:00Z").await;
        t.sql("INSERT INTO points (user_id, balance) VALUES (1, 1000), (2, 500)")
            .await;
        t.sql("UPDATE economy_state SET next_redistribution_at = 123")
            .await;
        let members = RoleMembers {
            role_name: "Dresseurs".to_owned(),
            members: vec![1, 2, 3],
        };
        let simulated = simulate(&t.app, &members, &mut rng())
            .await
            .expect("simulate");
        assert_eq!(simulated.plan.pot, 75);
        assert_eq!(balances(&t).await, (1000, 500));
        assert_eq!(
            t.scalar("SELECT count(*) FROM points_redistributions")
                .await,
            0
        );

        let forced = force(&t.app, &members, 42, &mut rng())
            .await
            .expect("force");
        assert_eq!(forced.plan.share, 25);
        assert_eq!(t.scalar("SELECT sum(balance) FROM points").await, 1500);
        assert_eq!(
            t.scalar("SELECT balance FROM points WHERE user_id = 3")
                .await,
            25
        );
        assert_eq!(deadline(&t).await, 123);
        assert_eq!(
            t.scalar("SELECT triggered_by FROM points_redistributions")
                .await,
            42
        );
        t.close().await;
    }
}
