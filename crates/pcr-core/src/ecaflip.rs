//! `/ecaflip` : pile ou face. Une seule option est une question : la réponse est « Oui » ou « Non » ;
//! plusieurs options, l'une d'elles au hasard.

use rand::{Rng, RngExt as _};

/// Le tirage. `options` n'est jamais vide (la première option est obligatoire).
pub fn flip(options: &[String], rng: &mut (impl Rng + ?Sized)) -> String {
    match options {
        [] => String::new(),
        [_] => if rng.random_bool(0.5) { "Oui" } else { "Non" }.to_owned(),
        _ => options[rng.random_range(0..options.len())].clone(),
    }
}

#[cfg(test)]
mod tests {
    use rand::{SeedableRng as _, rngs::StdRng};

    use super::*;

    #[test]
    fn one_option_is_a_question_several_are_a_draw() {
        let mut rng = StdRng::seed_from_u64(1);
        let question = ["Il pleut ?".to_owned()];
        let answers: Vec<String> = (0..50).map(|_| flip(&question, &mut rng)).collect();
        assert!(answers.iter().any(|a| a == "Oui") && answers.iter().any(|a| a == "Non"));
        assert!(answers.iter().all(|a| a == "Oui" || a == "Non"));
        let options = ["pile".to_owned(), "face".to_owned(), "tranche".to_owned()];
        for _ in 0..50 {
            assert!(options.contains(&flip(&options, &mut rng)));
        }
    }
}
