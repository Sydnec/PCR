//! `cargo xtask release <patch|minor|major>`.
//!
//! Une version en pré-publication (`2.0.0-dev`) sort telle quelle (`2.0.0`) quel que soit le niveau :
//! c'est la première release de cette ligne. Ensuite, le niveau incrémente normalement.

use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

use pcr_core::{
    changelog::{self, Changelog, Release},
    clock::{Clock as _, SystemClock},
};

const MANIFEST: &str = "Cargo.toml";
const UNRELEASED: &str = "changelog/unreleased";
const RELEASES: &str = "changelog/releases.toml";
const SECTION: &str = "[workspace.package]";

pub fn run(level: &str) -> Result<(), String> {
    let manifest = fs::read_to_string(MANIFEST).map_err(|e| format!("{MANIFEST}: {e}"))?;
    let current = current_version(&manifest)?;
    let next = next_version(&current, level)?;

    let fragments = fragments()?;
    if fragments.is_empty() {
        return Err(format!("nothing to release: {UNRELEASED}/ has no entry"));
    }
    let entries = fragments
        .iter()
        .map(|path| {
            let text = fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
            changelog::parse_entry(&text).map_err(|e| format!("{}: {e}", path.display()))
        })
        .collect::<Result<Vec<_>, _>>()?;

    let release = Release {
        version: next.clone(),
        date: SystemClock.today().to_string(),
        entries,
    };
    let block = toml::to_string(&Changelog {
        release: vec![release],
    })
    .map_err(|e| e.to_string())?;
    let releases = fs::read_to_string(RELEASES).map_err(|e| format!("{RELEASES}: {e}"))?;
    let updated = insert_newest(&releases, &block);
    // Relecture : on n'écrit jamais un changelog que le bot ne saurait pas lire.
    Changelog::parse(&updated).map_err(|e| format!("generated changelog is invalid: {e}"))?;

    fs::write(RELEASES, updated).map_err(|e| e.to_string())?;
    fs::write(
        MANIFEST,
        manifest.replacen(
            &format!("version = \"{current}\""),
            &format!("version = \"{next}\""),
            1,
        ),
    )
    .map_err(|e| e.to_string())?;
    for path in &fragments {
        fs::remove_file(path).map_err(|e| format!("{}: {e}", path.display()))?;
    }
    // Cargo.lock porte la version de chaque crate du workspace.
    let status = Command::new(std::env::var("CARGO").unwrap_or_else(|_| "cargo".into()))
        .args(["update", "--workspace", "--offline", "--quiet"])
        .status()
        .map_err(|e| e.to_string())?;
    if !status.success() {
        return Err("cargo update --workspace failed".into());
    }

    eprintln!(
        "released {next} ({} entries) — commit, then open the PR dev → main",
        fragments.len()
    );
    Ok(())
}

/// La version de `[workspace.package]` : la première ligne `version = "…"` après la section.
fn current_version(manifest: &str) -> Result<String, String> {
    let section = manifest
        .find(SECTION)
        .ok_or_else(|| format!("{SECTION} not found in {MANIFEST}"))?;
    manifest[section..]
        .lines()
        .find_map(|line| line.strip_prefix("version = \"")?.strip_suffix('"'))
        .map(str::to_owned)
        .ok_or_else(|| format!("no version in {SECTION}"))
}

fn next_version(current: &str, level: &str) -> Result<String, String> {
    let (base, pre) = current
        .split_once('-')
        .map_or((current, false), |(base, _)| (base, true));
    let parts: Vec<u64> = base
        .split('.')
        .map(|part| {
            part.parse()
                .map_err(|_| format!("invalid version {current}"))
        })
        .collect::<Result<_, _>>()?;
    let [major, minor, patch] = parts[..] else {
        return Err(format!("invalid version {current}"));
    };
    if pre {
        return Ok(base.to_owned());
    }
    match level {
        "major" => Ok(format!("{}.0.0", major + 1)),
        "minor" => Ok(format!("{major}.{}.0", minor + 1)),
        "patch" => Ok(format!("{major}.{minor}.{}", patch + 1)),
        _ => Err(format!("unknown level {level} (patch, minor or major)")),
    }
}

fn fragments() -> Result<Vec<PathBuf>, String> {
    let mut paths: Vec<PathBuf> = fs::read_dir(Path::new(UNRELEASED))
        .map_err(|e| format!("{UNRELEASED}: {e}"))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "toml"))
        .collect();
    paths.sort();
    Ok(paths)
}

/// Les versions vont de la plus récente à la plus ancienne : la nouvelle passe avant la première.
fn insert_newest(releases: &str, block: &str) -> String {
    match releases.find("[[release]]") {
        Some(at) => format!("{}{block}\n{}", &releases[..at], &releases[at..]),
        None => format!("{}\n\n{block}", releases.trim_end()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prerelease_ships_as_is_then_levels_increment() {
        assert_eq!(next_version("2.0.0-dev", "minor").as_deref(), Ok("2.0.0"));
        assert_eq!(next_version("2.0.0", "patch").as_deref(), Ok("2.0.1"));
        assert_eq!(next_version("2.3.4", "minor").as_deref(), Ok("2.4.0"));
        assert_eq!(next_version("2.3.4", "major").as_deref(), Ok("3.0.0"));
        assert!(next_version("2.3.4", "hotfix").is_err());
    }
}
