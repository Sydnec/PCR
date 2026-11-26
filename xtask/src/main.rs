//! Project automation, run as `cargo xtask <task>`.
//!
//! `check` runs every gate CI runs and prints only what failed, so a coding agent gets a short,
//! actionable answer instead of thousands of lines of build output.

use std::{
    env,
    path::Path,
    process::{Command, ExitCode},
};

/// Lines of a failing step's output that are shown (the end holds the useful part).
const SHOWN_LINES: usize = 80;

fn main() -> ExitCode {
    if let Some("check") = env::args().nth(1).as_deref() {
        check()
    } else {
        eprintln!("usage: cargo xtask check");
        ExitCode::FAILURE
    }
}

fn check() -> ExitCode {
    let mut steps: Vec<(&str, Command)> = vec![
        // `-l` lists the unformatted files only; `cargo fmt --all` fixes them.
        ("fmt", cargo(&["fmt", "--all", "--", "--check", "-l"])),
        (
            "clippy",
            cargo(&[
                "clippy",
                "--workspace",
                "--all-targets",
                "--quiet",
                "--",
                "-D",
                "warnings",
            ]),
        ),
        ("test", cargo(&["test", "--workspace", "--quiet"])),
    ];
    if Path::new("web/package.json").exists() {
        let mut typecheck = Command::new("npm");
        typecheck.args(["--prefix", "web", "run", "--silent", "check"]);
        steps.push(("web", typecheck));
    }

    let mut failed = false;
    for (name, mut command) in steps {
        match command.output() {
            Ok(output) if output.status.success() => eprintln!("ok   {name}"),
            Ok(output) => {
                failed = true;
                eprintln!("FAIL {name}");
                let text = [output.stdout, output.stderr].concat();
                let text = String::from_utf8_lossy(&text);
                let lines: Vec<&str> = text.lines().collect();
                for line in &lines[lines.len().saturating_sub(SHOWN_LINES)..] {
                    eprintln!("     {line}");
                }
            }
            Err(error) => {
                failed = true;
                eprintln!("FAIL {name}: {error}");
            }
        }
    }
    if failed {
        ExitCode::FAILURE
    } else {
        ExitCode::SUCCESS
    }
}

fn cargo(args: &[&str]) -> Command {
    let mut command = Command::new(env::var("CARGO").unwrap_or_else(|_| "cargo".into()));
    command.args(args).env("CARGO_TERM_COLOR", "never");
    command
}
