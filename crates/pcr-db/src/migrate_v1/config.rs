//! Reprise de `config.json`, les réglages modifiés à chaud en v1.
//!
//! La v1 y gardait un arbre partiel, fusionné en profondeur sur les valeurs par défaut du code : chaque
//! feuille est une surcharge. La v2 range une ligne par chemin pointé (« pokemon.spawn.shinyOdds »),
//! avec la valeur en JSON. Un tableau est une valeur entière (les paliers de starter, les raretés
//! annoncées…), pas une branche : il ne se découpe pas.

use std::path::Path;

use serde_json::Value;
use sqlx::SqliteConnection;

use super::{MigrateError, Report, TableReport};

/// Les surcharges de `path`, en (chemin pointé, valeur JSON).
pub(super) fn read(path: &Path) -> Result<Vec<(String, String)>, MigrateError> {
    let text = std::fs::read_to_string(path)?;
    let value: Value =
        serde_json::from_str(&text).map_err(|error| MigrateError::Config(error.to_string()))?;
    if !value.is_object() {
        return Err(MigrateError::Config("the root is not an object".to_owned()));
    }
    let mut overrides = Vec::new();
    flatten(String::new(), &value, &mut overrides);
    Ok(overrides)
}

fn flatten(path: String, value: &Value, out: &mut Vec<(String, String)>) {
    match value {
        Value::Object(map) => {
            for (key, child) in map {
                let child_path = if path.is_empty() {
                    key.clone()
                } else {
                    format!("{path}.{key}")
                };
                flatten(child_path, child, out);
            }
        }
        leaf => out.push((path, leaf.to_string())),
    }
}

pub(super) async fn convert(
    conn: &mut SqliteConnection,
    report: &mut Report,
    overrides: &[(String, String)],
    now_ms: i64,
) -> Result<(), MigrateError> {
    for (key, value) in overrides {
        sqlx::query(
            "INSERT INTO config_overrides (key, value, updated_at, updated_by) VALUES (?, ?, ?, NULL)",
        )
        .bind(key)
        .bind(value)
        .bind(now_ms)
        .execute(&mut *conn)
        .await
        .map_err(|source| MigrateError::Step {
            table: "config_overrides",
            source,
        })?;
    }
    let count = i64::try_from(overrides.len()).unwrap_or(i64::MAX);
    report.tables.push(TableReport {
        table: "config_overrides",
        from: "config.json",
        read: count,
        written: count,
        notes: Vec::new(),
    });
    Ok(())
}
