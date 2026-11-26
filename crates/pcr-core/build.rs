//! Embarque les entrées de changelog en attente (`changelog/unreleased/*.toml`) : le bot de dev en
//! poste un aperçu, sans qu'il faille les recopier nulle part.

use std::{env, fmt::Write as _, fs, path::PathBuf};

fn main() {
    let dir = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").expect("set by cargo"))
        .join("../../changelog/unreleased");
    println!("cargo:rerun-if-changed={}", dir.display());

    let mut files: Vec<PathBuf> = fs::read_dir(&dir)
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .map(|entry| entry.path())
                .filter(|path| path.extension().is_some_and(|ext| ext == "toml"))
                .collect()
        })
        .unwrap_or_default();
    files.sort();

    let mut code = String::from("pub const UNRELEASED: &[&str] = &[\n");
    for file in files {
        let path = file.canonicalize().expect("canonical path");
        writeln!(code, "    include_str!({:?}),", path.display().to_string()).expect("write");
    }
    code.push_str("];\n");
    let out = PathBuf::from(env::var_os("OUT_DIR").expect("set by cargo")).join("unreleased.rs");
    fs::write(out, code).expect("write unreleased.rs");
}
