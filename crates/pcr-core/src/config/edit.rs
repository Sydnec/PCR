//! Édition de la configuration : chemins, conversion de la saisie d'un administrateur, et application
//! des surcharges.
//!
//! Tout passe par l'arbre JSON des défauts (`defaults()`), comme en v1 : ses feuilles sont les seuls
//! réglages qui existent, et le type de chaque défaut impose celui de la saisie. Une surcharge n'est
//! retenue que si la configuration complète qui en résulte se relit en `GameConfig` : un entier, une
//! liste ou une structure mal formés n'atteignent jamais le jeu.

use std::sync::LazyLock;

use serde_json::{Map, Value};

use super::{GameConfig, bounds::bounds, render::js_number};
use crate::refusal::Refusal;

static DEFAULTS: LazyLock<Value> = LazyLock::new(|| {
    serde_json::to_value(GameConfig::default()).expect("GameConfig serializes to JSON")
});

/// L'arbre des valeurs par défaut : le schéma de tous les réglages.
pub fn defaults() -> &'static Value {
    &DEFAULTS
}

/// Le chemin normalisé et la valeur par défaut d'un réglage existant.
pub fn lookup(path: &str) -> Result<(String, &'static Value), Refusal> {
    let segments: Vec<&str> = path.split('.').filter(|s| !s.is_empty()).collect();
    if segments.is_empty() {
        return Err(Refusal::new("Aucun réglage indiqué."));
    }
    let found = segments
        .iter()
        .try_fold(defaults(), |node, segment| node.get(*segment));
    match found {
        Some(default) => Ok((segments.join("."), default)),
        None => Err(Refusal::new(format!("Réglage inconnu : `{path}`"))),
    }
}

/// Convertit la saisie `raw` au type du réglage `path`, ou explique le refus. Rend le chemin
/// normalisé et la valeur JSON à enregistrer.
pub fn parse(path: &str, raw: &str) -> Result<(String, Value), Refusal> {
    let (path, default) = lookup(path)?;
    let value = match default {
        Value::Object(_) => {
            return Err(Refusal::new(
                "Ce réglage est une branche, pas une valeur : précise une clé dedans.",
            ));
        }
        Value::Number(n) => parse_number(&path, raw, n.as_f64().unwrap_or(0.0), !n.is_f64())?,
        Value::Bool(_) => match raw.trim().to_lowercase().as_str() {
            "true" | "vrai" | "oui" | "1" => Value::Bool(true),
            "false" | "faux" | "non" | "0" => Value::Bool(false),
            _ => return Err(Refusal::new(format!("`{raw}` n'est ni vrai ni faux."))),
        },
        Value::Array(items) => parse_list(raw, items)?,
        _ if path.starts_with("pokemon.generationOpenings.") => parse_opening(raw)?,
        _ => Value::String(raw.to_owned()),
    };
    Ok((path, value))
}

fn parse_number(path: &str, raw: &str, default: f64, integer: bool) -> Result<Value, Refusal> {
    let value: f64 = raw
        .trim()
        .replace(',', ".")
        .parse()
        .ok()
        .filter(|v: &f64| v.is_finite())
        .ok_or_else(|| Refusal::new(format!("`{raw}` n'est pas un nombre.")))?;
    let (min, max) = bounds(path, default);
    if let Some(min) = min.filter(|min| value < *min) {
        return Err(Refusal::new(format!(
            "`{}` est en dessous du minimum autorisé ({}).",
            js_number(value),
            js_number(min)
        )));
    }
    if let Some(max) = max.filter(|max| value > *max) {
        return Err(Refusal::new(format!(
            "`{}` dépasse le maximum autorisé ({}).",
            js_number(value),
            js_number(max)
        )));
    }
    if !integer {
        return serde_json::Number::from_f64(value)
            .map(Value::Number)
            .ok_or_else(|| Refusal::new(format!("`{raw}` n'est pas un nombre.")));
    }
    // La v1 ne connaissait que des flottants ; la v2 type ses compteurs, prix et durées en entiers.
    if value.fract() != 0.0 {
        return Err(Refusal::new(format!("`{raw}` n'est pas un nombre entier.")));
    }
    #[allow(clippy::cast_possible_truncation)]
    // entier vérifié ci-dessus ; la relecture borne le type
    let integer = value as i64;
    Ok(Value::from(integer))
}

/// Une liste se saisit séparée par des virgules, ou en JSON (`[…]`) quand ses éléments sont des
/// structures (les paliers de starter). Des éléments numériques restent des nombres : la v1 les
/// enregistrait en texte.
fn parse_list(raw: &str, default: &[Value]) -> Result<Value, Refusal> {
    if raw.trim_start().starts_with('[') {
        return serde_json::from_str(raw)
            .map_err(|_| Refusal::new(format!("`{raw}` ne convient pas à ce réglage.")));
    }
    let parts: Vec<&str> = raw
        .split(',')
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .collect();
    if parts.is_empty() {
        return Err(Refusal::new(
            "Liste vide : sépare les valeurs par des virgules.",
        ));
    }
    let numeric = default.first().is_some_and(Value::is_number);
    parts
        .into_iter()
        .map(|part| {
            if !numeric {
                return Ok(Value::String(part.to_owned()));
            }
            part.parse::<i64>()
                .map(Value::from)
                .map_err(|_| Refusal::new(format!("`{part}` n'est pas un nombre.")))
        })
        .collect::<Result<Vec<_>, _>>()
        .map(Value::Array)
}

/// Une date d'ouverture illisible ne s'ouvrirait jamais, une date approximative trop tôt, et
/// l'annonce ne se reprend pas : on exige une date ISO complète, fuseau compris.
fn parse_opening(raw: &str) -> Result<Value, Refusal> {
    let value = raw.trim();
    let complete = value.len() >= 16 && value.as_bytes().get(10) == Some(&b'T');
    match value.parse::<jiff::Timestamp>() {
        Ok(_) if complete => Ok(Value::String(value.to_owned())),
        _ => Err(Refusal::new(format!(
            "`{raw}` n'est pas une date lisible : par exemple `2026-10-30T18:00:00+01:00`."
        ))),
    }
}

/// Pose `value` sous `path` dans `tree` (les nœuds intermédiaires existent : `path` vient des défauts).
pub fn set(tree: &mut Value, path: &str, value: Value) {
    let mut node = tree;
    let mut segments = path.split('.').peekable();
    while let Some(segment) = segments.next() {
        let Value::Object(map) = node else { return };
        if segments.peek().is_none() {
            map.insert(segment.to_owned(), value);
            return;
        }
        node = map
            .entry(segment.to_owned())
            .or_insert_with(|| Value::Object(Map::new()));
    }
}

/// La configuration qui résulte des surcharges, et celles qu'il a fallu écarter (réglage disparu,
/// valeur que la v2 refuse) pour les signaler : les valeurs par défaut s'appliquent à leur place.
pub fn build(overrides: &[(String, Value)]) -> (GameConfig, Value, Vec<String>) {
    let mut tree = defaults().clone();
    let mut config = GameConfig::default();
    let mut rejected = Vec::new();
    for (path, value) in overrides {
        let mut candidate = tree.clone();
        let accepted = acceptable(path, value) && {
            set(&mut candidate, path, value.clone());
            match serde_json::from_value::<GameConfig>(candidate.clone()) {
                Ok(next) => {
                    config = next;
                    true
                }
                Err(_) => false,
            }
        };
        if accepted {
            tree = candidate;
        } else {
            rejected.push(path.clone());
        }
    }
    (config, tree, rejected)
}

/// Les contrôles de `parse` appliqués à une valeur déjà en JSON (surcharge relue en base).
fn acceptable(path: &str, value: &Value) -> bool {
    let Ok((normalized, default)) = lookup(path) else {
        return false;
    };
    match (default, value) {
        (Value::Number(d), Value::Number(v)) => parse_number(
            &normalized,
            &v.to_string(),
            d.as_f64().unwrap_or(0.0),
            !d.is_f64(),
        )
        .is_ok(),
        (Value::String(_), Value::String(s))
            if normalized.starts_with("pokemon.generationOpenings.") =>
        {
            parse_opening(s).is_ok()
        }
        (Value::Bool(_), Value::Bool(_))
        | (Value::Array(_), Value::Array(_))
        | (Value::String(_), Value::String(_)) => true,
        _ => false,
    }
}

/// Toutes les feuilles de `tree` sous `prefix` (tout l'arbre si vide), dans l'ordre de déclaration.
pub fn leaves<'a>(tree: &'a Value, prefix: &str) -> Vec<(String, &'a Value)> {
    fn walk<'a>(node: &'a Value, path: &str, out: &mut Vec<(String, &'a Value)>) {
        match node {
            Value::Object(map) => {
                for (key, child) in map {
                    let child_path = if path.is_empty() {
                        key.clone()
                    } else {
                        format!("{path}.{key}")
                    };
                    walk(child, &child_path, out);
                }
            }
            leaf => out.push((path.to_owned(), leaf)),
        }
    }
    let mut out = Vec::new();
    walk(tree, "", &mut out);
    out.retain(|(path, _)| {
        prefix.is_empty() || path == prefix || path.starts_with(&format!("{prefix}."))
    });
    out
}

/// La valeur sous `path` dans `tree`.
pub fn get<'a>(tree: &'a Value, path: &str) -> Option<&'a Value> {
    path.split('.')
        .try_fold(tree, |node, segment| node.get(segment))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn each_refusal_gives_the_v1_reason() {
        let refusal = |path: &str, raw: &str| parse(path, raw).expect_err(raw).to_string();
        assert_eq!(refusal("", "1"), "Aucun réglage indiqué.");
        assert_eq!(
            refusal("pokemon.nope", "1"),
            "Réglage inconnu : `pokemon.nope`"
        );
        assert_eq!(
            refusal("pokemon.spawn", "1"),
            "Ce réglage est une branche, pas une valeur : précise une clé dedans."
        );
        assert_eq!(
            refusal("pokemon.spawn.shinyOdds", "beaucoup"),
            "`beaucoup` n'est pas un nombre."
        );
        assert_eq!(
            refusal("pokemon.spawn.shinyOdds", "0"),
            "`0` est en dessous du minimum autorisé (1)."
        );
        assert_eq!(
            refusal("redistribution.contributionPercent", "150"),
            "`150` dépasse le maximum autorisé (100)."
        );
        // Au-delà de la dernière génération des données.
        assert_eq!(
            refusal("pokemon.generation", "3"),
            "`3` dépasse le maximum autorisé (2)."
        );
        assert_eq!(
            refusal("pokemon.capture.globalMultiplier", "-1"),
            "`-1` est en dessous du minimum autorisé (0)."
        );
        assert_eq!(
            refusal("pokemon.spawn.messagesPerSpawn", "2,5"),
            "`2,5` n'est pas un nombre entier."
        );
        assert_eq!(
            refusal("pokemon.enabled", "peut-être"),
            "`peut-être` n'est ni vrai ni faux."
        );
        assert_eq!(
            refusal("pokemon.generationOpenings.2", "2026-10-30"),
            "`2026-10-30` n'est pas une date lisible : par exemple `2026-10-30T18:00:00+01:00`."
        );
        assert_eq!(
            refusal("pokemon.spawn.pingRarities", " , "),
            "Liste vide : sépare les valeurs par des virgules."
        );
    }

    #[test]
    fn accepted_input_takes_the_type_of_the_default() {
        let ok = |path: &str, raw: &str| parse(path, raw).expect(raw).1;
        assert_eq!(ok("pokemon.capture.globalMultiplier", "0,5"), json!(0.5));
        assert_eq!(ok("pokemon.spawn.shinyOdds", " 1024 "), json!(1024));
        assert_eq!(ok("birthday.enabled", "Non"), json!(false));
        assert_eq!(ok("pokemon.starterLines", "1, 4,7"), json!([1, 4, 7]));
        assert_eq!(
            ok("pokemon.spawn.pingRarities", "RARE, LEGENDAIRE"),
            json!(["RARE", "LEGENDAIRE"])
        );
    }

    #[test]
    fn overrides_apply_and_stale_ones_are_reported_not_applied() {
        let overrides = vec![
            ("pokemon.spawn.shinyOdds".to_owned(), json!(256)),
            // Disparu de la v2, hors bornes, ou d'un type que la relecture refuse.
            ("pokemon.fusion.points".to_owned(), json!(1)),
            ("redistribution.contributionPercent".to_owned(), json!(50.5)),
            ("redistribution.intervalHours".to_owned(), json!(0)),
            ("pokemon.starters.rewards".to_owned(), json!(["oops"])),
        ];
        let (config, tree, rejected) = build(&overrides);
        assert_eq!(config.pokemon.spawn.shiny_odds, 256);
        assert!((config.redistribution.contribution_percent - 50.5).abs() < f64::EPSILON);
        assert_eq!(config.redistribution.interval_hours, 168);
        assert_eq!(get(&tree, "pokemon.spawn.shinyOdds"), Some(&json!(256)));
        assert_eq!(
            rejected,
            [
                "pokemon.fusion.points",
                "redistribution.intervalHours",
                "pokemon.starters.rewards"
            ]
        );
    }
}
