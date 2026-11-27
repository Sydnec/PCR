//! `/admin purge` et `/admin purge-membre` : le lien d'un message, l'âge d'un message lu dans son
//! identifiant (Discord ne supprime par lots que les messages de moins de 14 jours), la durée et le
//! bilan en MP. Textes de la v1.

use std::{fmt::Write as _, sync::LazyLock};

use regex::Regex;

use crate::format::number;

/// Discord ne rend et ne supprime pas plus de 100 messages par requête.
pub const PAGE: usize = 100;
/// L'âge au-delà duquel Discord refuse la suppression par lots.
pub const BULK_MAX_AGE_MS: i64 = 14 * 24 * 3_600_000;
/// L'époque des identifiants Discord (1er janvier 2015).
const DISCORD_EPOCH_MS: i64 = 1_420_070_400_000;

pub const NO_PARAMETER: &str = "Veuillez entrer un paramètre";
pub const BAD_LINK: &str = "❌ Lien invalide : indiquez le lien d'un message de **ce** salon.";
pub const LINK_NOT_FOUND: &str = "❌ Ce message est introuvable dans ce salon.";
pub const NOTHING_AFTER: &str = "Aucun message à supprimer après ce lien.";

static LINK: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^https?://(?:\w+\.)?discord(?:app)?\.com/channels/(\d+)/(\d+)/(\d+)/?$")
        .expect("valid regex")
});

/// Le salon et le message d'un lien Discord (`…/channels/<serveur>/<salon>/<message>`).
pub fn parse_message_link(link: &str) -> Option<(u64, u64)> {
    let parts = LINK.captures(link.trim())?;
    Some((parts[2].parse().ok()?, parts[3].parse().ok()?))
}

/// « 5 message(s) supprimé(s). »
pub fn deleted_count(deleted: usize) -> String {
    format!("{deleted} message(s) supprimé(s).")
}

/// Le bilan d'une purge jusqu'à un lien ; `full` : la page entière a été lue (il en reste peut-être).
pub fn deleted_until_link(deleted: usize, full: bool) -> String {
    let mut text = format!("{deleted} message(s) supprimé(s) jusqu'au lien indiqué.");
    if full {
        let _ = write!(
            text,
            "\n⚠️ Limite de {PAGE} messages atteinte, relancez la commande pour continuer."
        );
    }
    text
}

/// Un identifiant Discord tapé : 17 à 20 chiffres.
pub fn is_snowflake(text: &str) -> bool {
    (17..=20).contains(&text.len()) && text.bytes().all(|b| b.is_ascii_digit())
}

/// L'instant (ms) où un identifiant Discord a été créé.
pub fn created_ms(id: u64) -> i64 {
    i64::try_from(id >> 22).unwrap_or(i64::MAX) + DISCORD_EPOCH_MS
}

/// Un message assez récent pour partir dans un lot.
pub fn is_recent(id: u64, now_ms: i64) -> bool {
    now_ms - created_ms(id) < BULK_MAX_AGE_MS
}

/// « 1 h 2 min 3 s », « 4 min 0 s », « 5 s » : la durée d'une purge, comme en v1.
pub fn duration(ms: i64) -> String {
    let total = (ms + 500).div_euclid(1000).max(0);
    let (hours, minutes, seconds) = (total / 3600, total % 3600 / 60, total % 60);
    let mut parts = Vec::new();
    if hours > 0 {
        parts.push(format!("{hours} h"));
    }
    if hours > 0 || minutes > 0 {
        parts.push(format!("{minutes} min"));
    }
    parts.push(format!("{seconds} s"));
    parts.join(" ")
}

/// Coupe un texte en messages d'au plus `max` caractères, aux fins de ligne (`splitMessage` de la
/// v1). Les caractères se comptent comme Discord (unités UTF-16 : un emoji en vaut deux).
pub fn split_message(text: &str, max: usize) -> Vec<String> {
    let len = |text: &str| text.encode_utf16().count();
    let mut messages = Vec::new();
    let mut current = String::new();
    for line in text.split('\n') {
        if !current.is_empty() && len(&current) + len(line) + 1 > max {
            messages.push(std::mem::take(&mut current));
        }
        current.push_str(line);
        current.push('\n');
    }
    if !current.is_empty() {
        messages.push(current);
    }
    messages
}

/// Ce qu'une purge a fait dans un salon.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ChannelTally {
    pub channel: u64,
    pub deleted: u64,
    pub failed: u64,
}

/// Le bilan d'une purge, envoyé en MP à l'administrateur.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Report {
    pub guild: String,
    /// « **Pseudo** (`id`) ».
    pub who: String,
    pub elapsed_ms: i64,
    pub scanned: u64,
    pub channels_done: u64,
    pub touched: Vec<ChannelTally>,
    /// Salons en erreur, et pourquoi.
    pub failed: Vec<(u64, String)>,
    /// Salons ignorés faute de droits.
    pub skipped: Vec<u64>,
}

impl Report {
    pub fn deleted(&self) -> u64 {
        self.touched.iter().map(|tally| tally.deleted).sum()
    }

    /// Les lignes du bilan : les salons les plus touchés d'abord, puis les erreurs et les salons
    /// ignorés.
    pub fn lines(&self) -> Vec<String> {
        let mut lines = vec![
            if self.touched.is_empty() {
                format!(
                    "🧹 Purge terminée sur **{}** : aucun message de {} trouvé.",
                    self.guild, self.who
                )
            } else {
                format!(
                    "🧹 Purge terminée sur **{}** : **{}** message(s) de {} supprimé(s).",
                    self.guild,
                    number(i64::try_from(self.deleted()).unwrap_or(i64::MAX)),
                    self.who
                )
            },
            format!(
                "⏱️ {}, {} message(s) lu(s) dans {} salon(s) et fil(s).",
                duration(self.elapsed_ms),
                count(self.scanned),
                count(self.channels_done)
            ),
        ];
        let mut touched = self.touched.clone();
        touched.sort_by_key(|tally| std::cmp::Reverse(tally.deleted));
        for tally in &touched {
            let failed = if tally.failed > 0 {
                format!(" (⚠️ {} impossible(s) à supprimer)", count(tally.failed))
            } else {
                String::new()
            };
            lines.push(format!(
                "• <#{}> : {}{failed}",
                tally.channel,
                count(tally.deleted)
            ));
        }
        if !self.failed.is_empty() {
            lines.push("❌ Salons en erreur, à relancer :".to_owned());
            for (channel, error) in &self.failed {
                lines.push(format!("• <#{channel}> : {error}"));
            }
        }
        if !self.skipped.is_empty() {
            lines.push(
                "🚫 Salons ignorés faute de droits (voir, lire l'historique, gérer les messages) :"
                    .to_owned(),
            );
            for channel in &self.skipped {
                lines.push(format!("• <#{channel}>"));
            }
        }
        lines
    }
}

fn count(value: u64) -> String {
    number(i64::try_from(value).unwrap_or(i64::MAX))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_link_names_a_message_of_a_channel() {
        assert_eq!(
            parse_message_link("https://discord.com/channels/1/2/1005"),
            Some((2, 1005))
        );
        assert_eq!(
            parse_message_link("https://ptb.discordapp.com/channels/1/2/1005/"),
            Some((2, 1005))
        );
        for bad in [
            "n'importe quoi",
            "https://example.com/channels/1/2/1005",
            "https://discord.com/channels/1/2/abc",
        ] {
            assert_eq!(parse_message_link(bad), None, "{bad}");
        }
        assert_eq!(deleted_count(5), "5 message(s) supprimé(s).");
        assert_eq!(
            deleted_until_link(100, true),
            "100 message(s) supprimé(s) jusqu'au lien indiqué.\n⚠️ Limite de 100 messages atteinte, relancez la commande pour continuer."
        );
    }

    #[test]
    fn a_message_age_is_read_in_its_id() {
        // 175928847299117063 : l'exemple de la documentation de Discord, 2016-04-30 11:18:25.796 UTC.
        assert_eq!(created_ms(175_928_847_299_117_063), 1_462_015_105_796);
        let now = 1_462_015_105_796 + BULK_MAX_AGE_MS;
        assert!(!is_recent(175_928_847_299_117_063, now));
        assert!(is_recent(175_928_847_299_117_063, now - 1));
        assert!(is_snowflake("200000000000000002"));
        assert!(!is_snowflake("1234"));
        assert!(!is_snowflake("2000000000000000a2"));
    }

    #[test]
    fn durations_and_reports_read_like_v1() {
        assert_eq!(duration(4_000), "4 s");
        assert_eq!(duration(240_000), "4 min 0 s");
        assert_eq!(duration(3_723_000), "1 h 2 min 3 s");
        let report = Report {
            guild: "PCR".to_owned(),
            who: "**Dresseur** (`2`)".to_owned(),
            elapsed_ms: 5_000,
            scanned: 1_250,
            channels_done: 4,
            touched: vec![
                ChannelTally {
                    channel: 11,
                    deleted: 1,
                    failed: 0,
                },
                ChannelTally {
                    channel: 10,
                    deleted: 153,
                    failed: 2,
                },
            ],
            failed: vec![(13, "Missing Access".to_owned())],
            skipped: vec![12],
        };
        assert_eq!(
            report.lines(),
            [
                "🧹 Purge terminée sur **PCR** : **154** message(s) de **Dresseur** (`2`) supprimé(s).",
                "⏱️ 5 s, 1\u{202f}250 message(s) lu(s) dans 4 salon(s) et fil(s).",
                "• <#10> : 153 (⚠️ 2 impossible(s) à supprimer)",
                "• <#11> : 1",
                "❌ Salons en erreur, à relancer :",
                "• <#13> : Missing Access",
                "🚫 Salons ignorés faute de droits (voir, lire l'historique, gérer les messages) :",
                "• <#12>",
            ]
        );
        let lines = "a\n".repeat(3);
        assert_eq!(split_message(lines.trim_end(), 4), ["a\na\n", "a\n"]);
    }
}
