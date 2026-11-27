//! Mise en forme des nombres montrés aux joueurs, comme `toLocaleString("fr-FR")` de la v1 : les
//! milliers séparés par une espace fine insécable (U+202F), qu'un montant à cinq chiffres se lise
//! d'un coup d'œil et ne se coupe jamais en fin de ligne.

/// `12345` → « 12 345 », `-1234` → « -1 234 ».
pub fn number(n: i64) -> String {
    let sign = if n < 0 { "-" } else { "" };
    format!("{sign}{}", group(&n.unsigned_abs().to_string()))
}

/// Un nombre qui peut être fractionnaire (un poids de tirage) : au plus trois décimales, sans zéro
/// inutile, comme `toLocaleString("fr-FR")` : `1234.5` → « 1 234,5 », `0.15` → « 0,15 ».
pub fn decimal(value: f64) -> String {
    let rounded = format!("{:.3}", value.abs());
    let (whole, fraction) = rounded.split_once('.').unwrap_or((&rounded, ""));
    let fraction = fraction.trim_end_matches('0');
    let sign = if value < 0.0 && (whole != "0" || !fraction.is_empty()) {
        "-"
    } else {
        ""
    };
    if fraction.is_empty() {
        format!("{sign}{}", group(whole))
    } else {
        format!("{sign}{},{fraction}", group(whole))
    }
}

/// Une part en pourcentage, à `decimals` décimales, comme `(part * 100).toFixed(decimals)` de la
/// v1 suivi de « % » : `0.0512` à 1 décimale → « 5,1 % ».
pub fn percent(share: f64, decimals: usize) -> String {
    format!("{:.decimals$} %", share * 100.0).replace('.', ",")
}

/// Les chiffres d'un entier, milliers séparés par l'espace fine insécable.
fn group(digits: &str) -> String {
    let mut out = String::with_capacity(digits.len() + digits.len() / 3 * 3);
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

    #[test]
    fn decimals_and_percents_match_the_v1_french_format() {
        // `toLocaleString("fr-FR")` et `toFixed` sous Node 22.
        for (value, expected) in [
            (0.0, "0"),
            (70.0, "70"),
            (0.15, "0,15"),
            (17.5, "17,5"),
            (1.0 / 3.0, "0,333"),
            (1234.5, "1\u{202f}234,5"),
            (2.0004, "2"),
        ] {
            assert_eq!(decimal(value), expected, "{value}");
        }
        assert_eq!(percent(0.0512, 1), "5,1 %");
        assert_eq!(percent(1.0, 0), "100 %");
        assert_eq!(percent(0.000_123, 3), "0,012 %");
    }
}
