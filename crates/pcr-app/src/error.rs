//! L'issue d'un cas d'usage qui peut être refusé : un refus se montre au membre, une panne de base se
//! journalise.

use pcr_core::refusal::Refusal;
use pcr_db::DbError;

#[derive(Debug, thiserror::Error)]
pub enum UseCaseError {
    #[error("{0}")]
    Refused(Refusal),
    #[error(transparent)]
    Db(#[from] DbError),
}

impl UseCaseError {
    pub fn refused(text: impl Into<String>) -> Self {
        Self::Refused(Refusal::new(text))
    }
}

impl From<Refusal> for UseCaseError {
    fn from(refusal: Refusal) -> Self {
        Self::Refused(refusal)
    }
}
