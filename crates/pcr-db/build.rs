//! Construit une base de schéma jetable à partir des migrations : chaque `sqlx::query!` est ainsi
//! vérifié à la compilation contre le vrai schéma, sans `DATABASE_URL` à préparer ni cache `.sqlx/`
//! à tenir à jour. Tables de jeu et de stats partagent cette base de vérification (leurs noms ne se
//! recoupent jamais) ; à l'exécution, elles vivent dans deux fichiers distincts.

use std::{env, fs, path::PathBuf};

const MIGRATION_DIRS: [&str; 2] = ["migrations/game", "migrations/stats"];

fn main() {
    let out = PathBuf::from(env::var_os("OUT_DIR").expect("cargo sets OUT_DIR"));
    let db = out.join("schema.db");
    // Un fichier périmé garderait des tables supprimées et masquerait des requêtes cassées.
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
