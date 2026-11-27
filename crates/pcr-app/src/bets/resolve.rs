//! La fin d'un pari, réservée à son créateur : verrouiller les mises, annuler (tout est remboursé),
//! déclarer l'option gagnante ou la vraie valeur d'une estimation (les gagnants sont payés).
//!
//! Annuler et résoudre revendiquent le pari (`bets::finish`) dans la transaction qui rembourse ou
//! paie : deux menus de résolution ouverts en parallèle, ou une modale envoyée deux fois, ne paient
//! jamais deux fois. Le second voit un pari terminé et ne touche à rien.

use pcr_core::bets as rules;
use pcr_db::{
    DbError,
    bets::{self, Bet, Outcome},
    points::{self, Overdraft, Source},
    public_messages,
    stats::Counter,
};

use super::{BetsError, MESSAGE, RESULT_MESSAGE, gains, refused};
use crate::App;

/// Ce que le bouton « Déclarer le résultat » ouvre.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResolveForm {
    /// La modale du résultat d'une estimation.
    Estimate,
    /// Le menu des options ; `open` : on peut encore clore les mises.
    Classic {
        options: Vec<(i64, String)>,
        open: bool,
    },
}

/// Le pari, si `user` peut encore le terminer.
async fn pending_bet(conn: &mut pcr_db::Conn, bet: i64, user: i64) -> Result<Bet, BetsError> {
    let found = bets::get(conn, bet)
        .await?
        .ok_or_else(|| refused(rules::NOT_FOUND))?;
    if found.creator_id != user {
        return Err(refused(rules::NOT_CREATOR));
    }
    if !found.status.is_pending() {
        return Err(refused(rules::FINISHED));
    }
    Ok(found)
}

/// Un clic sur « Déclarer le résultat ».
pub async fn resolve_form(app: &App, bet: i64, user: i64) -> Result<ResolveForm, BetsError> {
    let mut conn = app.db.reader().acquire().await.map_err(DbError::from)?;
    let found = pending_bet(&mut conn, bet, user).await?;
    if found.is_estimation {
        return Ok(ResolveForm::Estimate);
    }
    let options = bets::options(&mut conn, bet).await?;
    if options.is_empty() {
        return Err(refused(rules::NO_OPTIONS));
    }
    Ok(ResolveForm::Classic {
        options,
        open: found.status == bets::Status::Open,
    })
}

/// « Clôturer les paris » : plus de mises, le résultat viendra plus tard. Déjà clos, rien ne change.
pub async fn lock(app: &App, bet: i64, user: i64) -> Result<(), BetsError> {
    let mut tx = app.db.writer().begin().await.map_err(DbError::from)?;
    pending_bet(&mut tx, bet, user).await?;
    if bets::lock(&mut tx, bet).await? {
        public_messages::touch(&mut tx, MESSAGE, bet, app.clock.now_ms()).await?;
    }
    tx.commit().await.map_err(DbError::from)?;
    app.public_messages_changed();
    Ok(())
}

/// « Annuler le pari » : chaque mise revient à son auteur. Renvoie le nombre de remboursés.
pub async fn cancel(app: &App, bet: i64, user: i64) -> Result<usize, BetsError> {
    let now_ms = app.clock.now_ms();
    let mut tx = app.db.writer().begin().await.map_err(DbError::from)?;
    pending_bet(&mut tx, bet, user).await?;
    if !bets::finish(&mut tx, bet, Outcome::Cancelled).await? {
        return Err(refused(rules::JUST_FINISHED));
    }
    let participations = bets::participations(&mut tx, bet).await?;
    for p in &participations {
        points::move_balance(
            &mut tx,
            p.user_id,
            p.amount,
            Overdraft::Allowed,
            Source::Bet,
            now_ms,
        )
        .await?;
    }
    public_messages::touch(&mut tx, MESSAGE, bet, now_ms).await?;
    tx.commit().await.map_err(DbError::from)?;
    app.public_messages_changed();
    Ok(participations.len())
}

/// Comment s'est terminée une résolution d'estimation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Resolved {
    /// Gagnants payés, résultats publiés.
    Paid,
    /// Personne n'avait participé.
    Empty,
}

/// L'option gagnante d'un pari classique : ses parieurs se partagent la cagnotte. Le résultat est
/// publié dans `channel`, le salon du pari.
pub async fn resolve(
    app: &App,
    bet: i64,
    user: i64,
    option: i64,
    channel: i64,
) -> Result<(), BetsError> {
    let mut tx = app.db.writer().begin().await.map_err(DbError::from)?;
    let found = pending_bet(&mut tx, bet, user).await?;
    if found.is_estimation
        || !bets::options(&mut tx, bet)
            .await?
            .iter()
            .any(|(index, _)| *index == option)
    {
        return Err(refused(rules::BAD_WINNER));
    }
    finish(app, tx, bet, Outcome::Winner(option), channel)
        .await
        .map(|_| ())
}

/// La vraie valeur d'une estimation (tapée) : les plus proches se partagent la cagnotte.
pub async fn resolve_estimate(
    app: &App,
    bet: i64,
    user: i64,
    result: &str,
    channel: i64,
) -> Result<Resolved, BetsError> {
    let result = rules::whole_number(result).ok_or_else(|| refused(rules::BAD_RESULT))?;
    let mut tx = app.db.writer().begin().await.map_err(DbError::from)?;
    let found = pending_bet(&mut tx, bet, user).await?;
    if !found.is_estimation {
        return Err(refused(rules::NOT_FOUND));
    }
    finish(app, tx, bet, Outcome::Result(result), channel).await
}

/// Revendique le pari, paie les gagnants et déclare le message du résultat, d'un bloc. Les stats de
/// l'année ne comptent qu'une résolution validée : elles s'ajoutent après le commit.
async fn finish(
    app: &App,
    mut tx: pcr_db::Transaction,
    bet: i64,
    outcome: Outcome,
    channel: i64,
) -> Result<Resolved, BetsError> {
    let now = app.clock.now();
    let now_ms = now.as_millisecond();
    if !bets::finish(&mut tx, bet, outcome).await? {
        return Err(refused(rules::JUST_FINISHED));
    }
    let closed = bets::get(&mut tx, bet)
        .await?
        .ok_or_else(|| refused(rules::NOT_FOUND))?;
    let participations = bets::participations(&mut tx, bet).await?;
    let paid = gains(&closed, &participations);
    for winner in &paid {
        points::move_balance(
            &mut tx,
            winner.user,
            winner.gain,
            Overdraft::Allowed,
            Source::Bet,
            now_ms,
        )
        .await?;
    }
    public_messages::touch(&mut tx, MESSAGE, bet, now_ms).await?;
    public_messages::create(&mut tx, RESULT_MESSAGE, bet, channel, now_ms).await?;
    tx.commit().await.map_err(DbError::from)?;

    for p in &participations {
        app.stats
            .add(now, Counter::BetWagered { user: p.user_id }, p.amount);
    }
    for winner in &paid {
        app.stats
            .add(now, Counter::BetMaxWin { user: winner.user }, winner.gain);
    }
    app.public_messages_changed();
    Ok(if participations.is_empty() {
        Resolved::Empty
    } else {
        Resolved::Paid
    })
}
