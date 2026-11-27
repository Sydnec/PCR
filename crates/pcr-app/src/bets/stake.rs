//! Miser : un clic ouvre la modale (lecture seule, refus immédiats), son envoi débite et enregistre la
//! mise d'un bloc, après avoir tout revérifié : le pari a pu fermer entre-temps.

use pcr_core::{bets as rules, format};
use pcr_db::{
    DbError,
    bets::{self, Status},
    points::{self, Overdraft, Source},
    public_messages,
};

use super::{BetsError, MESSAGE, Participation, refused};
use crate::App;

/// Ce que la modale de mise affiche.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StakeForm {
    pub balance: i64,
    /// Déjà misé sur cette option : la modale propose d'ajouter.
    pub staked: Option<i64>,
}

/// Un clic sur une option : peut-on miser, et avec quel solde ?
pub async fn stake_form(
    app: &App,
    bet: i64,
    user: i64,
    option: i64,
) -> Result<StakeForm, BetsError> {
    let mut conn = app.db.reader().acquire().await.map_err(DbError::from)?;
    let found = bets::get(&mut conn, bet)
        .await?
        .ok_or_else(|| refused(rules::NOT_FOUND))?;
    if found.status != Status::Open {
        return Err(refused(rules::CLOSED_TO_STAKES));
    }
    if found.creator_id == user {
        return Err(refused(rules::OWN_BET));
    }
    let staked = bets::participation(&mut conn, bet, user).await?;
    let options = bets::options(&mut conn, bet).await?;
    check_same_option(&options, staked.as_ref(), option)?;
    Ok(StakeForm {
        balance: points::balance_in(&mut conn, user).await?,
        staked: staked.map(|p| p.amount),
    })
}

/// On ne change pas d'option : la mise existante dit laquelle.
fn check_same_option(
    options: &[(i64, String)],
    staked: Option<&Participation>,
    option: i64,
) -> Result<(), BetsError> {
    let Some(chosen) = staked.and_then(|p| p.option_index) else {
        return Ok(());
    };
    if chosen == option {
        return Ok(());
    }
    let label = options
        .iter()
        .find(|(index, _)| *index == chosen)
        .map_or_else(|| format!("Option {chosen}"), |(_, label)| label.clone());
    Err(BetsError::Refused(rules::other_option(&label)))
}

/// Une mise enregistrée.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Staked {
    pub amount: i64,
    pub total: i64,
    /// Elle s'ajoute à une mise précédente.
    pub added: bool,
}

/// La modale de mise envoyée : `amount` (tapé) points sur `option`, débités d'un bloc avec
/// l'enregistrement de la mise.
pub async fn stake(
    app: &App,
    bet: i64,
    user: i64,
    option: i64,
    amount: &str,
) -> Result<Staked, BetsError> {
    let amount = rules::amount(amount).map_err(BetsError::Refused)?;
    let now_ms = app.clock.now_ms();
    let mut tx = app.db.writer().begin().await.map_err(DbError::from)?;
    let found = bets::get(&mut tx, bet)
        .await?
        .ok_or_else(|| refused(rules::NOT_FOUND))?;
    if found.status != Status::Open {
        return Err(refused(rules::STAKE_CLOSED));
    }
    let options = bets::options(&mut tx, bet).await?;
    if !options.iter().any(|(index, _)| *index == option) {
        return Err(refused(rules::INVALID_OPTION));
    }
    // Revérifiés à l'envoi : la v1 ne regardait plus ni l'auteur ni l'option, et une seconde modale
    // ouverte sur une autre option ajoutait la mise à la première.
    if found.creator_id == user {
        return Err(refused(rules::OWN_BET));
    }
    let previous = bets::participation(&mut tx, bet, user).await?;
    check_same_option(&options, previous.as_ref(), option)?;
    if points::move_balance(
        &mut tx,
        user,
        -amount,
        Overdraft::Refused,
        Source::Bet,
        now_ms,
    )
    .await?
    .is_none()
    {
        let balance = points::balance_in(&mut tx, user).await?;
        return Err(BetsError::Refused(rules::not_enough(&format::number(
            balance,
        ))));
    }
    let total = bets::add_stake(&mut tx, bet, user, option, amount).await?;
    public_messages::touch(&mut tx, MESSAGE, bet, now_ms).await?;
    tx.commit().await.map_err(DbError::from)?;
    app.public_messages_changed();
    Ok(Staked {
        amount,
        total,
        added: previous.is_some(),
    })
}

/// Ce que la modale d'estimation affiche.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EstimateForm {
    pub balance: i64,
    /// L'estimation déjà posée et sa mise : la modale les préremplit.
    pub current: Option<(i64, i64)>,
}

/// Un clic sur « Proposer une estimation ».
pub async fn estimate_form(app: &App, bet: i64, user: i64) -> Result<EstimateForm, BetsError> {
    let mut conn = app.db.reader().acquire().await.map_err(DbError::from)?;
    let found = bets::get(&mut conn, bet)
        .await?
        .filter(|found| found.is_estimation)
        .ok_or_else(|| refused(rules::NOT_FOUND))?;
    if found.status != Status::Open {
        return Err(refused(rules::CLOSED_TO_ESTIMATES));
    }
    if found.creator_id == user {
        return Err(refused(rules::OWN_ESTIMATE));
    }
    let current = bets::participation(&mut conn, bet, user)
        .await?
        .and_then(|p| Some((p.prediction?, p.amount)));
    Ok(EstimateForm {
        balance: points::balance_in(&mut conn, user).await?,
        current,
    })
}

/// Une estimation enregistrée.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Estimated {
    pub prediction: i64,
    pub amount: i64,
    /// Elle remplace une estimation précédente.
    pub updated: bool,
}

/// La modale d'estimation envoyée. Une estimation se modifie tant que le pari est ouvert : seule la
/// différence de mise est débitée, ou remboursée si elle baisse.
pub async fn estimate(
    app: &App,
    bet: i64,
    user: i64,
    prediction: &str,
    amount: &str,
) -> Result<Estimated, BetsError> {
    let prediction =
        rules::whole_number(prediction).ok_or_else(|| refused(rules::BAD_PREDICTION))?;
    let amount = rules::amount(amount).map_err(BetsError::Refused)?;
    let now_ms = app.clock.now_ms();
    let mut tx = app.db.writer().begin().await.map_err(DbError::from)?;
    let found = bets::get(&mut tx, bet)
        .await?
        .filter(|found| found.is_estimation)
        .ok_or_else(|| refused(rules::NOT_FOUND))?;
    if found.status != Status::Open {
        return Err(refused(rules::ESTIMATE_CLOSED));
    }
    if found.creator_id == user {
        return Err(refused(rules::OWN_ESTIMATE));
    }
    let previous = bets::participation(&mut tx, bet, user).await?;
    let cost = amount - previous.map_or(0, |p| p.amount);
    let overdraft = if cost > 0 {
        Overdraft::Refused
    } else {
        Overdraft::Allowed
    };
    if points::move_balance(&mut tx, user, -cost, overdraft, Source::Bet, now_ms)
        .await?
        .is_none()
    {
        let balance = points::balance_in(&mut tx, user).await?;
        return Err(BetsError::Refused(rules::short_by(&format::number(
            cost - balance,
        ))));
    }
    bets::set_estimate(&mut tx, bet, user, prediction, amount).await?;
    public_messages::touch(&mut tx, MESSAGE, bet, now_ms).await?;
    tx.commit().await.map_err(DbError::from)?;
    app.public_messages_changed();
    Ok(Estimated {
        prediction,
        amount,
        updated: previous.is_some(),
    })
}
