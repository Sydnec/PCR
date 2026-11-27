//! Codec des `custom_id` : la grammaire v1 `action|arg|…`.
//!
//! Les boutons des messages publics vivent aussi longtemps que leur message : ceux qu'a posés la v1
//! doivent rester décodables tels quels. D'où une grammaire unique, celle de la v1, plutôt qu'un
//! format v2 : un `custom_id` est une action suivie d'arguments, séparés par `|`.

use std::fmt::Display;

/// Séparateur des champs, celui de la v1.
const SEPARATOR: char = '|';

/// Un `custom_id` découpé : son action et ses arguments.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Parsed<'a> {
    pub action: &'a str,
    args: Vec<&'a str>,
}

impl<'a> Parsed<'a> {
    pub fn new(custom_id: &'a str) -> Self {
        let mut fields = custom_id.split(SEPARATOR);
        let action = fields.next().unwrap_or_default();
        Self {
            action,
            args: fields.collect(),
        }
    }

    /// L'argument `index` (à partir de 0), s'il existe.
    pub fn arg(&self, index: usize) -> Option<&'a str> {
        self.args.get(index).copied()
    }

    /// L'argument `index` lu comme un identifiant strictement positif (pari, option, message) : la
    /// v1 n'en a jamais posé d'autres, un zéro ou un négatif vient d'un `custom_id` trafiqué.
    pub fn id(&self, index: usize) -> Option<i64> {
        self.arg(index)?.parse().ok().filter(|id| *id > 0)
    }
}

/// Assemble un `custom_id` : `action|arg|…`.
pub fn encode(action: &str, args: &[&dyn Display]) -> String {
    let mut out = action.to_owned();
    for arg in args {
        out.push(SEPARATOR);
        out.push_str(&arg.to_string());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_v1_grammar() {
        let parsed = Parsed::new("bet_join|12|3");
        assert_eq!(parsed.action, "bet_join");
        assert_eq!(
            (parsed.id(0), parsed.id(1), parsed.id(2)),
            (Some(12), Some(3), None)
        );
        assert_eq!(Parsed::new("bet_join|0|-1").id(0), None);
        assert_eq!(Parsed::new("bet_join|x").id(0), None);
        assert_eq!(Parsed::new("solo").action, "solo");
        assert_eq!(encode("bet_join", &[&12, &3]), "bet_join|12|3");
    }
}
