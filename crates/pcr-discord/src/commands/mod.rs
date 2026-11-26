//! Guild slash commands, registered in bulk at startup (idempotent overwrite).

pub mod version;

use twilight_interactions::command::CreateCommand as _;
use twilight_model::application::command::Command;

pub fn all() -> Vec<Command> {
    vec![version::VersionCommand::create_command().into()]
}
