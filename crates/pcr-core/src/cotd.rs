//! Saints et fêtes du jour (`/cotd` et le message quotidien) : la réponse de nominis.cef.fr, la page
//! des journées mondiales de journee-mondiale.com, et le message de la v1.
//!
//! Les fêtes sont un bonus : une page illisible n'empêche pas les saints de partir.

use std::sync::LazyLock;

use regex::Regex;
use serde_json::Value;

/// Les prénoms fêtés aujourd'hui, selon nominis.
pub const SAINTS_URL: &str = "https://nominis.cef.fr/json/nominis.php";
/// L'identité que la v1 donnait au site des fêtes, qui refuse les clients anonymes.
pub const USER_AGENT: &str = "Mozilla/5.0 (compatible; PCR-bot/1.0)";

/// La page des journées mondiales d'un jour (« /date/03-09.htm »).
pub fn feasts_url(day: u8, month: u8) -> String {
    format!("https://www.journee-mondiale.com/date/{day:02}-{month:02}.htm")
}

/// Les saints d'un jour.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Saints {
    pub day: u8,
    pub month: u8,
    /// Prénom, et s'il est mixte.
    pub names: Vec<(String, bool)>,
}

/// Lit la réponse de nominis ; `None` si elle n'a pas la forme attendue (la v1 ne publiait alors
/// rien).
pub fn parse_saints(json: &str) -> Option<Saints> {
    let value: Value = serde_json::from_str(json).ok()?;
    let response = value.get("response")?;
    let query = response.get("query")?;
    let majors = response.get("prenoms")?.get("majeurs")?.as_object()?;
    let names = majors
        .iter()
        .map(|(name, info)| {
            let mixed = info.get("sexe").and_then(Value::as_str) == Some("mixte");
            (name.clone(), mixed)
        })
        .collect();
    Some(Saints {
        day: small_number(query.get("jour")?)?,
        month: small_number(query.get("mois")?)?,
        names,
    })
}

/// Un nombre que nominis écrit tantôt en nombre, tantôt en texte.
fn small_number(value: &Value) -> Option<u8> {
    match value {
        Value::Number(n) => n.as_u64().and_then(|n| u8::try_from(n).ok()),
        Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }
}

static ARTICLE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)<article\b[^>]*>(.*?)</article>").expect("valid regex"));
static TITLE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)<h2\b[^>]*>(.*?)</h2>").expect("valid regex"));
static TAG: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s)<[^>]*>").expect("valid regex"));
static OPENING: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?i)<([a-z][a-z0-9]*)\b[^>]*\bid\s*=\s*["']journeesDuJour["'][^>]*>"#)
        .expect("valid regex")
});

/// Les journées d'une page de journee-mondiale.com : les titres des articles de la section
/// `#journeesDuJour`, nettoyés, sans doublon, plus longs que trois caractères.
pub fn parse_feasts(html: &str) -> Vec<String> {
    let Some(section) = section(html) else {
        return Vec::new();
    };
    let mut feasts: Vec<String> = Vec::new();
    for article in ARTICLE.captures_iter(section) {
        for title in TITLE.captures_iter(&article[1]) {
            let text = decode_entities(&TAG.replace_all(&title[1], ""));
            let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
            if text.chars().count() > 3 && !feasts.contains(&text) {
                feasts.push(text);
            }
        }
    }
    feasts
}

/// Le contenu de l'élément `id="journeesDuJour"`, jusqu'à sa balise fermante (les éléments du même
/// nom imbriqués sont comptés).
fn section(html: &str) -> Option<&str> {
    let opening = OPENING.captures(html)?;
    let tag = opening.get(1)?.as_str().to_ascii_lowercase();
    let start = opening.get(0)?.end();
    let open = Regex::new(&format!(r"(?i)<{tag}\b")).ok()?;
    let close = Regex::new(&format!(r"(?i)</{tag}\s*>")).ok()?;
    let mut depth = 1;
    let mut cursor = start;
    loop {
        let next_close = close.find_at(html, cursor)?;
        match open.find_at(html, cursor) {
            Some(next_open) if next_open.start() < next_close.start() => {
                depth += 1;
                cursor = next_open.end();
            }
            _ => {
                depth -= 1;
                if depth == 0 {
                    return Some(&html[start..next_close.start()]);
                }
                cursor = next_close.end();
            }
        }
    }
}

/// Les entités qu'un titre peut contenir.
fn decode_entities(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find('&') {
        out.push_str(&rest[..at]);
        rest = &rest[at..];
        let Some(end) = rest.find(';').filter(|end| *end <= 10) else {
            out.push('&');
            rest = &rest[1..];
            continue;
        };
        let entity = &rest[1..end];
        let decoded = match entity {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            "nbsp" => Some('\u{a0}'),
            _ => entity
                .strip_prefix("#x")
                .or_else(|| entity.strip_prefix("#X"))
                .and_then(|hex| u32::from_str_radix(hex, 16).ok())
                .or_else(|| entity.strip_prefix('#').and_then(|dec| dec.parse().ok()))
                .and_then(char::from_u32),
        };
        if let Some(c) = decoded {
            out.push(c);
            rest = &rest[end + 1..];
        } else {
            out.push('&');
            rest = &rest[1..];
        }
    }
    out.push_str(rest);
    out
}

/// Le message des saints et des fêtes du jour, texte de la v1.
pub fn message(saints: &Saints, feasts: &[String]) -> String {
    let mut text = format!(
        "Nous sommes le {:02}/{:02} et nous célébrons les :",
        saints.day, saints.month
    );
    for (name, mixed) in &saints.names {
        text.push_str("\n- ");
        text.push_str(name);
        if *mixed {
            text.push_str(" (Mixte)");
        }
    }
    if !feasts.is_empty() {
        text.push_str("\n\nFêtes du jour :");
        for feast in feasts {
            text.push_str("\n- ");
            text.push_str(feast);
        }
    }
    text.push_str("\nPour fêter ça, apéro !");
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saints_are_read_from_nominis() {
        let saints = parse_saints(
            r#"{"response":{"query":{"jour":"3","mois":9},"prenoms":{"majeurs":{
                "Grégoire":{"sexe":"masculin"},"Phœbé":{"sexe":"féminin"},"Sandy":{"sexe":"mixte"}}}}}"#,
        )
        .expect("saints");
        assert_eq!((saints.day, saints.month), (3, 9));
        assert_eq!(
            message(&saints, &["Journée mondiale du câlin".to_owned()]),
            "Nous sommes le 03/09 et nous célébrons les :\n- Grégoire\n- Phœbé\n- Sandy (Mixte)\n\n\
             Fêtes du jour :\n- Journée mondiale du câlin\nPour fêter ça, apéro !"
        );
        assert_eq!(
            message(&saints, &[]),
            "Nous sommes le 03/09 et nous célébrons les :\n- Grégoire\n- Phœbé\n- Sandy (Mixte)\n\
             Pour fêter ça, apéro !"
        );
        assert_eq!(parse_saints(r#"{"response":{}}"#), None);
        assert_eq!(parse_saints("<html>"), None);
    }

    #[test]
    fn feasts_are_read_like_v1() {
        // La page du test v1 (`test/utils.test.js`).
        let page = r#"<div id="journeesDuJour">
          <article><h2 itemprop="name">  Journée   mondiale
            du câlin </h2></article>
          <article><h2>Journée mondiale du câlin</h2></article>
          <article><h2>Fin</h2></article>
          <article><h2>Journée de la     lenteur</h2></article>
        </div><h2>Hors section : ignoré</h2>"#;
        assert_eq!(
            parse_feasts(page),
            ["Journée mondiale du câlin", "Journée de la lenteur"]
        );
        assert!(parse_feasts("<html><body><h2>Rien</h2></body></html>").is_empty());
        assert_eq!(
            parse_feasts(
                r#"<section id='journeesDuJour'><div><article><h2><a href="/x">L&#039;eau &amp; la terre</a></h2></article></div></section>"#
            ),
            ["L'eau & la terre"]
        );
        assert_eq!(
            feasts_url(3, 9),
            "https://www.journee-mondiale.com/date/03-09.htm"
        );
    }
}
