//! Embarque ce que le dépôt fournit en fichiers et que le bot lit sans jamais le modifier :
//!
//! - les entrées de changelog en attente (`changelog/unreleased/*.toml`) : le bot de dev en poste un
//!   aperçu, sans qu'il faille les recopier nulle part ;
//! - les espèces (`data/pokemon.json`) et les tables de pêche (`data/fishing.json`), converties en
//!   tableaux statiques : aucune lecture de fichier ni analyse JSON au démarrage, et une donnée mal
//!   formée casse la compilation au lieu d'une apparition devant les joueurs.

use std::{env, fmt::Write as _, fs, path::PathBuf};

use serde_json::Value;

fn main() {
    let root =
        PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").expect("set by cargo")).join("../..");
    let out = PathBuf::from(env::var_os("OUT_DIR").expect("set by cargo"));
    fs::write(out.join("unreleased.rs"), unreleased(&root)).expect("write unreleased.rs");
    let (species, known) = species(&root);
    fs::write(out.join("species.rs"), species).expect("write species.rs");
    fs::write(out.join("fishing.rs"), fishing(&root, &known)).expect("write fishing.rs");
}

fn unreleased(root: &std::path::Path) -> String {
    let dir = root.join("changelog/unreleased");
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
    code
}

fn read_json(root: &std::path::Path, name: &str) -> Value {
    let path = root.join("data").join(name);
    println!("cargo:rerun-if-changed={}", path.display());
    let text = fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

/// Un champ obligatoire d'une espèce : la compilation s'arrête sur l'espèce et le champ fautifs.
fn field<'a>(species: &'a Value, key: &str) -> &'a Value {
    species
        .get(key)
        .unwrap_or_else(|| panic!("pokemon.json: species {} has no `{key}`", species["id"]))
}

fn int(species: &Value, key: &str, min: i64, max: i64) -> i64 {
    field(species, key)
        .as_i64()
        .filter(|value| (min..=max).contains(value))
        .unwrap_or_else(|| {
            panic!(
                "pokemon.json: `{key}` of {} is not in {min}..={max}",
                species["id"]
            )
        })
}

fn flag(species: &Value, key: &str) -> bool {
    field(species, key).as_bool().unwrap_or_else(|| {
        panic!(
            "pokemon.json: `{key}` of {} is not a boolean",
            species["id"]
        )
    })
}

fn text<'a>(species: &'a Value, key: &str) -> &'a str {
    field(species, key)
        .as_str()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| panic!("pokemon.json: `{key}` of {} is not a string", species["id"]))
}

fn ids(species: &Value, key: &str) -> Vec<i64> {
    field(species, key)
        .as_array()
        .unwrap_or_else(|| panic!("pokemon.json: `{key}` of {} is not a list", species["id"]))
        .iter()
        .map(|id| id.as_i64().expect("species id"))
        .collect()
}

fn species(root: &std::path::Path) -> (String, Vec<i64>) {
    let data = read_json(root, "pokemon.json");
    let max_generation = data["maxGeneration"]
        .as_i64()
        .filter(|g| (1..=9).contains(g))
        .expect("pokemon.json: maxGeneration");
    let list = data["species"].as_array().expect("pokemon.json: species");
    let known: Vec<i64> = list.iter().map(|s| int(s, "id", 1, 1025)).collect();
    assert!(
        known.windows(2).all(|pair| pair[0] < pair[1]),
        "pokemon.json: species must be sorted by id, without duplicates"
    );

    // Les images se rangent par numéro sous une même base : elle se lit sur la première espèce et
    // se vérifie sur toutes, pour que l'adresse d'une forme (« 201-b ») se calcule sans rien stocker.
    let first = &list[0];
    let base = text(first, "sprite")
        .strip_suffix(&format!("/{}.png", known[0]))
        .expect("pokemon.json: sprite is <base>/<id>.png")
        .to_owned();

    let mut code = String::new();
    writeln!(
        code,
        "/// La dernière génération que les données préparent."
    )
    .expect("write");
    writeln!(code, "pub const MAX_GENERATION: u8 = {max_generation};").expect("write");
    writeln!(code, "const SPRITE_BASE: &str = {base:?};").expect("write");
    code.push_str("static SPECIES: &[Species] = &[\n");
    for species in list {
        let id = int(species, "id", 1, 1025);
        let generation = int(species, "generation", 1, max_generation);
        assert_eq!(
            text(species, "sprite"),
            format!("{base}/{id}.png"),
            "sprite of #{id}"
        );
        assert_eq!(
            text(species, "spriteShiny"),
            format!("{base}/shiny/{id}.png"),
            "shiny sprite of #{id}"
        );
        let types: Vec<&str> = field(species, "types")
            .as_array()
            .expect("types")
            .iter()
            .map(|t| t.as_str().expect("type name"))
            .collect();
        assert!((1..=2).contains(&types.len()), "types of #{id}");
        let evolves_from = match field(species, "evolvesFrom") {
            Value::Null => "None".to_owned(),
            other => {
                let from = other.as_i64().expect("evolvesFrom");
                assert!(known.contains(&from), "#{id} evolves from unknown #{from}");
                format!("Some({from})")
            }
        };
        let evolves_into = ids(species, "evolvesInto");
        for target in &evolves_into {
            assert!(
                known.contains(target),
                "#{id} evolves into unknown #{target}"
            );
        }
        let mut forms = String::new();
        for form in species
            .get("forms")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let form_generation = int(form, "generation", generation, max_generation);
            write!(
                forms,
                "Form {{ key: {:?}, name: {:?}, generation: {form_generation} }}, ",
                text(form, "key"),
                text(form, "name"),
            )
            .expect("write");
        }
        writeln!(
            code,
            "    Species {{ id: {id}, name: {name:?}, slug: {slug:?}, generation: {generation}, \
             catch_rate: {catch_rate}, stage: {stage}, legendary: {legendary}, \
             mythical: {mythical}, baby: {baby}, gender_rate: {gender_rate}, \
             trade_evolution: {trade_evolution}, types: &{types:?}, evolves_from: {evolves_from}, \
             evolves_into: &{evolves_into:?}, forms: &[{forms}] }},",
            name = text(species, "name"),
            slug = text(species, "slug"),
            catch_rate = int(species, "catchRate", 0, 255),
            stage = int(species, "stage", 1, 3),
            legendary = flag(species, "isLegendary"),
            mythical = flag(species, "isMythical"),
            baby = flag(species, "isBaby"),
            gender_rate = int(species, "genderRate", -1, 8),
            trade_evolution = flag(species, "tradeEvolution"),
        )
        .expect("write");
    }
    code.push_str("];\n");
    (code, known)
}

fn fishing(root: &std::path::Path, known: &[i64]) -> String {
    let data = read_json(root, "fishing.json");
    let rods = data["rods"].as_object().expect("fishing.json: rods");
    let mut code = String::from("static RODS: &[(&str, &[(u16, f64)])] = &[\n");
    for (rod, pool) in rods {
        let entries: Vec<String> = pool
            .as_array()
            .expect("fishing.json: a rod is a list")
            .iter()
            .map(|entry| {
                let id = entry[0]
                    .as_i64()
                    .filter(|id| known.contains(id))
                    .expect("known species id");
                let weight = entry[1]
                    .as_f64()
                    .filter(|w| w.is_finite() && *w >= 0.0)
                    .expect("fishing weight");
                format!("({id}, {weight:?})")
            })
            .collect();
        writeln!(code, "    ({rod:?}, &[{}]),", entries.join(", ")).expect("write");
    }
    code.push_str("];\n");
    code
}
