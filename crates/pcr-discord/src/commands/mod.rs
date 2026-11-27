//! Slash commands de guilde, enregistrées en bloc au démarrage (remplacement idempotent).

pub mod admin;
pub mod classement;
pub mod solde;
pub mod version;

use twilight_interactions::command::CreateCommand as _;
use twilight_model::application::command::Command;

pub fn all() -> Vec<Command> {
    vec![
        admin::AdminCommand::create_command().into(),
        classement::ClassementCommand::create_command().into(),
        solde::SoldeCommand::create_command().into(),
        version::VersionCommand::create_command().into(),
    ]
}
