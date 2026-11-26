//! Per-instance settings (prod or dev), read from `instance.toml`.
//!
//! Only non-secret values live here: Discord IDs, URLs, listen address. Secrets come from the
//! environment (`DISCORD_TOKEN`…), set by systemd's `EnvironmentFile`. Discord IDs never go into
//! the hot game config, so copying prod data to dev cannot make the dev bot talk to prod channels.

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
    /// Directory holding `pcr.db`, the yearly stats files and caches.
    pub data_dir: std::path::PathBuf,
    pub discord: Discord,
    pub web: Web,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Discord {
    pub application_id: u64,
    pub guild_id: u64,
    /// Owner of the bot: website admin and target of operational DMs.
    pub admin_user_id: u64,
    /// Dev safety net: when non-empty, DMs are only sent to these users, so a copy of prod data
    /// never makes the dev bot message real members.
    #[serde(default)]
    pub dm_allowlist: Vec<u64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Web {
    pub listen: SocketAddr,
    /// Public URL without trailing slash; the OAuth2 callback lives under it.
    pub public_url: String,
    /// `X-Forwarded-For` is trusted only from this address (the reverse proxy).
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
        let instance: Self = toml::from_str(text).map_err(|e| InstanceError::Parse(e.to_string()))?;
        instance.validate()?;
        Ok(instance)
    }

    fn validate(&self) -> Result<(), InstanceError> {
        let d = &self.discord;
        if d.application_id == 0 || d.guild_id == 0 || d.admin_user_id == 0 {
            return Err(InstanceError::Invalid("discord ids must be non-zero"));
        }
        if self.web.public_url.ends_with('/') {
            return Err(InstanceError::Invalid("web.public_url must not end with '/'"));
        }
        if !self.web.public_url.starts_with("https://") && !self.web.public_url.starts_with("http://") {
            return Err(InstanceError::Invalid("web.public_url must be an http(s) URL"));
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
    fn trailing_slash_in_public_url_is_rejected() {
        let bad = EXAMPLE.replace("dev.example.org\"", "dev.example.org/\"");
        assert!(matches!(Instance::from_toml(&bad), Err(InstanceError::Invalid(_))));
    }
}
