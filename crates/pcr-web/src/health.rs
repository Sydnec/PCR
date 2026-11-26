//! `/healthz`: what the deploy script checks before keeping a new release.
//!
//! Only HTTP and the database gate the answer. Discord readiness is reported but never fails
//! the check, so a Discord outage cannot trigger a rollback.

use axum::{Json, extract::State, http::StatusCode};
use pcr_app::App;
use pcr_core::build::{GIT_SHA, VERSION};
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct HealthReport {
    version: &'static str,
    commit: &'static str,
    database: bool,
    discord: bool,
}

pub async fn healthz(State(app): State<App>) -> (StatusCode, Json<HealthReport>) {
    let database = app.db.ping().await.is_ok();
    let report = HealthReport {
        version: VERSION,
        commit: GIT_SHA,
        database,
        discord: app.health.discord_ready(),
    };
    let status = if database {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    (status, Json(report))
}
