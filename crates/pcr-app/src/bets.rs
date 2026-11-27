//! Paris : `/bet`, `/estimate`, les mises et leur résolution (`pcr_core::bets` pour les règles).
//!
//! Le message d'un pari est la réponse à la commande qui le crée : la ligne `public_messages` ne naît
//! qu'après cette réponse ([`posted`]). Chaque changement monte ensuite sa version dans la transaction
//! qui le fait, et le résultat d'une résolution est un second message public, `bet_result`, rendu
//! depuis la base avec les fonctions mêmes qui ont payé ([`gains`]).
//!
//! Mises, remboursements et gains passent par `points::move_balance` (`Source::Bet`), dans la
//! transaction qui relit le pari : un pari fermé entre le clic et l'envoi de la modale ne prend plus
//! rien, et une résolution revendique le pari avant de payer.

mod resolve;
mod stake;
#[cfg(test)]
mod tests;

use pcr_core::{
    bets::{self as rules, Guess, Stake},
    refusal::Refusal,
};
pub use pcr_db::bets::{Bet, Participation, Status};
use pcr_db::{DbError, bets, public_messages};
pub use resolve::{ResolveForm, Resolved, cancel, lock, resolve, resolve_estimate, resolve_form};
pub use stake::{
    EstimateForm, Estimated, StakeForm, Staked, estimate, estimate_form, stake, stake_form,
};

use crate::App;

/// Le message du pari (`public_messages.kind`).
pub const MESSAGE: &str = "bet";
/// Le message du résultat.
pub const RESULT_MESSAGE: &str = "bet_result";

#[derive(Debug, thiserror::Error)]
pub enum BetsError {
    #[error("{0}")]
    Refused(Refusal),
    #[error(transparent)]
    Db(#[from] DbError),
}

fn refused(text: &str) -> BetsError {
    BetsError::Refused(Refusal::new(text))
}

/// Un pari tel que ses messages le montrent, lu d'un bloc.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct View {
    pub bet: Bet,
    pub options: Vec<(i64, String)>,
    pub participations: Vec<Participation>,
}

impl View {
    /// Toute la cagnotte.
    pub fn pool(&self) -> i64 {
        pool(&self.participations)
    }

    /// Les points misés sur une option.
    pub fn staked_on(&self, option: i64) -> i64 {
        self.participations
            .iter()
            .filter(|p| p.option_index == Some(option))
            .fold(0, |sum, p| sum.saturating_add(p.amount))
    }

    /// L'intitulé d'une option.
    pub fn label(&self, option: i64) -> Option<&str> {
        self.options
            .iter()
            .find(|(index, _)| *index == option)
            .map(|(_, label)| label.as_str())
    }

    /// Les gagnants d'un pari fermé et ce qu'ils ont touché.
    pub fn gains(&self) -> Vec<Gain> {
        gains(&self.bet, &self.participations)
    }
}

/// Ce qu'un gagnant a touché.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Gain {
    pub user: i64,
    pub staked: i64,
    /// Son estimation (pari d'estimation).
    pub prediction: Option<i64>,
    pub gain: i64,
}

fn pool(participations: &[Participation]) -> i64 {
    participations
        .iter()
        .fold(0, |sum, p| sum.saturating_add(p.amount))
}

/// Les gagnants d'un pari fermé (ceux de l'option gagnante, ou les estimations les plus proches) et
/// leur part de la cagnotte. Sert à payer et à afficher : le message montre ce qui a été versé.
pub fn gains(bet: &Bet, participations: &[Participation]) -> Vec<Gain> {
    let winners: Vec<Guess> = match (bet.winning_option, bet.estimate_result) {
        (Some(option), _) => participations
            .iter()
            .filter(|p| p.option_index == Some(option))
            .map(|p| Guess {
                user: p.user_id,
                amount: p.amount,
                prediction: 0,
            })
            .collect(),
        (None, Some(result)) => {
            let guesses: Vec<Guess> = participations
                .iter()
                .filter_map(|p| {
                    Some(Guess {
                        user: p.user_id,
                        amount: p.amount,
                        prediction: p.prediction?,
                    })
                })
                .collect();
            rules::closest(&guesses, result)
        }
        (None, None) => Vec::new(),
    };
    let stakes: Vec<Stake> = winners
        .iter()
        .map(|w| Stake {
            user: w.user,
            amount: w.amount,
        })
        .collect();
    let paid = rules::payouts(pool(participations), &stakes);
    winners
        .iter()
        .zip(paid)
        .map(|(winner, (_, gain))| Gain {
            user: winner.user,
            staked: winner.amount,
            prediction: bet.estimate_result.map(|_| winner.prediction),
            gain,
        })
        .collect()
}

/// Lit un pari et tout ce que ses messages montrent, dans une même lecture.
pub async fn view(app: &App, bet: i64) -> Result<Option<View>, DbError> {
    let mut tx = app.db.reader().begin().await.map_err(DbError::from)?;
    let Some(found) = bets::get(&mut tx, bet).await? else {
        return Ok(None);
    };
    let options = bets::options(&mut tx, bet).await?;
    let participations = bets::participations(&mut tx, bet).await?;
    Ok(Some(View {
        bet: found,
        options,
        participations,
    }))
}

/// `/bet` : un pari classique et ses options. Renvoie son numéro.
pub async fn create(
    app: &App,
    creator: i64,
    question: &str,
    options: &[String],
) -> Result<i64, BetsError> {
    if !(rules::MIN_OPTIONS..=rules::MAX_OPTIONS).contains(&options.len()) {
        return Err(refused(rules::TOO_FEW_OPTIONS));
    }
    insert(app, creator, question, false, options).await
}

/// `/estimate` : un pari d'estimation (le plus proche gagne). Renvoie son numéro.
pub async fn create_estimate(app: &App, creator: i64, question: &str) -> Result<i64, BetsError> {
    insert(app, creator, question, true, &[]).await
}

async fn insert(
    app: &App,
    creator: i64,
    question: &str,
    is_estimation: bool,
    options: &[String],
) -> Result<i64, BetsError> {
    let mut tx = app.db.writer().begin().await.map_err(DbError::from)?;
    let id = bets::create(&mut tx, creator, question, is_estimation, options).await?;
    tx.commit().await.map_err(DbError::from)?;
    Ok(id)
}

/// La réponse à `/bet` est partie (`message_id`), ou a échoué (`None` : le worker postera le
/// message). Le pari a désormais son message public. Un arrêt du bot entre la réponse et cet
/// enregistrement laisse le message figé (ses boutons marchent, il ne se réécrit plus) : c'est le
/// prix d'une ligne qui ne naît qu'avec son `message_id`, et qu'aucun worker ne peut poster en double.
pub async fn posted(
    app: &App,
    bet: i64,
    channel: i64,
    message_id: Option<i64>,
) -> Result<(), DbError> {
    public_messages::posted(
        &app.db,
        MESSAGE,
        bet,
        channel,
        message_id,
        app.clock.now_ms(),
    )
    .await?;
    app.public_messages_changed();
    Ok(())
}

/// Les statistiques de paris de l'année : celles de `user` et celles du serveur.
pub async fn stats(app: &App, user: i64) -> Result<crate::stats::BetStats, DbError> {
    app.stats.bet_stats(app.clock.now(), user).await
}
