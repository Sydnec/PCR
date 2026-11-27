//! Les rôles : ceux qu'on prend soi-même en réagissant au message des rôles, le texte de ce message,
//! et la couleur de pseudo de `/color`. Règles de la v1 (`selfServiceRoles`, `rolesForReactionEmoji`,
//! `handleUpdateRoleMessage`).

use std::fmt::Write as _;

use crate::stats::emoji;

/// Un rôle du serveur, tel que ces règles le voient.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Role {
    pub id: u64,
    pub name: String,
    pub position: i64,
    /// Géré par une intégration (un bot, un boost) : personne ne peut se le donner.
    pub managed: bool,
    /// Les permissions du rôle (bits Discord).
    pub permissions: u64,
}

/// Permissions qu'un rôle en libre-service ne doit jamais accorder : tout le monde peut réagir au
/// message des rôles avec n'importe quel emoji.
const FORBIDDEN: u64 = (1 << 3) // Administrateur
    | (1 << 5) // Gérer le serveur
    | (1 << 28) // Gérer les rôles
    | (1 << 4) // Gérer les salons
    | (1 << 13) // Gérer les messages
    | (1 << 29) // Gérer les webhooks
    | (1 << 27) // Gérer les pseudos
    | (1 << 30) // Gérer les emojis et autocollants
    | (1 << 1) // Expulser
    | (1 << 2) // Bannir
    | (1 << 40) // Exclure temporairement
    | (1 << 17); // Mentionner @everyone

/// Les rôles qu'on peut se donner : sous le rôle de ping, ni gérés ni porteurs d'une permission
/// sensible. Du plus haut au plus bas, comme Discord les range.
pub fn self_service(roles: &[Role], ping_role: u64) -> Vec<&Role> {
    let Some(ping) = roles.iter().find(|role| role.id == ping_role) else {
        return Vec::new();
    };
    let mut chosen: Vec<&Role> = roles
        .iter()
        .filter(|role| {
            role.position < ping.position && !role.managed && role.permissions & FORBIDDEN == 0
        })
        .collect();
    chosen.sort_by_key(|role| (std::cmp::Reverse(role.position), role.id));
    chosen
}

/// Les rôles qu'une réaction accorde : ceux en libre-service dont le nom commence par cet emoji.
pub fn for_reaction<'a>(roles: &'a [Role], ping_role: u64, emoji: &str) -> Vec<&'a Role> {
    if emoji.is_empty() {
        return Vec::new();
    }
    // Seuls les rôles proposés par le message, ceux dont le nom commence par un emoji : le nom d'un
    // emoji serveur est du texte libre (« S » donnerait sinon « Sans emoji »).
    self_service(roles, ping_role)
        .into_iter()
        .filter(|role| role.name.starts_with(emoji) && starts_with_emoji(&role.name))
        .collect()
}

fn starts_with_emoji(name: &str) -> bool {
    emoji(name)
        .first()
        .is_some_and(|first| name.starts_with(first.as_str()))
}

/// Le texte du message des rôles et les réactions à y poser : un rôle en libre-service par ligne,
/// le premier emoji de son nom en tête.
pub fn role_message(roles: &[Role], ping_role: u64) -> (String, Vec<String>) {
    let mut text = "Pour être ping, réagissez à ce message :\n".to_owned();
    let mut reactions = Vec::new();
    for role in self_service(roles, ping_role) {
        let Some(first) = emoji(&role.name).into_iter().next() else {
            continue;
        };
        let _ = writeln!(text, "- {first} pour{}", role.name.replacen(&first, "", 1));
        reactions.push(first);
    }
    (text, reactions)
}

/// Le préfixe des rôles de couleur, « &A020F0 ».
pub const COLOR_PREFIX: &str = "&";
pub const BAD_COLOR: &str =
    "❌ Code invalide : donne un code hexadécimal à 6 chiffres, par exemple `#A020F0`.";

/// Le code d'une couleur tapée (« #a020f0 » → « A020F0 ») : six chiffres hexadécimaux, sans quoi un
/// rôle au nom arbitraire serait créé à chaque essai.
pub fn color_code(input: &str) -> Option<String> {
    let code = input.trim().replacen('#', "", 1).to_ascii_uppercase();
    (code.len() == 6 && code.bytes().all(|b| b.is_ascii_hexdigit())).then_some(code)
}

/// Ce que fait `/color` : rien si la couleur est déjà portée ; sinon retirer les anciennes couleurs du
/// membre et prendre celle demandée, existante ou à créer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ColorPlan {
    AlreadyWorn,
    Change {
        /// Les rôles de couleur que porte le membre.
        remove: Vec<u64>,
        /// Le rôle de cette couleur, s'il existe déjà.
        existing: Option<u64>,
    },
}

/// Le plan de `/color code` pour un membre qui porte les rôles `held`.
pub fn color_plan(roles: &[Role], held: &[u64], code: &str) -> ColorPlan {
    let name = format!("{COLOR_PREFIX}{code}");
    let worn = |role: &&Role| held.contains(&role.id);
    if roles.iter().filter(worn).any(|role| role.name == name) {
        return ColorPlan::AlreadyWorn;
    }
    ColorPlan::Change {
        remove: roles
            .iter()
            .filter(worn)
            .filter(|role| role.name.starts_with(COLOR_PREFIX))
            .map(|role| role.id)
            .collect(),
        existing: roles
            .iter()
            .find(|role| role.name == name)
            .map(|role| role.id),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn role(id: u64, name: &str, position: i64) -> Role {
        Role {
            id,
            name: name.to_owned(),
            position,
            managed: false,
            permissions: 0,
        }
    }

    #[test]
    fn only_harmless_roles_under_the_ping_role_are_self_service() {
        let mut roles = vec![
            role(1, "📢 Ping", 10),
            role(2, "🎮 Gamers", 5),
            role(3, "🎨 Artistes", 6),
            role(4, "🛡️ Modération", 4),
            role(5, "🤖 Bot", 3),
            role(6, "👑 Au-dessus", 11),
            role(7, "Sans emoji", 2),
        ];
        roles[3].permissions = 1 << 13;
        roles[4].managed = true;
        let ids: Vec<u64> = self_service(&roles, 1).iter().map(|r| r.id).collect();
        assert_eq!(ids, [3, 2, 7]);
        assert_eq!(
            for_reaction(&roles, 1, "🎮")
                .iter()
                .map(|r| r.id)
                .collect::<Vec<_>>(),
            [2]
        );
        assert!(for_reaction(&roles, 1, "🛡").is_empty());
        // Un emoji serveur nommé « S » ne donne pas un rôle sans emoji.
        assert!(for_reaction(&roles, 1, "S").is_empty());
        assert!(self_service(&roles, 99).is_empty());
        let (text, reactions) = role_message(&roles, 1);
        assert_eq!(
            text,
            "Pour être ping, réagissez à ce message :\n- 🎨 pour Artistes\n- 🎮 pour Gamers\n"
        );
        assert_eq!(reactions, ["🎨", "🎮"]);
    }

    #[test]
    fn asking_for_the_color_one_wears_changes_nothing() {
        let roles = vec![
            role(1, "&A020F0", 3),
            role(2, "&00FF00", 3),
            role(3, "🎮 Gamers", 2),
        ];
        assert_eq!(
            color_plan(&roles, &[1, 3], "A020F0"),
            ColorPlan::AlreadyWorn
        );
        assert_eq!(
            color_plan(&roles, &[1, 3], "00FF00"),
            ColorPlan::Change {
                remove: vec![1],
                existing: Some(2)
            }
        );
        assert_eq!(
            color_plan(&roles, &[3], "123456"),
            ColorPlan::Change {
                remove: vec![],
                existing: None
            }
        );
    }

    #[test]
    fn a_color_is_six_hex_digits() {
        assert_eq!(color_code("#a020f0").as_deref(), Some("A020F0"));
        assert_eq!(color_code("A020F0").as_deref(), Some("A020F0"));
        for bad in ["#A020F", "rouge", "#A020F0F", "##A020F0"] {
            assert_eq!(color_code(bad), None, "{bad}");
        }
    }
}
