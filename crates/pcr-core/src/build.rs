//! Ce qui tourne : version du workspace et commit git estampillé par la CI.

/// Version du workspace, montée par `cargo xtask release`.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// SHA git court injecté par le workflow de build (`PCR_GIT_SHA`), « local » sinon.
pub const GIT_SHA: &str = match option_env!("PCR_GIT_SHA") {
    Some(sha) => sha,
    None => "local",
};
