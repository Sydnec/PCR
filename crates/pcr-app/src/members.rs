//! Les membres porteurs d'un rôle : le pot commun (rôle par défaut) et les distributions de
//! `/admin points` sur un rôle.
//!
//! La liste vient de Discord par le port [`MembersPort`] (implémenté par `pcr-discord`), toujours en
//! entier : un cache partiel ne servirait qu'une partie du serveur, sans le dire. Le tri se fait ici.
//! Les bots sont exclus : ils ne gagnent aucun point, et toucheraient pourtant leur part de chaque
//! pot sans jamais la dépenser.

use std::{future::Future, pin::Pin};

use pcr_core::refusal::Refusal;

/// Un membre du serveur, tel que le tri en a besoin.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Member {
    pub id: i64,
    pub bot: bool,
    pub roles: Vec<i64>,
}

/// Le serveur au moment de la lecture : ses membres, et le nom du rôle demandé s'il existe.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Roster {
    pub role_name: Option<String>,
    pub members: Vec<Member>,
}

/// Les porteurs d'un rôle, bots exclus.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoleMembers {
    pub role_name: String,
    pub members: Vec<i64>,
}

pub type PortFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, String>> + Send + 'a>>;

/// Lecture des membres sur Discord. Une erreur est une panne passagère (coupure, délai) : rien n'a été
/// décidé sur la foi d'une liste incomplète.
pub trait MembersPort: Send + Sync + std::fmt::Debug {
    /// Tous les membres du serveur et le nom du rôle `role`.
    fn roster(&self, role: i64) -> PortFuture<'_, Roster>;
}

/// Quel rôle on cherchait : le message d'un rôle introuvable n'est pas le même.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Wanted {
    /// Le rôle par défaut de l'instance (`discord.default_role_id`).
    Default,
    /// Un rôle choisi par un administrateur.
    Chosen,
}

/// Le rôle cherché n'existe pas (ou, pour le rôle par défaut, n'est pas configuré).
pub fn missing(wanted: Wanted) -> Refusal {
    Refusal::new(match wanted {
        Wanted::Default => "`default_role_id` est introuvable sur ce serveur.",
        Wanted::Chosen => "Ce rôle est introuvable sur ce serveur.",
    })
}

/// Les porteurs non-bots de `role`. `@everyone` (son identifiant est celui du serveur) n'est porté
/// explicitement par personne : il désigne tout le monde.
pub fn role_members(
    roster: &Roster,
    role: i64,
    guild: i64,
    wanted: Wanted,
) -> Result<RoleMembers, Refusal> {
    let Some(role_name) = roster.role_name.clone() else {
        return Err(missing(wanted));
    };
    let members: Vec<i64> = roster
        .members
        .iter()
        .filter(|member| !member.bot && (role == guild || member.roles.contains(&role)))
        .map(|member| member.id)
        .collect();
    if members.is_empty() {
        return Err(Refusal::new(format!(
            "Personne ne porte le rôle **{role_name}**."
        )));
    }
    Ok(RoleMembers { role_name, members })
}

#[cfg(test)]
mod tests {
    use super::*;

    const GUILD: i64 = 1;
    const ROLE: i64 = 50;

    fn roster(name: Option<&str>) -> Roster {
        let member = |id, bot, roles: &[i64]| Member {
            id,
            bot,
            roles: roles.to_vec(),
        };
        Roster {
            role_name: name.map(str::to_owned),
            members: vec![
                member(10, false, &[ROLE]),
                member(11, false, &[]),
                member(12, true, &[ROLE]),
            ],
        }
    }

    #[test]
    fn keeps_the_role_holders_without_the_bots() {
        let found = role_members(&roster(Some("Dresseurs")), ROLE, GUILD, Wanted::Chosen);
        assert_eq!(found.expect("members").members, [10]);
        let everyone = role_members(&roster(Some("@everyone")), GUILD, GUILD, Wanted::Chosen);
        assert_eq!(everyone.expect("members").members, [10, 11]);
    }

    #[test]
    fn refuses_a_missing_role() {
        let default = role_members(&roster(None), ROLE, GUILD, Wanted::Default);
        assert_eq!(
            default.expect_err("missing").text(),
            "`default_role_id` est introuvable sur ce serveur."
        );
        let chosen = role_members(&roster(None), ROLE, GUILD, Wanted::Chosen);
        assert_eq!(
            chosen.expect_err("missing").text(),
            "Ce rôle est introuvable sur ce serveur."
        );
    }

    #[test]
    fn refuses_a_role_nobody_holds() {
        let empty = role_members(&roster(Some("Vide")), 99, GUILD, Wanted::Chosen);
        assert_eq!(
            empty.expect_err("empty").text(),
            "Personne ne porte le rôle **Vide**."
        );
    }
}
