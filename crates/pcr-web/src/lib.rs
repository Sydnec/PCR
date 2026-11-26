//! The website: JSON API, Discord OAuth2, sessions, live updates and the embedded front.

mod health;

use std::{future::Future, time::Duration};

use axum::{Router, http::StatusCode, routing::get};
use pcr_app::App;
use tower_http::{timeout::TimeoutLayer, trace::TraceLayer};

/// Upper bound for any request; SSE streams will get their own route without it.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);

pub fn router(app: App) -> Router {
    Router::new()
        .route("/healthz", get(health::healthz))
        .layer(TimeoutLayer::with_status_code(StatusCode::REQUEST_TIMEOUT, REQUEST_TIMEOUT))
        .layer(TraceLayer::new_for_http())
        .with_state(app)
}

/// Serves until `shutdown` resolves, then lets in-flight requests finish.
pub async fn serve(app: App, shutdown: impl Future<Output = ()> + Send + 'static) -> std::io::Result<()> {
    let listen = app.instance.web.listen;
    let listener = tokio::net::TcpListener::bind(listen).await?;
    tracing::info!(%listen, "web server listening");
    axum::serve(listener, router(app)).with_graceful_shutdown(shutdown).await
}
