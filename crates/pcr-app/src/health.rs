//! Liveness flags reported by `/healthz`.

use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Debug, Default)]
pub struct Health {
    discord_ready: AtomicBool,
}

impl Health {
    /// Set by the gateway on READY / RESUMED, cleared on disconnect.
    pub fn set_discord_ready(&self, ready: bool) {
        self.discord_ready.store(ready, Ordering::Relaxed);
    }

    pub fn discord_ready(&self) -> bool {
        self.discord_ready.load(Ordering::Relaxed)
    }
}
