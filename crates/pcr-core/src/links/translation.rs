//! Le bouton « Traduire » sous la copie d'un tweet étranger : la réponse de l'API de `FxTwitter`, le
//! nom de la langue, le texte échappé et coupé, et ce que dit le clic. Textes de la v1.

use std::sync::LazyLock;

use regex::Regex;
use serde_json::Value;

use crate::ids::Parsed;

/// L'action des boutons, `tweet_translate|<tweet>`.
pub const ACTION: &str = "tweet_translate";
/// Discord range au plus 5 boutons par rangée.
pub const BUTTONS_PER_ROW: usize = 5;
pub const USER_AGENT: &str = "Mozilla/5.0 (compatible; PCR-bot/1.0)";

pub const NO_LONGER_VALID: &str = "Ce bouton n'est plus valable.";
pub const UNAVAILABLE: &str = "La traduction ne répond pas, réessaie dans un instant.";
pub const UNREADABLE: &str = "Ce tweet n'est plus lisible : supprimé, ou son compte est protégé.";
pub const ALREADY_FRENCH: &str = "Ce tweet est déjà en français.";
pub const NOTHING: &str = "Ce tweet n'a rien à traduire.";

/// L'adresse d'un tweet sur l'API de `FxTwitter`, traduit en français sur demande.
pub fn api_url(id: &str, translate: bool) -> String {
    format!(
        "https://api.fxtwitter.com/status/{id}{}",
        if translate { "/fr" } else { "" }
    )
}

pub fn button_id(id: &str) -> String {
    format!("{ACTION}|{id}")
}

/// Le tweet d'un bouton : rien d'autre qu'un numéro ne part vers l'API.
pub fn parse_button(custom_id: &str) -> Option<&str> {
    let parsed = Parsed::new(custom_id);
    let id = parsed.arg(0)?;
    (parsed.action == ACTION && !id.is_empty() && id.bytes().all(|b| b.is_ascii_digit()))
        .then_some(id)
}

/// La réponse de l'API : le tweet, `None` s'il n'est plus lisible (supprimé, compte protégé :
/// 401, 404), une erreur si l'API est en panne ou muette.
pub fn parse_response(status: u16, body: &str) -> Result<Option<Value>, String> {
    if matches!(status, 401 | 404) {
        return Ok(None);
    }
    if !(200..300).contains(&status) {
        return Err(format!("API FxTwitter : {status}"));
    }
    let value: Value = serde_json::from_str(body).map_err(|e| e.to_string())?;
    Ok(value.get("tweet").filter(|tweet| !tweet.is_null()).cloned())
}

/// Les noms français des langues que Twitter attribue (`Intl.DisplayNames(["fr"])` de Node 22,
/// relevés à l'identique) ; un code inconnu ne donne rien : mieux vaut taire la langue qu'afficher
/// « qme ».
const LANGUAGES: [(&str, &str); 92] = [
    ("am", "amharique"),
    ("ar", "arabe"),
    ("bg", "bulgare"),
    ("bn", "bengali"),
    ("bo", "tibétain"),
    ("ca", "catalan"),
    ("chr", "cherokee"),
    ("ckb", "sorani"),
    ("cs", "tchèque"),
    ("cy", "gallois"),
    ("da", "danois"),
    ("de", "allemand"),
    ("dv", "maldivien"),
    ("el", "grec"),
    ("en", "anglais"),
    ("es", "espagnol"),
    ("et", "estonien"),
    ("eu", "basque"),
    ("fa", "persan"),
    ("fi", "finnois"),
    ("fil", "filipino"),
    ("fr", "français"),
    ("ga", "irlandais"),
    ("gl", "galicien"),
    ("gu", "goudjarati"),
    ("he", "hébreu"),
    ("hi", "hindi"),
    ("hr", "croate"),
    ("ht", "créole haïtien"),
    ("hu", "hongrois"),
    ("hy", "arménien"),
    ("id", "indonésien"),
    ("in", "indonésien"),
    ("is", "islandais"),
    ("it", "italien"),
    ("iu", "inuktitut"),
    ("iw", "hébreu"),
    ("ja", "japonais"),
    ("ka", "géorgien"),
    ("kk", "kazakh"),
    ("km", "khmer"),
    ("kn", "kannada"),
    ("ko", "coréen"),
    ("ky", "kirghize"),
    ("lo", "lao"),
    ("lt", "lituanien"),
    ("lv", "letton"),
    ("mk", "macédonien"),
    ("ml", "malayalam"),
    ("mn", "mongol"),
    ("mr", "marathi"),
    ("ms", "malais"),
    ("my", "birman"),
    ("ne", "népalais"),
    ("nl", "néerlandais"),
    ("no", "norvégien"),
    ("or", "odia"),
    ("pa", "pendjabi"),
    ("pl", "polonais"),
    ("ps", "pachto"),
    ("pt", "portugais"),
    ("ro", "roumain"),
    ("ru", "russe"),
    ("sd", "sindhi"),
    ("si", "cingalais"),
    ("sk", "slovaque"),
    ("sl", "slovène"),
    ("so", "somali"),
    ("sq", "albanais"),
    ("sr", "serbe"),
    ("sv", "suédois"),
    ("sw", "swahili"),
    ("ta", "tamoul"),
    ("te", "télougou"),
    ("tg", "tadjik"),
    ("th", "thaï"),
    ("ti", "tigrigna"),
    ("tk", "turkmène"),
    ("tl", "filipino"),
    ("tr", "turc"),
    ("ug", "ouïghour"),
    ("uk", "ukrainien"),
    ("ur", "ourdou"),
    ("uz", "ouzbek"),
    ("vi", "vietnamien"),
    ("yo", "yoruba"),
    ("zh", "chinois"),
    ("zh-cn", "chinois (Chine)"),
    ("zh-tw", "chinois (Taïwan)"),
    ("zh-hans", "chinois simplifié"),
    ("zh-hant", "chinois traditionnel"),
    ("pt-br", "portugais brésilien"),
];

/// « en » devient « anglais ».
pub fn language_name(code: &str) -> Option<&'static str> {
    let code = code.to_ascii_lowercase();
    LANGUAGES
        .iter()
        .find(|(known, _)| *known == code)
        .map(|(_, name)| *name)
}

fn is_french(lang: Option<&str>) -> bool {
    lang.is_some_and(|lang| lang.to_ascii_lowercase().split('-').next() == Some("fr"))
}

fn text_of<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

/// Le pseudo X de l'auteur, s'il en a la forme : il finit dans une adresse et sur un bouton.
pub fn handle(tweet: &Value) -> Option<&str> {
    let handle = tweet
        .get("author")
        .and_then(|author| text_of(author, "screen_name"))?;
    (!handle.is_empty()
        && handle
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_'))
    .then_some(handle)
}

/// La langue d'un tweet à traduire, nommée, ou `None` s'il n'y a rien à traduire : un tweet en
/// français, sans texte, « sans contenu linguistique » (zxx) ou d'une langue que Twitter code en
/// privé (qme : que des médias…).
pub fn foreign_language(tweet: &Value) -> Option<&'static str> {
    let lang = text_of(tweet, "lang");
    if text_of(tweet, "text").is_none_or(|text| text.trim().is_empty())
        || is_french(lang)
        || lang == Some("zxx")
    {
        return None;
    }
    language_name(lang?)
}

/// Le libellé de chaque bouton : seul tweet de la copie, « Traduire » ; sinon par son auteur, ou par
/// sa place quand l'auteur ne suffit pas à le distinguer. `foreign` : (place, pseudo) des tweets
/// étrangers, `tweets` : le nombre de tweets de la copie.
pub fn button_labels(tweets: usize, foreign: &[(usize, Option<String>)]) -> Vec<String> {
    foreign
        .iter()
        .map(|(position, handle)| {
            if tweets == 1 {
                return "Traduire".to_owned();
            }
            let twin = foreign
                .iter()
                .any(|(other, other_handle)| other != position && other_handle == handle);
            match handle {
                Some(handle) if !twin => format!("Traduire @{handle}"),
                _ => format!("Traduire le tweet {position}"),
            }
        })
        .collect()
}

/// Un lien dans une traduction, sans la ponctuation qui le suit dans la phrase.
static URL_IN_TEXT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?i)https?://[^\s<>]*[^\s<>.,:;"')\]!?]"#).expect("valid regex")
});
static MARKUP: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[\\*_~`|\[<]").expect("valid regex"));
static LINE_START: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?m)^([ \t]*)([#>-])").expect("valid regex"));
static NUMBERED: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?m)^([ \t]*\d+)\.").expect("valid regex"));
static OPEN_LINK: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)https?://\S*$").expect("valid regex"));

/// Tout ce que Discord mettrait en forme, échappé : le texte vient de l'auteur du tweet et part sous
/// le nom du bot. Les liens restent tels quels (l'échappement les casserait). Comme en v1, chaque
/// morceau entre deux liens est relu comme un début de ligne.
pub fn escape(text: &str) -> String {
    let escape_part = |part: &str| {
        let part = MARKUP.replace_all(part, r"\$0");
        let part = LINE_START.replace_all(&part, r"$1\$2");
        NUMBERED.replace_all(&part, r"$1\.").into_owned()
    };
    let mut out = String::with_capacity(text.len());
    let mut last = 0;
    for link in URL_IN_TEXT.find_iter(text) {
        out.push_str(&escape_part(&text[last..link.start()]));
        out.push_str(link.as_str());
        last = link.end();
    }
    out.push_str(&escape_part(&text[last..]));
    out
}

static INLINE_MARKUP: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[\\*_~`|\[\]<>()#@-]").expect("valid regex"));

/// Un texte d'une ligne qui ne forme rien : toute la mise en forme échappée, les retours à la ligne
/// changés en espaces (le nom d'un auteur, mis dans le texte d'un lien).
pub fn escape_inline(text: &str) -> String {
    let single = text.replace(['\n', '\r'], " ");
    INLINE_MARKUP.replace_all(&single, r"\$0").into_owned()
}

/// Coupé à `max` caractères, « … » compris, jamais au milieu d'un lien (tronqué, il mènerait
/// ailleurs).
pub fn truncate(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_owned();
    }
    let start: String = text.chars().take(max.saturating_sub(1)).collect();
    format!("{}…", OPEN_LINK.replace(&start, "").trim_end())
}

/// Ce que montre le clic sur « Traduire ».
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Reply {
    /// Pourquoi il n'y a pas de traduction.
    Text(&'static str),
    Translation {
        /// Le texte traduit, échappé et coupé à `max`.
        body: String,
        /// L'auteur (« Nom (@pseudo) ») et l'adresse du tweet, si son pseudo est lisible.
        author: Option<(String, String)>,
        footer: String,
    },
}

/// Longueur d'un nom d'auteur, comme l'auteur d'un embed v1.
const AUTHOR_MAX: usize = 256;

/// La réponse au clic pour le tweet `id` lu traduit (`None` : plus lisible) ; `max` borne le texte.
pub fn reply(id: &str, tweet: Option<&Value>, max: usize) -> Reply {
    let Some(tweet) = tweet else {
        return Reply::Text(UNREADABLE);
    };
    let translation = tweet.get("translation");
    let source = translation.and_then(|t| text_of(t, "source_lang"));
    if is_french(text_of(tweet, "lang")) || is_french(source) {
        return Reply::Text(ALREADY_FRENCH);
    }
    // Sans traduction, c'est l'API qui a échoué, pas le tweet qui s'y refuse.
    let Some(text) = translation.and_then(|t| text_of(t, "text")) else {
        return Reply::Text(UNAVAILABLE);
    };
    let text = text.trim();
    if text.is_empty() || text == text_of(tweet, "text").unwrap_or_default().trim() {
        return Reply::Text(NOTHING);
    }
    let author = handle(tweet).map(|handle| {
        // Le nom vient de l'auteur du tweet et finit dans le texte d'un lien : rien n'y doit former
        // un lien masqué, une mention ou une autre ligne.
        let name = match tweet.get("author").and_then(|a| text_of(a, "name")) {
            Some(name) => format!("{} (@{handle})", escape_inline(name)),
            None => format!("@{handle}"),
        };
        (
            truncate(&name, AUTHOR_MAX),
            format!("https://x.com/{handle}/status/{id}"),
        )
    });
    let language = language_name(
        source
            .filter(|source| !source.is_empty())
            .or_else(|| text_of(tweet, "lang"))
            .unwrap_or_default(),
    );
    Reply::Translation {
        body: truncate(&escape(text), max),
        author,
        footer: language.map_or_else(
            || "Traduction automatique".to_owned(),
            |language| format!("Traduction automatique · original en {language}"),
        ),
    }
}

#[cfg(test)]
mod tests;
