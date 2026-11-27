//! Slash commands de guilde, enregistrées en bloc au démarrage (remplacement idempotent).

pub mod admin;
pub mod bet;
pub mod betstats;
pub mod classement;
pub mod estimate;
pub mod solde;
pub mod version;

use twilight_interactions::command::CreateCommand as _;
use twilight_model::application::command::Command;

pub fn all() -> Vec<Command> {
    vec![
        admin::AdminCommand::create_command().into(),
        bet::BetCommand::create_command().into(),
        betstats::BetstatsCommand::create_command().into(),
        classement::ClassementCommand::create_command().into(),
        estimate::EstimateCommand::create_command().into(),
        solde::SoldeCommand::create_command().into(),
        version::VersionCommand::create_command().into(),
    ]
}
