//! Changelog joueur : versions publiées (embarquées) et entrées en attente.
//!
//! Règle d'annonce : seules les entrées `announce = true` partent sur Discord ; une version qui n'en a
//! aucune est marquée annoncée en silence. Les titres et la description reprennent ceux de la v1.

use serde::{Deserialize, Serialize};

/// `changelog/releases.toml`, embarqué : le binaire annonce sa propre version.
pub const RELEASES: &str = include_str!("../../../changelog/releases.toml");

mod unreleased {
    include!(concat!(env!("OUT_DIR"), "/unreleased.rs"));
}
pub use unreleased::UNRELEASED;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Feature,
    Enhancement,
    Fix,
    Chore,
}

impl Kind {
    /// Titre de section, repris de la v1 (`chore` y tombait dans « Autres »).
    fn title(self) -> &'static str {
        match self {
            Self::Feature => "✨ Nouvelles Fonctionnalités",
            Self::Enhancement => "🔧 Améliorations",
            Self::Fix => "🐛 Corrections",
            Self::Chore => "📋 Autres",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Entry {
    #[serde(rename = "type")]
    pub kind: Kind,
    pub name: String,
    pub description: String,
    pub announce: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Release {
    pub version: String,
    pub date: String,
    #[serde(default, rename = "entry")]
    pub entries: Vec<Entry>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Changelog {
    #[serde(default)]
    pub release: Vec<Release>,
}

impl Changelog {
    pub fn parse(text: &str) -> Result<Self, toml::de::Error> {
        toml::from_str(text)
    }

    pub fn find(&self, version: &str) -> Option<&Release> {
        self.release
            .iter()
            .find(|release| release.version == version)
    }
}

pub fn parse_entry(text: &str) -> Result<Entry, toml::de::Error> {
    toml::from_str(text)
}

/// Ce qu'on poste sur Discord pour une version : sections dans l'ordre des types.
#[derive(Debug, PartialEq, Eq)]
pub struct Announcement {
    pub count: usize,
    pub sections: Vec<(&'static str, String)>,
}

/// Limite d'un champ d'embed Discord.
const FIELD_MAX: usize = 1024;

/// `None` quand aucune entrée n'est à annoncer.
pub fn announcement(entries: &[Entry]) -> Option<Announcement> {
    let announced: Vec<&Entry> = entries.iter().filter(|entry| entry.announce).collect();
    if announced.is_empty() {
        return None;
    }
    let sections = [Kind::Feature, Kind::Enhancement, Kind::Fix, Kind::Chore]
        .into_iter()
        .filter_map(|kind| {
            let lines: Vec<String> = announced
                .iter()
                .filter(|entry| entry.kind == kind)
                .map(|entry| format!("• **{}**: {}", entry.name, entry.description))
                .collect();
            (!lines.is_empty()).then(|| (kind.title(), truncate(&lines.join("\n"))))
        })
        .collect();
    Some(Announcement {
        count: announced.len(),
        sections,
    })
}

/// Coupe comme la v1 (1020 caractères puis « ... »), sans jamais couper un caractère en deux.
fn truncate(text: &str) -> String {
    if text.chars().count() <= FIELD_MAX {
        return text.to_owned();
    }
    let mut cut: String = text.chars().take(FIELD_MAX - 4).collect();
    cut.push_str("...");
    cut
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(kind: Kind, name: &str, announce: bool) -> Entry {
        Entry {
            kind,
            name: name.into(),
            description: "d".into(),
            announce,
        }
    }

    #[test]
    fn only_announced_entries_are_posted_grouped_by_type() {
        let entries = [
            entry(Kind::Fix, "Correctif", true),
            entry(Kind::Feature, "Site seulement", false),
            entry(Kind::Feature, "Loterie", true),
        ];
        let announcement = announcement(&entries).expect("two announced entries");
        assert_eq!(announcement.count, 2);
        assert_eq!(
            announcement.sections,
            vec![
                (
                    "✨ Nouvelles Fonctionnalités",
                    "• **Loterie**: d".to_owned()
                ),
                ("🐛 Corrections", "• **Correctif**: d".to_owned()),
            ]
        );
        assert_eq!(super::announcement(&[entry(Kind::Fix, "x", false)]), None);
    }

    #[test]
    fn embedded_changelog_and_fragments_parse() {
        Changelog::parse(RELEASES).expect("releases.toml parses");
        for text in UNRELEASED {
            parse_entry(text).expect("unreleased entry parses");
        }
    }
}
