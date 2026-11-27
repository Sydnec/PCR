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
    let rounded = fixed(value.abs(), 3);
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
    let value = share * 100.0;
    let sign = if value < 0.0 { "-" } else { "" };
    format!("{sign}{} %", fixed(value.abs(), decimals)).replace('.', ",")
}

/// Les décimales qu'il faut pour écrire exactement n'importe quel flottant (1 074 au plus).
const EXACT_DIGITS: usize = 1100;

/// Un nombre positif à `decimals` décimales, comme `toFixed` et `toLocaleString` de la v1 : le plus
/// proche, et une moitié exacte vers le haut (« 12,5 » → « 13 »). Rust arrondit une moitié exacte
/// au chiffre pair (« 12 ») : on la repère sur le développement décimal complet du flottant, qui
/// n'a alors que des zéros après le 5. Multiplier avant d'arrondir ne conviendrait pas : 0,15 vaut
/// en réalité 0,1499…, que la v1 écrit « 0,1 », mais `0.15 * 10` tombe pile sur 1,5.
fn fixed(value: f64, decimals: usize) -> String {
    // Une moitié exacte s'écrit pile avec un chiffre de plus, terminé par 5 : sinon, pas la peine
    // de développer le flottant en entier.
    let one_more = decimals + 1;
    if !format!("{value:.one_more$}").ends_with('5') {
        return format!("{value:.decimals$}");
    }
    let exact = format!("{value:.EXACT_DIGITS$}");
    let point = exact.find('.').unwrap_or(exact.len());
    let fraction = exact.as_bytes().get(point + 1..).unwrap_or_default();
    let tie = fraction.get(decimals) == Some(&b'5')
        && fraction
            .iter()
            .skip(decimals + 1)
            .all(|digit| *digit == b'0');
    if !tie {
        return format!("{value:.decimals$}");
    }
    // Les chiffres gardés, augmentés d'une unité au dernier rang, retenue comprise.
    let kept = &exact[..if decimals == 0 {
        point
    } else {
        point + 1 + decimals
    }];
    let mut digits: Vec<u8> = kept.bytes().collect();
    let mut carry = true;
    for digit in digits
        .iter_mut()
        .rev()
        .filter(|digit| digit.is_ascii_digit())
    {
        if !carry {
            break;
        }
        carry = *digit == b'9';
        *digit = if carry { b'0' } else { *digit + 1 };
    }
    if carry {
        digits.insert(0, b'1');
    }
    String::from_utf8(digits).unwrap_or_default()
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
        // Une moitié exacte monte, comme en v1 ; une moitié apparente reste ce qu'elle vaut.
        assert_eq!(percent(0.125, 0), "13 %");
        assert_eq!(decimal(0.0625), "0,063");
        assert_eq!(decimal(9.9995), "9,999");
        assert_eq!(decimal(999.9995), "1\u{202f}000");
        assert_eq!(decimal(0.15), "0,15");
        assert_eq!(percent(1.0, 0), "100 %");
        assert_eq!(percent(0.000_123, 3), "0,012 %");
    }
}
