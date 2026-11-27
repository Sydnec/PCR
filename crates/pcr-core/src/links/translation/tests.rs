//! Les cas de `test/messages.test.js` de la v1 (« le bouton Traduire »).
use serde_json::json;

use super::*;

// Les cas de `test/messages.test.js` de la v1 (« le bouton Traduire »).

#[test]
fn only_foreign_tweets_with_text_get_a_button() {
    assert_eq!(
        foreign_language(&json!({"text": "Bonjour", "lang": "fr"})),
        None
    );
    assert_eq!(foreign_language(&json!({"text": "", "lang": "en"})), None);
    assert_eq!(
        foreign_language(&json!({"text": "🎉", "lang": "zxx"})),
        None
    );
    assert_eq!(
        foreign_language(&json!({"text": "Look", "lang": "qme"})),
        None
    );
    assert_eq!(
        foreign_language(&json!({"text": "Hello", "lang": "en"})),
        Some("anglais")
    );
    assert_eq!(button_id("10"), "tweet_translate|10");
}

#[test]
fn several_tweets_name_their_author_or_their_place() {
    let foreign = |pairs: &[(usize, Option<&str>)]| -> Vec<(usize, Option<String>)> {
        pairs
            .iter()
            .map(|(p, h)| (*p, h.map(str::to_owned)))
            .collect()
    };
    assert_eq!(
        button_labels(1, &foreign(&[(1, Some("sacha"))])),
        ["Traduire"]
    );
    assert_eq!(
        button_labels(2, &foreign(&[(1, Some("sacha")), (2, Some("ondine"))])),
        ["Traduire @sacha", "Traduire @ondine"]
    );
    assert_eq!(
        button_labels(2, &foreign(&[(1, Some("sacha")), (2, Some("sacha"))])),
        ["Traduire le tweet 1", "Traduire le tweet 2"]
    );
}

#[test]
fn only_a_tweet_number_goes_to_the_api() {
    for bad in [
        "tweet_translate|abc",
        "tweet_translate|1/../x",
        "tweet_translate|",
        "tweet_translate",
    ] {
        assert_eq!(parse_button(bad), None, "{bad}");
    }
    assert_eq!(parse_button("tweet_translate|40"), Some("40"));
    assert_eq!(
        api_url("40", true),
        "https://api.fxtwitter.com/status/40/fr"
    );
    assert_eq!(parse_response(404, ""), Ok(None));
    assert!(parse_response(500, "").is_err());
}

#[test]
fn the_translation_is_escaped_and_attributed() {
    let tweet = json!({
        "text": "Hello", "lang": "en",
        "author": {"screen_name": "sacha", "name": "Sacha"},
        "translation": {"text": "Bonjour *tout* le monde", "source_lang": "en"}
    });
    assert_eq!(
        reply("40", Some(&tweet), 4096),
        Reply::Translation {
            body: r"Bonjour \*tout\* le monde".to_owned(),
            author: Some((
                "Sacha (@sacha)".to_owned(),
                "https://x.com/sacha/status/40".to_owned()
            )),
            footer: "Traduction automatique · original en anglais".to_owned(),
        }
    );
    let escaped = escape(
        "# Titre\n> citation\n- liste\n1. un\n<@123> [piège](https://evil.example) voir https://exemple.fr/a_b_c.",
    );
    for part in [
        r"\# Titre",
        r"\> citation",
        r"\- liste",
        r"1\. un",
        r"\<@123>",
        r"\[piège]",
    ] {
        assert!(escaped.contains(part), "{part} dans : {escaped}");
    }
    assert!(escaped.ends_with(" https://exemple.fr/a_b_c."));
}

#[test]
fn a_long_translation_is_cut_without_breaking_a_link() {
    let long = format!(
        "{} https://exemple.fr/un-long-lien-qui-depasse",
        "a".repeat(4090)
    );
    let cut = truncate(&long, 4096);
    assert!(cut.chars().count() <= 4096);
    assert!(cut.ends_with('…'));
    assert!(!cut.contains("https://"));
}

#[test]
fn the_reply_says_why_there_is_nothing() {
    assert_eq!(reply("50", None, 4096), Reply::Text(UNREADABLE));
    let french = json!({"text": "Salut", "lang": "fr", "translation": {"text": "Salut"}});
    assert_eq!(
        reply("51", Some(&french), 4096),
        Reply::Text(ALREADY_FRENCH)
    );
    let same = json!({"text": "🎉 https://x.fr", "lang": "en",
        "translation": {"text": "🎉 https://x.fr", "source_lang": "en"}});
    assert_eq!(reply("52", Some(&same), 4096), Reply::Text(NOTHING));
    let mute = json!({"text": "Hello", "lang": "en"});
    assert_eq!(reply("53", Some(&mute), 4096), Reply::Text(UNAVAILABLE));
}

#[test]
fn the_author_name_forms_no_link() {
    let tweet = json!({
        "text": "Hello", "lang": "en",
        "author": {"screen_name": "sacha", "name": "x](https://piege.example) [\n**gras"},
        "translation": {"text": "Bonjour", "source_lang": "en"}
    });
    let Reply::Translation {
        author: Some((name, _)),
        ..
    } = reply("40", Some(&tweet), 4096)
    else {
        panic!("translation expected");
    };
    assert_eq!(name, r"x\]\(https://piege.example\) \[ \*\*gras (@sacha)");
    assert_eq!(handle(&json!({"author": {"screen_name": "sächa"}})), None);
}
