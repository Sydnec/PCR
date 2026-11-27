//! Un client HTTP minimal pour les pages que le bot lit (saints et fêtes du jour) : GET, redirections
//! suivies, délai et taille bornés. Il reprend la pile de twilight (hyper, rustls, certificats
//! vérifiés par le système) : aucune dépendance de plus.

use std::time::Duration;

use bytes::Bytes;
use http::{Request, Uri, header};
use http_body_util::{BodyExt as _, Empty, Limited};
use hyper_rustls::HttpsConnector;
use hyper_util::{
    client::legacy::{Client, connect::HttpConnector},
    rt::TokioExecutor,
};

/// Redirections suivies avant d'abandonner.
const REDIRECTS: usize = 5;
/// Une page plus grosse n'est pas celle qu'on attend.
const MAX_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone)]
pub struct Http {
    client: Client<HttpsConnector<HttpConnector>, Empty<Bytes>>,
}

impl Http {
    /// Le client, avec `ring` comme le reste du bot ; une erreur si le système n'offre aucun
    /// magasin de certificats.
    pub fn new() -> Result<Self, String> {
        let connector = hyper_rustls::HttpsConnectorBuilder::new()
            .with_provider_and_platform_verifier(rustls::crypto::ring::default_provider())
            .map_err(|e| e.to_string())?
            .https_or_http()
            .enable_http1()
            .build();
        Ok(Self {
            client: Client::builder(TokioExecutor::new()).build(connector),
        })
    }

    /// Une page, en suivant ses redirections : son statut et son texte, quel que soit le statut (une
    /// API dit « supprimé » par un 404). Une erreur dit pourquoi rien n'est venu.
    pub async fn get(
        &self,
        url: &str,
        user_agent: &str,
        timeout: Duration,
    ) -> Result<Page, String> {
        tokio::time::timeout(timeout, self.fetch(url, user_agent))
            .await
            .map_err(|_| format!("{url}: timed out"))?
    }

    async fn fetch(&self, url: &str, user_agent: &str) -> Result<Page, String> {
        let mut uri: Uri = url.parse().map_err(|e| format!("{url}: {e}"))?;
        for _ in 0..=REDIRECTS {
            let request = Request::get(uri.clone())
                .header(header::USER_AGENT, user_agent)
                .body(Empty::new())
                .map_err(|e| format!("{uri}: {e}"))?;
            let response = self
                .client
                .request(request)
                .await
                .map_err(|e| format!("{uri}: {e}"))?;
            let status = response.status();
            if status.is_redirection() {
                let location = response
                    .headers()
                    .get(header::LOCATION)
                    .and_then(|value| value.to_str().ok())
                    .ok_or_else(|| format!("{uri}: redirect without location"))?;
                uri = follow(&uri, location)?;
                continue;
            }
            let body = Limited::new(response.into_body(), MAX_BYTES)
                .collect()
                .await
                .map_err(|e| format!("{uri}: {e}"))?
                .to_bytes();
            return Ok(Page {
                status: status.as_u16(),
                body: String::from_utf8_lossy(&body).into_owned(),
            });
        }
        Err(format!("{url}: too many redirects"))
    }
}

/// Une page lue.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Page {
    pub status: u16,
    pub body: String,
}

impl Page {
    /// Le texte d'une réponse réussie (2xx), sinon une erreur qui donne le statut.
    pub fn ok(self) -> Result<String, String> {
        if (200..300).contains(&self.status) {
            Ok(self.body)
        } else {
            Err(format!("HTTP {}", self.status))
        }
    }
}

/// L'adresse d'une redirection : absolue, ou relative au site de la page.
fn follow(from: &Uri, location: &str) -> Result<Uri, String> {
    let target: Uri = location.parse().map_err(|e| format!("{location}: {e}"))?;
    if target.scheme().is_some() {
        return Ok(target);
    }
    let mut parts = target.into_parts();
    parts.scheme = from.scheme().cloned();
    parts.authority = from.authority().cloned();
    Uri::from_parts(parts).map_err(|e| format!("{location}: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_relative_redirect_stays_on_the_site() {
        let from: Uri = "https://example.org/date/03-09.htm".parse().expect("uri");
        assert_eq!(
            follow(&from, "/date/03-09.html").expect("uri").to_string(),
            "https://example.org/date/03-09.html"
        );
        assert_eq!(
            follow(&from, "https://www.example.org/x")
                .expect("uri")
                .to_string(),
            "https://www.example.org/x"
        );
    }
}
