//! La liste des fils du serveur, republiée à chaque fil créé dans un salon que voient les membres
//! (`updateThreadList` de la v1).

use std::fmt::Write as _;

/// Un salon et ses fils.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChannelThreads {
    pub name: String,
    /// La place de sa catégorie (`None` : hors catégorie), puis la sienne.
    pub category_position: Option<i64>,
    pub position: i64,
    /// (identifiant, nom) de chaque fil.
    pub threads: Vec<(u64, String)>,
}

/// Le texte de la liste : les salons dans l'ordre du serveur (ceux hors catégorie d'abord), leurs
/// fils dessous.
pub fn list(mut channels: Vec<ChannelThreads>) -> String {
    channels.retain(|channel| !channel.threads.is_empty());
    channels.sort_by_key(|channel| (channel.category_position, channel.position));
    let mut text = String::new();
    for channel in &channels {
        let _ = write!(text, "\n__**{}**__\n", channel.name);
        let lines: Vec<String> = channel
            .threads
            .iter()
            .map(|(id, name)| format!("- <#{id}> ({name})"))
            .collect();
        text.push_str(&lines.join("\n"));
        text.push('\n');
    }
    if text.is_empty() {
        text.push_str("Aucun fil sur le serveur.");
    }
    format!("**Liste des fils du serveur :**\n{text}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn channels_follow_the_server_order_and_empty_ones_are_left_out() {
        let channel =
            |name: &str, category: Option<i64>, position: i64, threads: &[(u64, &str)]| {
                ChannelThreads {
                    name: name.to_owned(),
                    category_position: category,
                    position,
                    threads: threads
                        .iter()
                        .map(|(id, n)| (*id, (*n).to_owned()))
                        .collect(),
                }
            };
        assert_eq!(
            list(vec![
                channel("jeux", Some(2), 0, &[(3, "Zelda")]),
                channel("général", Some(1), 5, &[(1, "Vacances"), (2, "Ciné")]),
                channel("vide", Some(1), 1, &[]),
                channel("accueil", None, 9, &[(4, "Règles")]),
            ]),
            "**Liste des fils du serveur :**\n\n__**accueil**__\n- <#4> (Règles)\n\n__**général**__\n\
             - <#1> (Vacances)\n- <#2> (Ciné)\n\n__**jeux**__\n- <#3> (Zelda)\n"
        );
        assert_eq!(
            list(Vec::new()),
            "**Liste des fils du serveur :**\nAucun fil sur le serveur."
        );
    }
}
