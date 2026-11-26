//! What is running: crate version plus the git commit stamped by CI.

/// Workspace version, bumped by `cargo xtask release`.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Short git SHA injected by the build workflow (`PCR_GIT_SHA`), "local" otherwise.
pub const GIT_SHA: &str = match option_env!("PCR_GIT_SHA") {
    Some(sha) => sha,
    None => "local",
};
