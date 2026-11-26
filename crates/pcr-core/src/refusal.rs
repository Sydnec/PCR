//! Refus montrés à un membre : le texte exact, en français et au tutoiement, repris de la v1 quand il
//! existait. Un refus n'est pas une erreur : l'action est simplement impossible, et l'on dit pourquoi.

use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Refusal(String);

impl Refusal {
    pub fn new(text: impl Into<String>) -> Self {
        Self(text.into())
    }

    pub fn text(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for Refusal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}
