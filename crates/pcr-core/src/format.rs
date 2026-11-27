//! Mise en forme des nombres montrés aux joueurs, comme `toLocaleString("fr-FR")` de la v1 : les
//! milliers séparés par une espace fine insécable (U+202F), qu'un montant à cinq chiffres se lise
//! d'un coup d'œil et ne se coupe jamais en fin de ligne.

/// `12345` → « 12 345 », `-1234` → « -1 234 ».
pub fn number(n: i64) -> String {
    let digits = n.unsigned_abs().to_string();
    let mut out = String::with_capacity(digits.len() + digits.len() / 3 * 3 + 1);
    if n < 0 {
        out.push('-');
    }
    for (i, digit) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push('\u{202f}');
        }
        out.push(digit);
    }
    out
}

/// Un mouvement de solde : « +1 500 », « -200 » (zéro sans signe, comme en v1).
pub fn signed(n: i64) -> String {
    if n > 0 {
        format!("+{}", number(n))
    } else {
        number(n)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_the_v1_french_format() {
        // Sorties de `toLocaleString("fr-FR")` sous Node 22.
        for (n, expected) in [
            (0, "0"),
            (5, "5"),
            (999, "999"),
            (1000, "1\u{202f}000"),
            (12_345, "12\u{202f}345"),
            (1_234_567, "1\u{202f}234\u{202f}567"),
            (-1234, "-1\u{202f}234"),
            (-5, "-5"),
            (
                i64::MIN,
                "-9\u{202f}223\u{202f}372\u{202f}036\u{202f}854\u{202f}775\u{202f}808",
            ),
        ] {
            assert_eq!(number(n), expected, "{n}");
        }
        assert_eq!(signed(1500), "+1\u{202f}500");
        assert_eq!(signed(-200), "-200");
        assert_eq!(signed(0), "0");
    }
}
