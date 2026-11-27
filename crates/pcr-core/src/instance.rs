//! Réglages propres à une instance (prod ou dev), lus dans `instance.toml`.
//!
//! Seules les valeurs non secrètes vivent ici : IDs Discord, URL, adresse d'écoute. Les secrets
//! viennent de l'environnement (`DISCORD_TOKEN`…), posé par l'`EnvironmentFile` de systemd. Les IDs
//! Discord n'entrent jamais dans la config de jeu à chaud : une copie prod → dev ne peut pas faire
//! parler le bot de dev dans les salons de prod.

use std::net::{IpAddr, SocketAddr};

use serde::Deserialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Env {
    Prod,
    Dev,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Instance {
    pub env: Env,
    /// Dossier de `pcr.db`, des bases de stats annuelles et des caches.
    pub data_dir: std::path::PathBuf,
    pub discord: Discord,
    pub web: Web,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Discord {
    pub application_id: u64,
    pub guild_id: u64,
    /// Propriétaire du bot : admin du site et destinataire des MP d'exploitation.
    pub admin_user_id: u64,
    /// Garde-fou du dev : non vide, seuls ces utilisateurs reçoivent des MP, pour qu'une copie des
    /// données de prod ne fasse jamais écrire le bot de dev à de vrais membres.
    #[serde(default)]
    pub dm_allowlist: Vec<u64>,
    /// Salon des annonces de version (prod) ou des aperçus d'annonce (dev). Absent : pas d'annonce.
    pub changelog_channel_id: Option<u64>,
    /// Le rôle des membres du serveur (`DEFAULT_ROLE_ID` en v1) : les bénéficiaires du pot commun.
    /// Absent : le pot commun attend qu'il soit posé.
    pub default_role_id: Option<u64>,
    /// Le rôle appelé à chaque nouveau pari (`DISCORD_BET_ROLE_ID` en v1). Absent : personne n'est
    /// appelé.
    pub bet_role_id: Option<u64>,
    /// Les salons de la communauté (`*_CHANNEL_ID` en v1). Absent : la fonctionnalité est coupée,
    /// sans erreur. `poll_channel_id` : le forum des sondages (`/poll`, `/edit`).
    pub poll_channel_id: Option<u64>,
    pub safe_place_channel_id: Option<u64>,
    pub birthday_channel_id: Option<u64>,
    /// Saints et fêtes du jour.
    pub cotd_channel_id: Option<u64>,
    /// Le salon où s'ouvrent les fils du calendrier de l'Avent.
    pub advent_channel_id: Option<u64>,
    /// Le message des rôles (`ROLE_CHANNEL_ID`, `ROLE_MESSAGE_ID`) : y réagir donne les rôles placés
    /// sous `ping_role_id` (`PING_ROLE_ID`). Il manque l'un des trois : pas de rôles en libre-service.
    pub role_channel_id: Option<u64>,
    pub role_message_id: Option<u64>,
    pub ping_role_id: Option<u64>,
    /// Le salon de la liste des fils, republiée à chaque fil créé (`THREAD_LIST_CHANNEL_ID`).
    pub thread_list_channel_id: Option<u64>,
    /// Le rôle sous lequel se rangent les rôles de couleur de `/color` (`COLOR_ROLE_ID`).
    pub color_role_id: Option<u64>,
    /// L'invitation des membres temporaires et leur rôle à l'arrivée (`TEMPORY_MEMBER_*`) : qui
    /// arrive par elle reçoit ce rôle au lieu du rôle par défaut.
    pub temporary_member_invite_code: Option<String>,
    pub temporary_member_role_id: Option<u64>,
    /// Le salon des apparitions (`POKEMON_CHANNEL_ID`). Absent : aucun Pokémon n'apparaît, et les
    /// messages ne comptent pas pour la suivante.
    pub pokemon_channel_id: Option<u64>,
    /// Le rôle des dresseurs (`POKEMON_ROLE_ID`), appelé par les apparitions rares et shiny.
    pub pokemon_role_id: Option<u64>,
    /// Le rôle des porteurs du Charme Chroma de chaque génération (`SHINY_CHARM_ROLE_ID_<n>`), appelé
    /// quand une apparition brille pour eux seuls. La clé est la génération.
    #[serde(default)]
    pub shiny_charm_role_ids: std::collections::BTreeMap<u8, u64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Web {
    pub listen: SocketAddr,
    /// URL publique sans barre finale ; le retour OAuth2 vit dessous.
    pub public_url: String,
    /// `X-Forwarded-For` n'est cru que venant de cette adresse (le reverse proxy).
    pub trusted_proxy: Option<IpAddr>,
}

#[derive(Debug, thiserror::Error)]
pub enum InstanceError {
    #[error("invalid instance.toml: {0}")]
    Parse(String),
    #[error("invalid instance.toml: {0}")]
    Invalid(&'static str),
}

impl Instance {
    pub fn from_toml(text: &str) -> Result<Self, InstanceError> {
        let instance: Self =
            toml::from_str(text).map_err(|e| InstanceError::Parse(e.to_string()))?;
        instance.validate()?;
        Ok(instance)
    }

    fn validate(&self) -> Result<(), InstanceError> {
        let d = &self.discord;
        if d.application_id == 0 || d.guild_id == 0 || d.admin_user_id == 0 {
            return Err(InstanceError::Invalid("discord ids must be non-zero"));
        }
        if self.web.public_url.ends_with('/') {
            return Err(InstanceError::Invalid(
                "web.public_url must not end with '/'",
            ));
        }
        if !self.web.public_url.starts_with("https://")
            && !self.web.public_url.starts_with("http://")
        {
            return Err(InstanceError::Invalid(
                "web.public_url must be an http(s) URL",
            ));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const EXAMPLE: &str = include_str!("../../../deploy/instance.example.toml");

    #[test]
    fn example_file_is_valid() {
        let instance = Instance::from_toml(EXAMPLE).expect("example parses");
        assert_eq!(instance.env, Env::Dev);
    }

    #[test]
    fn charm_roles_are_keyed_by_generation() {
        let instance = Instance::from_toml(EXAMPLE).expect("example parses");
        let roles = &instance.discord.shiny_charm_role_ids;
        assert_eq!(roles.get(&2), Some(&700_000_000_000_000_015));
        assert!(instance.discord.pokemon_channel_id.is_some());
    }

    #[test]
    fn trailing_slash_in_public_url_is_rejected() {
        let bad = EXAMPLE.replace("dev.example.org\"", "dev.example.org/\"");
        assert!(matches!(
            Instance::from_toml(&bad),
            Err(InstanceError::Invalid(_))
        ));
    }
}
