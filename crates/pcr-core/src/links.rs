//! Liens X et Instagram : un message qui en contient est republié avec leurs miroirs, dont Discord
//! affiche l'aperçu (`modules/links.js` de la v1), et les tweets étrangers reçoivent un bouton
//! « Traduire » ([`translation`]).
//!
//! Chaque lien est analysé et son hôte comparé exactement : une expression régulière sur le texte
//! prendrait aussi « `https://x.com.pirate.net` », que le bot republierait sous le nom du membre.

pub mod translation;

use std::sync::LazyLock;

use regex::Regex;
use url::Url;

/// Un message Discord tient en 2 000 caractères : au-delà, la copie échouerait.
pub const MESSAGE_MAX: usize = 2000;

struct Rule {
    hosts: &'static [&'static str],
    to: &'static str,
    /// Le chemin que le miroir sait afficher (Instagram : les reels seulement).
    path: Option<&'static str>,
    /// Un lien X désigne un tweet et perd sa requête (des traceurs).
    x: bool,
}

const RULES: [Rule; 2] = [
    Rule {
        hosts: &["x.com", "www.x.com", "twitter.com", "www.twitter.com"],
        to: "vxtwitter.com",
        path: None,
        x: true,
    },
    Rule {
        hosts: &["instagram.com", "www.instagram.com"],
        to: "kkinstagram.com",
        path: Some("/reel/"),
        x: false,
    },
];

/// Un lien, jusqu'au premier blanc, chevron, parenthèse, crochet, virgule ou accent grave : ce qui
/// l'entoure dans la phrase ne lui appartient pas.
static LINK: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)https://[^\s<>()\[\],`]+").expect("valid regex"));
/// Un lien masqué, `[texte](adresse)` : son texte peut dire x.com et mener ailleurs.
static MASKED: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\]\(\s*<?https?://").expect("valid regex"));
/// Le tweet que désigne un lien (`…/status/123`, `/i/web/status/123`).
static TWEET: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)/status(?:es)?/(\d+)").expect("valid regex"));
/// Là où la requête est le contenu : une recherche, un hashtag filtré, un lien d'intention.
static KEEPS_QUERY: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^/(?:search|hashtag|intent)(?:/|$)").expect("valid regex"));
/// L'hôte (et ce qui l'accompagne) d'un lien, jusqu'au chemin, à la requête ou au fragment.
static AUTHORITY: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^https://[^/\\?#]+").expect("valid regex"));
/// La ponctuation et le markdown collés à la fin d'un lien appartiennent à la phrase.
static TAIL: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"^(.*?)([.!?;:'"*_~|]*)$"#).expect("valid regex"));

/// Un message réécrit.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rewritten {
    pub text: String,
    /// Les tweets désignés, sans doublon, dans l'ordre.
    pub tweet_ids: Vec<String>,
}

/// Le texte, liens X et Instagram réécrits vers leurs miroirs, ou `None` s'il n'y avait rien à
/// réécrire (ou un lien masqué, qui ne se republie jamais sous le nom du bot).
pub fn rewrite(text: &str) -> Option<Rewritten> {
    if MASKED.is_match(text) {
        return None;
    }
    let mut out = String::with_capacity(text.len());
    let mut tweet_ids = Vec::new();
    let mut changed = false;
    let mut last = 0;
    for found in LINK.find_iter(text) {
        out.push_str(&text[last..found.start()]);
        last = found.end();
        let raw = found.as_str();
        // Entre chevrons, l'aperçu est coupé exprès : le réécrire ne servirait à rien.
        if text[..found.start()].ends_with('<') {
            out.push_str(raw);
            continue;
        }
        match mirror(raw, &mut tweet_ids) {
            Some(mirrored) => {
                changed = true;
                out.push_str(&mirrored);
            }
            None => out.push_str(raw),
        }
    }
    out.push_str(&text[last..]);
    changed.then_some(Rewritten {
        text: out,
        tweet_ids,
    })
}

/// Le miroir d'un lien, ou `None` s'il n'en a pas.
fn mirror(raw: &str, tweet_ids: &mut Vec<String>) -> Option<String> {
    let url = Url::parse(raw).ok()?;
    // « x.com. » est le même hôte, écrit avec son point final.
    let host = url.host_str()?.trim_end_matches('.').to_ascii_lowercase();
    let path = url.path().to_lowercase();
    let rule = RULES.iter().find(|rule| {
        rule.hosts.contains(&host.as_str()) && rule.path.is_none_or(|start| path.starts_with(start))
    })?;
    if rule.x
        && let Some(id) = TWEET.captures(url.path()).map(|c| c[1].to_owned())
        && !tweet_ids.contains(&id)
    {
        tweet_ids.push(id);
    }
    let mirrored = AUTHORITY
        .replace(raw, format!("https://{}", rule.to).as_str())
        .into_owned();
    if !rule.x || KEEPS_QUERY.is_match(&path) {
        return Some(mirrored);
    }
    let parts = TAIL.captures(&mirrored)?;
    let (link, tail) = (&parts[1], &parts[2]);
    // Un « ? » venu après le « # » appartient au fragment, pas à la requête.
    let without_query = match (link.find('?'), link.find('#')) {
        (Some(query), Some(fragment)) if query < fragment => {
            format!("{}{}", &link[..query], &link[fragment..])
        }
        (Some(query), None) => link[..query].to_owned(),
        _ => link.to_owned(),
    };
    Some(without_query + tail)
}

/// La copie d'un message réécrit, sous la mention de son auteur ; `None` si elle dépasserait la
/// taille d'un message (l'original reste alors).
pub fn repost(author: u64, rewritten: &Rewritten) -> Option<String> {
    let text = format!("<@{author}> a envoyé :\n{}", rewritten.text);
    // La longueur que Discord compte, celle de JavaScript.
    (text.encode_utf16().count() <= MESSAGE_MAX).then_some(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Les cas de `test/messages.test.js` de la v1.

    fn text(input: &str) -> Option<String> {
        rewrite(input).map(|r| r.text)
    }

    #[test]
    fn x_links_go_to_the_mirror_without_their_trackers() {
        for host in ["x.com", "www.x.com", "twitter.com", "www.twitter.com"] {
            let result =
                rewrite(&format!("https://{host}/sacha/status/99?s=20#haut")).expect("rewritten");
            assert_eq!(
                result.text, "https://vxtwitter.com/sacha/status/99#haut",
                "{host}"
            );
            assert_eq!(result.tweet_ids, ["99"]);
        }
        for (input, expected) in [
            (
                "https://x.com/a/status/1?s=46&t=AbC-dEf_9",
                "https://vxtwitter.com/a/status/1",
            ),
            (
                "https://x.com/a/status/1?nouveau_traceur=xyz",
                "https://vxtwitter.com/a/status/1",
            ),
            (
                "voir https://x.com/sacha?s=21&t=x, merci",
                "voir https://vxtwitter.com/sacha, merci",
            ),
            (
                "https://x.com/a/status/1#bas?pas=requete",
                "https://vxtwitter.com/a/status/1#bas?pas=requete",
            ),
            (
                "https://x.com/search?q=pikachu&src=typed_query",
                "https://vxtwitter.com/search?q=pikachu&src=typed_query",
            ),
            (
                "https://x.com/hashtag/pikachu?f=live",
                "https://vxtwitter.com/hashtag/pikachu?f=live",
            ),
            (
                "https://x.com/intent/user?screen_name=sacha",
                "https://vxtwitter.com/intent/user?screen_name=sacha",
            ),
            (
                "https://x.com/searchlight/status/2?s=20",
                "https://vxtwitter.com/searchlight/status/2",
            ),
            (
                "https://instagram.com/reel/abc/?igsh=xyz",
                "https://kkinstagram.com/reel/abc/?igsh=xyz",
            ),
        ] {
            assert_eq!(text(input).as_deref(), Some(expected), "{input}");
        }
    }

    #[test]
    fn punctuation_and_markdown_stay_with_the_sentence() {
        for (input, expected) in [
            (
                "t'as vu https://x.com/a/status/1?s=20.",
                "t'as vu https://vxtwitter.com/a/status/1.",
            ),
            (
                "**https://x.com/a/status/1?s=20**",
                "**https://vxtwitter.com/a/status/1**",
            ),
            (
                "||https://x.com/a/status/1?s=20|| la fin",
                "||https://vxtwitter.com/a/status/1|| la fin",
            ),
            (
                "_https://x.com/a/status/1?s=20_",
                "_https://vxtwitter.com/a/status/1_",
            ),
            (
                "\"https://x.com/a/status/1?s=20\" !",
                "\"https://vxtwitter.com/a/status/1\" !",
            ),
            (
                "ça marche https://x.com/a/status/1?",
                "ça marche https://vxtwitter.com/a/status/1?",
            ),
            (
                "voir https://x.com/a/status/1, merci",
                "voir https://vxtwitter.com/a/status/1, merci",
            ),
            (
                "(https://x.com/a/status/1)",
                "(https://vxtwitter.com/a/status/1)",
            ),
            (
                "`https://x.com/a/status/1`",
                "`https://vxtwitter.com/a/status/1`",
            ),
            (
                "[https://x.com/a/status/1]",
                "[https://vxtwitter.com/a/status/1]",
            ),
        ] {
            assert_eq!(text(input).as_deref(), Some(expected), "{input}");
        }
    }

    #[test]
    fn only_instagram_reels_have_a_mirror() {
        assert_eq!(
            text("https://www.instagram.com/reel/abc/").as_deref(),
            Some("https://kkinstagram.com/reel/abc/")
        );
        assert_eq!(rewrite("https://instagram.com/p/abc/"), None);
        assert_eq!(rewrite("https://instagram.com/sacha"), None);
        assert!(
            rewrite("https://instagram.com/reel/abc")
                .expect("reel")
                .tweet_ids
                .is_empty()
        );
    }

    #[test]
    fn tweets_are_read_in_both_forms_once_each() {
        let ids = |input: &str| rewrite(input).expect("rewritten").tweet_ids;
        assert_eq!(ids("https://x.com/i/web/status/5"), ["5"]);
        assert_eq!(ids("https://twitter.com/a/statuses/6"), ["6"]);
        assert_eq!(
            ids("https://x.com/a/status/7 https://x.com/b/status/8 https://x.com/a/status/7"),
            ["7", "8"]
        );
        assert!(ids("https://x.com/sacha").is_empty());
    }

    #[test]
    fn hosts_are_compared_exactly() {
        for imposter in [
            "https://x.com.pirate.net/a/status/1",
            "https://pirate.net/x.com/a/status/1",
            "https://notx.com/a/status/1",
            "https://x.com@pirate.net/a/status/1",
            "https://twitter.com.evil.example/",
            "https://ixcom.example/",
            "https://x.co/a/status/1",
            "https://example.com/x.com/status/1",
            "http://x.com/a/status/1",
        ] {
            assert_eq!(rewrite(imposter), None, "{imposter}");
        }
        for input in [
            "HTTPS://X.COM/a/status/1",
            "https://x.com./a/status/1",
            "https://x.com:443/a/status/1",
        ] {
            assert_eq!(
                text(input).as_deref(),
                Some("https://vxtwitter.com/a/status/1"),
                "{input}"
            );
        }
    }

    #[test]
    fn hidden_or_masked_links_are_left_alone() {
        assert_eq!(rewrite("<https://x.com/a/status/1>"), None);
        assert_eq!(
            text("<https://x.com/a/status/1> et https://x.com/b/status/2").as_deref(),
            Some("<https://x.com/a/status/1> et https://vxtwitter.com/b/status/2")
        );
        for masked in [
            "[x.com](https://evil.example/phishing) https://x.com/a/status/1",
            "[clique](<https://evil.example>) https://x.com/a/status/1",
            "[clique]( http://evil.example ) https://x.com/a/status/1",
        ] {
            assert_eq!(rewrite(masked), None, "{masked}");
        }
        assert_eq!(rewrite(""), None);
        assert_eq!(rewrite("bonjour"), None);
        assert_eq!(
            text("https://example.com/a?x=1 puis https://x.com/b/status/3 et https://youtube.com/watch?v=1").as_deref(),
            Some("https://example.com/a?x=1 puis https://vxtwitter.com/b/status/3 et https://youtube.com/watch?v=1")
        );
    }

    #[test]
    fn a_copy_too_long_for_one_message_is_not_made() {
        let short = rewrite("https://x.com/a/status/1").expect("rewritten");
        assert_eq!(
            repost(42, &short).as_deref(),
            Some("<@42> a envoyé :\nhttps://vxtwitter.com/a/status/1")
        );
        let long =
            rewrite(&format!("{} https://x.com/a/status/1", "a".repeat(1990))).expect("rewritten");
        assert_eq!(repost(42, &long), None);
    }
}
