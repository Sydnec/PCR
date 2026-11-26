//! Rendu des valeurs de configuration, comme les affichait l'administration v1.

use serde_json::Value;

/// Le nom du type d'une valeur, tel que l'affiche l'administration v1.
pub fn type_name(value: &Value) -> &'static str {
    match value {
        Value::Array(_) => "liste",
        Value::Object(_) => "objet",
        Value::Number(_) => "nombre",
        Value::Bool(_) => "booléen",
        _ => "texte",
    }
}

/// Forme courte, sur une ligne : pour une liste ou un libellé d'autocomplétion.
pub fn preview(value: &Value) -> String {
    match value {
        Value::Array(items) => items.iter().map(scalar).collect::<Vec<_>>().join(", "),
        Value::Object(map) => format!("{{ {} réglage(s) }}", map.len()),
        other => scalar(other),
    }
}

/// Forme détaillée, pour l'affichage d'une valeur seule.
pub fn format(value: &Value) -> String {
    match value {
        Value::Object(_) => format!(
            "```json\n{}\n```",
            serde_json::to_string_pretty(value).unwrap_or_default()
        ),
        Value::Array(_) => preview(value),
        other => format!("`{}`", scalar(other)),
    }
}

/// Une valeur comme l'écrivait la v1 (`String(value)`) : un flottant entier sans « .0 », un texte
/// sans guillemets. Une structure dans une liste se montre en JSON plutôt qu'en « [object Object] ».
fn scalar(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        Value::Number(n) if n.is_f64() => js_number(n.as_f64().unwrap_or(0.0)),
        other => other.to_string(),
    }
}

pub(super) fn js_number(value: f64) -> String {
    if value.fract() == 0.0 && value.abs() < 1e15 {
        format!("{value:.0}")
    } else {
        value.to_string()
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn values_render_like_the_v1_admin() {
        assert_eq!(preview(&json!(1.0)), "1");
        assert_eq!(preview(&json!(["RARE", "LEGENDAIRE"])), "RARE, LEGENDAIRE");
        assert_eq!(preview(&json!({"min": 45, "max": 90})), "{ 2 réglage(s) }");
        assert_eq!(format(&json!(0.15)), "`0.15`");
        assert_eq!(format(&json!("texte")), "`texte`");
    }
}
