//! Ce que les tâches de fond envoient sur Discord (rappels, vœux, saints du jour, Avent) : le port
//! [`Outbox`], implémenté par `pcr-discord`, et ses sources sur le web ([`Web`]).
//!
//! Une erreur est une panne passagère (coupure, 5xx, limite de débit) : l'appelant réessaiera. Ce qui
//! ne passera jamais (membre parti, MP fermés) n'est pas une erreur, et se dit dans la réponse.

use std::{future::Future, pin::Pin, sync::Arc, time::Duration};

pub use pcr_db::reminders::Reminder;

use crate::http::Http;
pub use crate::http::Page;

pub type OutboxFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, String>> + Send + 'a>>;

/// Ce qu'est devenu un MP.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Delivery {
    Sent,
    /// Le membre est introuvable ou n'accepte pas les MP du bot : inutile de réessayer.
    Unreachable,
}

pub trait Outbox: Send + Sync + std::fmt::Debug {
    /// Un texte dans un salon ; seuls les membres de `ping` sont appelés.
    fn post(&self, channel: i64, text: String, ping: Vec<i64>) -> OutboxFuture<'_, ()>;
    /// Ouvre un fil public dans `channel`, y poste `text` et l'épingle.
    fn open_thread(&self, channel: i64, name: String, text: String) -> OutboxFuture<'_, ()>;
    /// Le pseudo d'un membre sur le serveur ; `None` s'il est introuvable.
    fn display_name(&self, user: i64) -> OutboxFuture<'_, Option<String>>;
    /// Un rappel échu, en MP à son auteur.
    fn remind<'a>(&'a self, reminder: &'a Reminder) -> OutboxFuture<'a, Delivery>;
}

/// Les pages que lit le bot (saints du jour, tweets) ; un faux dans les tests.
pub trait Web: Send + Sync + std::fmt::Debug {
    /// La page à `url`, quel que soit son statut ; une erreur si rien n'est venu dans `timeout`.
    fn get<'a>(
        &'a self,
        url: &'a str,
        user_agent: &'a str,
        timeout: Duration,
    ) -> OutboxFuture<'a, Page>;
}

impl Web for Http {
    fn get<'a>(
        &'a self,
        url: &'a str,
        user_agent: &'a str,
        timeout: Duration,
    ) -> OutboxFuture<'a, Page> {
        Box::pin(Http::get(self, url, user_agent, timeout))
    }
}

/// Un web injoignable : le client HTTP n'a pas pu se construire.
#[derive(Debug)]
pub struct Offline(pub String);

impl Web for Offline {
    fn get<'a>(
        &'a self,
        _url: &'a str,
        _user_agent: &'a str,
        _timeout: Duration,
    ) -> OutboxFuture<'a, Page> {
        Box::pin(async move { Err(self.0.clone()) })
    }
}

/// Ce que les tâches de fond ont sous la main.
#[derive(Debug, Clone)]
pub struct Ports {
    pub outbox: Arc<dyn Outbox>,
    pub web: Arc<dyn Web>,
}
