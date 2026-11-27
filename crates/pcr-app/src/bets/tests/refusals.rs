//! Un test par refus : le texte montré, et rien n'a bougé en base.

use super::*;

#[tokio::test]
async fn nobody_bets_on_their_own_bet() {
    let t = setup("bets-own").await;
    crate::points::grant_user(&t.app, CREATOR, 500)
        .await
        .expect("grant");
    let bet = classic(&t).await;
    assert_eq!(
        refusal(stake_form(&t.app, bet, CREATOR, 1).await),
        rules::OWN_BET
    );
    assert_eq!(
        refusal(stake(&t.app, bet, CREATOR, 1, "10").await),
        rules::OWN_BET
    );
    let guess = estimation(&t).await;
    assert_eq!(
        refusal(estimate_form(&t.app, guess, CREATOR).await),
        rules::OWN_ESTIMATE
    );
    assert_eq!(
        refusal(estimate(&t.app, guess, CREATOR, "3", "10").await),
        rules::OWN_ESTIMATE
    );
    assert_eq!(balance(&t, CREATOR).await, 500);
    assert_eq!(t.scalar("SELECT count(*) FROM bet_participations").await, 0);
    t.close().await;
}

#[tokio::test]
async fn nobody_changes_option() {
    let t = setup("bets-option").await;
    let bet = classic(&t).await;
    stake(&t.app, bet, ALICE, 1, "100").await.expect("stake");
    let expected = "Tu as déjà parié sur **Oui**. Tu ne peux pas changer d'option.";
    assert_eq!(refusal(stake_form(&t.app, bet, ALICE, 2).await), expected);
    // Une modale ouverte sur l'option 2 avant la première mise : refusée aussi à l'envoi.
    assert_eq!(refusal(stake(&t.app, bet, ALICE, 2, "50").await), expected);
    assert_eq!(balance(&t, ALICE).await, 900);
    assert_eq!(
        stake_form(&t.app, bet, ALICE, 1)
            .await
            .expect("same option"),
        StakeForm {
            balance: 900,
            staked: Some(100)
        }
    );
    t.close().await;
}

#[tokio::test]
async fn a_stake_the_balance_does_not_cover_is_refused_with_the_figures() {
    let t = setup("bets-balance").await;
    let bet = classic(&t).await;
    crate::points::grant_user(&t.app, ALICE, 233_456)
        .await
        .expect("grant");
    assert_eq!(
        refusal(stake(&t.app, bet, ALICE, 1, "300000").await),
        "Tu n'as pas assez de points. Solde: 234\u{202f}456"
    );
    let guess = estimation(&t).await;
    estimate(&t.app, guess, BOB, "5", "400")
        .await
        .expect("estimate");
    // Relever la mise à 1 500 coûte 1 100 : il en manque 500.
    assert_eq!(
        refusal(estimate(&t.app, guess, BOB, "5", "1500").await),
        "Solde insuffisant. Manque 500 points."
    );
    assert_eq!(
        (balance(&t, ALICE).await, balance(&t, BOB).await),
        (234_456, 600)
    );
    assert_eq!(t.scalar("SELECT count(*) FROM bet_participations").await, 1);
    t.close().await;
}

#[tokio::test]
async fn closed_bets_take_nothing() {
    let t = setup("bets-closed").await;
    let guess = estimation(&t).await;
    estimate(&t.app, guess, ALICE, "1", "10")
        .await
        .expect("estimate");
    resolve_estimate(&t.app, guess, CREATOR, "1", CHANNEL)
        .await
        .expect("resolve");
    assert_eq!(
        refusal(estimate_form(&t.app, guess, BOB).await),
        rules::CLOSED_TO_ESTIMATES
    );
    assert_eq!(
        refusal(estimate(&t.app, guess, BOB, "1", "10").await),
        rules::ESTIMATE_CLOSED
    );
    assert_eq!(
        refusal(stake_form(&t.app, 999, BOB, 1).await),
        rules::NOT_FOUND
    );
    assert_eq!(balance(&t, BOB).await, 1000);
    t.app.stats.close().await;
    t.close().await;
}

#[tokio::test]
async fn only_the_creator_ends_a_bet() {
    let t = setup("bets-creator").await;
    let bet = classic(&t).await;
    stake(&t.app, bet, ALICE, 1, "100").await.expect("stake");
    assert_eq!(
        refusal(resolve_form(&t.app, bet, ALICE).await),
        rules::NOT_CREATOR
    );
    assert_eq!(refusal(lock(&t.app, bet, ALICE).await), rules::NOT_CREATOR);
    assert_eq!(
        refusal(cancel(&t.app, bet, ALICE).await),
        rules::NOT_CREATOR
    );
    assert_eq!(
        refusal(resolve(&t.app, bet, ALICE, 1, CHANNEL).await),
        rules::NOT_CREATOR
    );
    let guess = estimation(&t).await;
    assert_eq!(
        refusal(resolve_estimate(&t.app, guess, ALICE, "3", CHANNEL).await),
        rules::NOT_CREATOR
    );
    assert_eq!(
        t.scalar("SELECT count(*) FROM bets WHERE status = 'OPEN'")
            .await,
        2
    );
    t.close().await;
}

#[tokio::test]
async fn a_finished_bet_cannot_be_ended_again_nor_paid_twice() {
    let t = setup("bets-twice").await;
    let bet = classic(&t).await;
    stake(&t.app, bet, ALICE, 1, "100").await.expect("stake");
    stake(&t.app, bet, BOB, 2, "100").await.expect("stake");
    resolve(&t.app, bet, CREATOR, 1, CHANNEL)
        .await
        .expect("resolve");
    assert_eq!(
        refusal(resolve(&t.app, bet, CREATOR, 1, CHANNEL).await),
        rules::FINISHED
    );
    assert_eq!(refusal(cancel(&t.app, bet, CREATOR).await), rules::FINISHED);
    assert_eq!(refusal(lock(&t.app, bet, CREATOR).await), rules::FINISHED);
    assert_eq!(
        refusal(resolve_form(&t.app, bet, CREATOR).await),
        rules::FINISHED
    );
    assert_eq!(
        (balance(&t, ALICE).await, balance(&t, BOB).await),
        (1100, 900)
    );
    assert_eq!(
        t.scalar("SELECT count(*) FROM public_messages WHERE kind = 'bet_result'")
            .await,
        1
    );
    t.app.stats.close().await;
    t.close().await;
}

#[tokio::test]
async fn typed_values_and_options_are_checked() {
    let t = setup("bets-input").await;
    let bet = classic(&t).await;
    assert_eq!(
        refusal(stake(&t.app, bet, ALICE, 1, "12abc").await),
        rules::BAD_AMOUNT
    );
    assert_eq!(
        refusal(stake(&t.app, bet, ALICE, 1, "0").await),
        rules::BAD_AMOUNT
    );
    assert_eq!(
        refusal(stake(&t.app, bet, ALICE, 9, "10").await),
        rules::INVALID_OPTION
    );
    assert_eq!(
        refusal(stake_form(&t.app, bet, ALICE, 9).await),
        rules::INVALID_OPTION
    );
    let guess = estimation(&t).await;
    // Un bouton de mise sur une estimation : elle n'a pas d'options.
    assert_eq!(
        refusal(stake_form(&t.app, guess, ALICE, 1).await),
        rules::INVALID_OPTION
    );
    assert_eq!(
        refusal(estimate(&t.app, guess, ALICE, "beaucoup", "10").await),
        rules::BAD_PREDICTION
    );
    assert_eq!(
        refusal(resolve_estimate(&t.app, guess, CREATOR, "1,5", CHANNEL).await),
        rules::BAD_RESULT
    );
    assert_eq!(
        refusal(resolve(&t.app, bet, CREATOR, 9, CHANNEL).await),
        rules::BAD_WINNER
    );
    assert_eq!(
        refusal(create(&t.app, CREATOR, "Seul ?", &["Oui".to_owned()]).await),
        rules::TOO_FEW_OPTIONS
    );
    assert_eq!(balance(&t, ALICE).await, 1000);
    assert_eq!(t.scalar("SELECT count(*) FROM bets").await, 2);
    t.close().await;
}
