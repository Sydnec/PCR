//! Slash commands de guilde, enregistrées en bloc au démarrage (remplacement idempotent).

pub mod admin;
pub mod bet;
pub mod betstats;
pub mod birthday;
pub mod classement;
pub mod cotd;
pub mod ecaflip;
pub mod edit;
pub mod estimate;
pub mod join;
pub mod mesrappels;
pub mod poll;
pub mod randomizabaise;
pub mod rappel;
pub mod safe_place;
pub mod solde;
pub mod version;
pub mod week;

use twilight_interactions::command::CreateCommand as _;
use twilight_model::application::command::Command;

pub fn all() -> Vec<Command> {
    vec![
        admin::AdminCommand::create_command().into(),
        bet::BetCommand::create_command().into(),
        betstats::BetstatsCommand::create_command().into(),
        birthday::BirthdayCommand::create_command().into(),
        classement::ClassementCommand::create_command().into(),
        cotd::CotdCommand::create_command().into(),
        ecaflip::EcaflipCommand::create_command().into(),
        edit::EditCommand::create_command().into(),
        estimate::EstimateCommand::create_command().into(),
        join::JoinCommand::create_command().into(),
        mesrappels::MesrappelsCommand::create_command().into(),
        poll::PollCommand::create_command().into(),
        randomizabaise::RandomizabaiseCommand::create_command().into(),
        rappel::RappelCommand::create_command().into(),
        safe_place::SafePlaceCommand::create_command().into(),
        solde::SoldeCommand::create_command().into(),
        week::WeekCommand::create_command().into(),
        version::VersionCommand::create_command().into(),
    ]
}
