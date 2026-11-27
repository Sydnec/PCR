//! Calendrier de l'Avent : du 1er au 24 décembre, chaque jour un fil et sa question (questions de
//! `modules/advent.json` de la v1, qui n'avait ni catégorie ni image).

use jiff::civil::Date;

/// La question de chaque jour, du 1er au 24 décembre.
const QUESTIONS: [&str; 24] = [
    "3 films que tu as vus cette année",
    "3 musiques que tu as beaucoup écoutées",
    "Les 3 personnes avec qui tu as le plus parlé",
    "3 plats que tu as le plus appréciés cette année",
    "3 cadeaux ou attentions que tu as reçus et appréciés",
    "3 photos dans ton téléphone prises cette année (que tu apprécies / qui résument ton année)",
    "3 lieux que tu as visités",
    "3 jeux vidéo ou jeux de société auxquels tu as joué cette année",
    "3 vêtements / accessoires que tu as le plus portés",
    "3 concerts que tu as faits cette année",
    "3 nouvelles habitudes que tu as prises cette année",
    "3 livres / BD / mangas que tu as lus cette année",
    "3 comptes Instagram / YouTube / TikTok / Twitter que tu as découverts cette année",
    "3 choses que tu attends avec impatience pour l'an prochain",
    "3 restaurants que tu as découverts cette année",
    "3 applications (téléphone) que tu as le plus utilisées",
    "3 mots que tu as appris cette année",
    "3 séries que tu as regardées cette année",
    "3 regrets de cette année",
    "3 objectifs pour l'année prochaine",
    "3 streamers / évènements Twitch que tu as appréciés cette année",
    "3 objets que tu as beaucoup utilisés cette année",
    "3 décisions que tu as prises cette année",
    "3 traditions de Noël que tu vas faire cette année",
];

/// La case du jour, s'il y en a une.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Door {
    /// Le nom du fil : le jour et le début de la question.
    pub thread_name: String,
    /// Le message d'ouverture, épinglé.
    pub message: String,
}

/// Longueur de la question dans le nom du fil, comme en v1.
const NAME_QUESTION: usize = 80;

/// La case de `today` : seulement du 1er au 24 décembre.
pub fn door(today: Date) -> Option<Door> {
    if today.month() != 12 {
        return None;
    }
    let day = today.day();
    let question = QUESTIONS.get(usize::try_from(day).ok()?.checked_sub(1)?)?;
    let short: String = question.chars().take(NAME_QUESTION).collect();
    Some(Door {
        thread_name: format!("Jour {day} - {short}"),
        message: format!(
            "# 🎄 Calendrier de l'Avent - Jour {day}\n\n{question}\n\n_Partagez vos réponses ci-dessous !_ ✨"
        ),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn date(text: &str) -> Date {
        text.parse().expect("date")
    }

    #[test]
    fn a_door_opens_each_day_from_the_first_to_the_twenty_fourth_of_december() {
        assert_eq!(door(date("2026-11-30")), None);
        assert_eq!(door(date("2026-12-25")), None);
        let first = door(date("2026-12-01")).expect("door");
        assert_eq!(
            first.thread_name,
            "Jour 1 - 3 films que tu as vus cette année"
        );
        assert_eq!(
            first.message,
            "# 🎄 Calendrier de l'Avent - Jour 1\n\n3 films que tu as vus cette année\n\n\
             _Partagez vos réponses ci-dessous !_ ✨"
        );
        let sixth = door(date("2026-12-06")).expect("door");
        assert_eq!(sixth.thread_name.chars().count(), "Jour 6 - ".len() + 80);
        assert!(door(date("2026-12-24")).is_some());
    }
}
