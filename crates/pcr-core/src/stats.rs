//! Ce qu'un message apporte aux statistiques de l'année : ses mots et ses emoji, découpés comme en
//! v1 pour que les compteurs repris de la v1 et ceux de la v2 parlent de la même chose.

use std::sync::LazyLock;

use regex::Regex;

/// Tout ce qui n'est ni lettre, ni chiffre, ni apostrophe, ni trait d'union sépare deux mots :
/// « l'été » et « chats-noirs » restent entiers.
static SEPARATORS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[^\p{L}\p{N}'-]+").expect("valid regex"));

/// Un emoji serveur (`<:nom:id>`, pas les animés, comme en v1) ou un emoji Unicode, compté point de
/// code par point de code : 👍🏽 compte 👍 et 🏽, un drapeau ses deux lettres.
static EMOJI: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"<:[^:]+:\d+>|[\p{Emoji_Presentation}\p{Extended_Pictographic}]")
        .expect("valid regex")
});

/// Les mots de plus de deux lettres, en minuscules. La longueur est celle de JavaScript (unités
/// UTF-16), que la v1 comptait : « été » passe, un emoji seul n'est jamais un mot.
pub fn words(text: &str) -> Vec<String> {
    SEPARATORS
        .replace_all(&text.to_lowercase(), " ")
        .split_whitespace()
        .filter(|word| word.encode_utf16().count() > 2)
        .map(str::to_owned)
        .collect()
}

/// Les emoji du message, dans l'ordre. Un emoji serveur précédé d'une barre oblique inverse est
/// échappé (affiché en texte) : il ne compte pas, mais ce qu'il contient est relu comme en v1.
pub fn emoji(text: &str) -> Vec<String> {
    let mut found = Vec::new();
    let mut from = 0;
    while let Some(m) = EMOJI.find_at(text, from) {
        if m.as_str().starts_with("<:") && text[..m.start()].ends_with('\\') {
            from = m.start() + 1;
            continue;
        }
        found.push(m.as_str().to_owned());
        from = m.end();
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    // Sorties de la v1 (Node 22) sur les mêmes textes.

    #[test]
    fn words_are_cut_like_v1() {
        assert_eq!(
            words(
                "Salut, SALUT ! Un petit mot de l'été... et 420 chats-noirs. <:pepe:123> ÉTÉ ΣΑΣ 𝒜𝒜 ﬁne"
            ),
            [
                "salut",
                "salut",
                "petit",
                "mot",
                "l'été",
                "420",
                "chats-noirs",
                "pepe",
                "123",
                "été",
                "σας",
                "𝒜𝒜",
                "ﬁne"
            ]
        );
    }

    #[test]
    fn emoji_are_counted_like_v1() {
        assert_eq!(emoji("super 🎉🎉 et 😀"), ["🎉", "🎉", "😀"]);
        assert_eq!(
            emoji(r"<:pepe:123> \<:no:4> 👍🏽 🇫🇷 ❤️ © 1 #"),
            ["<:pepe:123>", "👍", "🏽", "🇫", "🇷", "❤", "©"]
        );
        assert_eq!(emoji(r"<a:dance:55> \<:🎉:1>"), ["🎉"]);
        assert_eq!(emoji("👨‍👩‍👧"), ["👨", "👩", "👧"]);
    }
}
