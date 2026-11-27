//! Les tweets étrangers d'une copie de lien X : leurs boutons « Traduire », et la traduction au clic
//! (`pcr_core::links::translation`), lus sur l'API de `FxTwitter`.
//!
//! Une API muette ou lente laisse la copie sans bouton, comme un tweet français : la copie n'attend
//! jamais la traduction.

use std::time::Duration;

use pcr_core::links::translation::{self as rules, Reply};
use serde_json::Value;

use crate::{App, outbox::Web};

/// Lit un tweet ; `None` s'il n'est plus lisible, une erreur si l'API ne répond pas.
async fn tweet(
    web: &dyn Web,
    id: &str,
    translate: bool,
    timeout_seconds: u32,
) -> Result<Option<Value>, String> {
    let page = web
        .get(
            &rules::api_url(id, translate),
            rules::USER_AGENT,
            Duration::from_secs(timeout_seconds.into()),
        )
        .await?;
    rules::parse_response(page.status, &page.body)
}

/// Les boutons (tweet, libellé) des tweets étrangers d'une copie, au plus `maxTweets` (et 5, une
/// rangée) ; aucun si la traduction est coupée.
pub async fn translate_buttons(
    app: &App,
    web: &dyn Web,
    tweet_ids: &[String],
) -> Vec<(String, String)> {
    let settings = app.game_config().links.translation.clone();
    if !settings.enabled || tweet_ids.is_empty() {
        return Vec::new();
    }
    let max = usize::try_from(settings.max_tweets)
        .unwrap_or(usize::MAX)
        .min(rules::BUTTONS_PER_ROW);
    let lookups = tweet_ids.iter().take(max).map(|id| async move {
        match tweet(web, id, false, settings.lookup_timeout_seconds).await {
            Ok(Some(tweet)) => {
                rules::foreign_language(&tweet).map(|_| rules::handle(&tweet).map(str::to_owned))
            }
            Ok(None) => None,
            Err(error) => {
                tracing::warn!(%error, id = %id, "tweet language unavailable");
                None
            }
        }
    });
    // Les lectures partent ensemble : chacune a son délai, la plus lente donne le rythme.
    let found = futures_util::future::join_all(lookups).await;
    let foreign: Vec<(usize, Option<String>)> = found
        .into_iter()
        .enumerate()
        .filter_map(|(index, handle)| handle.map(|handle| (index + 1, handle)))
        .collect();
    let labels = rules::button_labels(tweet_ids.len(), &foreign);
    foreign
        .iter()
        .zip(labels)
        .map(|((position, _), label)| (tweet_ids[position - 1].clone(), label))
        .collect()
}

/// Le clic sur « Traduire » : la traduction, ou pourquoi il n'y en a pas ; `max` borne le texte.
pub async fn translation(app: &App, web: &dyn Web, id: &str, max: usize) -> Reply {
    let timeout = app
        .game_config()
        .links
        .translation
        .translate_timeout_seconds;
    match tweet(web, id, true, timeout).await {
        Ok(found) => rules::reply(id, found.as_ref(), max),
        Err(error) => {
            tracing::warn!(%error, id, "tweet translation unavailable");
            Reply::Text(rules::UNAVAILABLE)
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;
    use crate::testing::{FakeWeb, TestApp};

    fn page(tweet: &str) -> String {
        format!(r#"{{"tweet": {tweet}}}"#)
    }

    #[tokio::test]
    async fn foreign_tweets_get_a_button_and_a_mute_api_none() {
        let t = TestApp::new("links", "2026-11-27T12:00:00Z").await;
        let web = FakeWeb(HashMap::from([
            (
                rules::api_url("11", false),
                page(r#"{"text": "Hello", "lang": "en", "author": {"screen_name": "sacha"}}"#),
            ),
            (
                rules::api_url("12", false),
                page(r#"{"text": "Salut", "lang": "fr", "author": {"screen_name": "ondine"}}"#),
            ),
            (
                rules::api_url("11", true),
                page(
                    r#"{"text": "Hello", "lang": "en", "translation": {"text": "Bonjour", "source_lang": "en"}}"#,
                ),
            ),
        ]));
        let ids = ["11".to_owned(), "12".to_owned(), "13".to_owned()];
        assert_eq!(
            translate_buttons(&t.app, &web, &ids).await,
            [("11".to_owned(), "Traduire @sacha".to_owned())]
        );
        assert!(matches!(
            translation(&t.app, &web, "11", 3500).await,
            Reply::Translation { body, .. } if body == "Bonjour"
        ));
        // Le tweet 13 ne répond pas : la traduction le dit.
        assert_eq!(
            translation(&t.app, &web, "13", 3500).await,
            Reply::Text(rules::UNAVAILABLE)
        );
        t.close().await;
    }
}
