//! Builds a throwaway schema database from the migrations so that every `sqlx::query!` is
//! checked at compile time against the real schema, without a `DATABASE_URL` to set up or a
//! `.sqlx/` cache to keep in sync. Game and stats tables share this check database (their names
//! never collide); at runtime they live in two separate files.

use std::{env, fs, path::PathBuf};

const MIGRATION_DIRS: [&str; 2] = ["migrations/game", "migrations/stats"];

fn main() {
    let out = PathBuf::from(env::var_os("OUT_DIR").expect("cargo sets OUT_DIR"));
    let db = out.join("schema.db");
    // A stale file would keep dropped tables alive and hide broken queries.
    let _ = fs::remove_file(&db);
    let conn = rusqlite::Connection::open(&db).expect("create schema.db");

    for dir in MIGRATION_DIRS {
        println!("cargo:rerun-if-changed={dir}");
        let mut files: Vec<PathBuf> = fs::read_dir(dir)
            .unwrap_or_else(|e| panic!("read {dir}: {e}"))
            .map(|entry| entry.expect("dir entry").path())
            .filter(|path| path.extension().is_some_and(|ext| ext == "sql"))
            .collect();
        files.sort();
        for file in files {
            let sql = fs::read_to_string(&file).expect("read migration");
            conn.execute_batch(&sql)
                .unwrap_or_else(|e| panic!("{}: {e}", file.display()));
        }
    }

    println!("cargo:rustc-env=DATABASE_URL=sqlite://{}", db.display());
}
