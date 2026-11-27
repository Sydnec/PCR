//! Le catalogue des objets (`pokemon.items`) : ce que la config en dit, mis en forme, et les deux
//! tables qui le tirent au sort (ce que tient un Pokémon, la loterie). L'effet d'un objet vit dans
//! la fonctionnalité qui le consomme, jamais ici.

use rand::{Rng, RngExt as _};

use crate::config::{Item, Pokemon};

/// Un objet prêt à afficher. Un objet adossé à une ball (`ball: "poke"`) en emprunte le libellé,
/// l'icône et l'image : changer l'emoji d'une ball suffit, l'objet suit. L'objet garde le dernier
/// mot s'il pose les siens.
#[derive(Debug, Clone, Copy)]
pub struct CatalogueItem<'a> {
    pub key: &'static str,
    pub item: &'a Item,
    pub label: &'a str,
    pub emoji: &'a str,
    pub sprite: Option<&'a str>,
}

/// L'icône d'un objet qui n'en a pas, ni sa ball.
const DEFAULT_EMOJI: &str = "📦";

fn resolve<'a>(config: &'a Pokemon, key: &'static str, item: &'a Item) -> CatalogueItem<'a> {
    let ball = item
        .ball
        .as_deref()
        .and_then(|ball| config.capture.balls.get(ball));
    CatalogueItem {
        key,
        item,
        label: item
            .label
            .as_deref()
            .or(ball.map(|ball| ball.label.as_str()))
            .unwrap_or(key),
        emoji: item
            .emoji
            .as_deref()
            .or(ball.map(|ball| ball.emoji.as_str()))
            .unwrap_or(DEFAULT_EMOJI),
        sprite: item
            .sprite
            .as_deref()
            .or(ball.map(|ball| ball.sprite.as_str())),
    }
}

/// Le catalogue, dans son ordre de déclaration.
pub fn all(config: &Pokemon) -> impl Iterator<Item = CatalogueItem<'_>> {
    config
        .items
        .entries()
        .into_iter()
        .map(move |(key, item)| resolve(config, key, item))
}

/// Un objet du catalogue, ou rien pour une clé inconnue (lue en base ou dans un bouton).
pub fn get<'a>(config: &'a Pokemon, key: &str) -> Option<CatalogueItem<'a>> {
    all(config).find(|item| item.key == key)
}

/// L'objet qui offre un lancer de cette ball. Le catalogue décide, pas une convention de nommage.
pub fn ball_item<'a>(config: &'a Pokemon, ball: &str) -> Option<CatalogueItem<'a>> {
    all(config).find(|item| item.item.ball.as_deref() == Some(ball))
}

/// Le Charme Chroma d'une génération, tel que le catalogue le déclare.
pub fn charm_item(config: &Pokemon, generation: u8) -> Option<CatalogueItem<'_>> {
    all(config).find(|item| {
        item.item
            .charm
            .as_ref()
            .is_some_and(|charm| charm.generation == generation)
    })
}

impl CatalogueItem<'_> {
    /// La génération qui l'ouvre. Une canne s'ouvre avec la pêche (`fishing.generation`), pas avec
    /// une génération écrite à part : les deux ne peuvent pas diverger.
    pub fn generation(&self, config: &Pokemon) -> u8 {
        if self.item.rod.is_some() {
            config.fishing.generation
        } else {
            self.item.generation.unwrap_or(1)
        }
    }

    /// Un objet d'une génération fermée ne tombe pas : la Pierre Soleil n'a rien à faire évoluer
    /// tant que Joliflor n'existe pas.
    pub fn open_in(&self, config: &Pokemon, generation: u8) -> bool {
        self.generation(config) <= generation
    }

    /// Ce que vaut un exemplaire revendu ; 0 : il ne se revend pas.
    pub fn sell_value(&self) -> u32 {
        self.item.sell_value.unwrap_or(0)
    }

    /// Ce que rapporte un exemplaire reçu au-delà de la limite.
    pub fn overflow_value(&self) -> u32 {
        self.item.overflow_value.unwrap_or(0)
    }

    /// Combien un dresseur peut en garder (la Master Ball : une). Une limite sans prix de revente ne
    /// joue pas : elle détruirait chaque exemplaire de trop contre rien.
    pub fn cap(&self) -> Option<u32> {
        self.item
            .max_held
            .filter(|cap| *cap > 0 && self.overflow_value() > 0)
    }

    /// Tout s'échange, sauf les charmes (ils se gagnent en complétant un Pokédex : cédé, un charme
    /// serait redonné à son porteur, un échange le dupliquerait) et la canne de base, donnée à tous.
    pub fn is_tradable(&self) -> bool {
        let base_rod = self.item.rod.as_ref().and_then(|rod| rod.base) == Some(true);
        self.item.charm.is_none() && !base_rod
    }

    /// Combien d'exemplaires forment un lot de loterie (à l'unité sans fourchette). Une borne
    /// absurde (nulle, max sous min) se rabat sur quelque chose de jouable.
    pub fn lot(&self) -> (u32, u32) {
        let (min, max) = self
            .item
            .lot
            .as_ref()
            .map_or((0, 0), |lot| (lot.min, lot.max));
        let min = if min > 0 { min } else { 1 };
        let max = if max > 0 { max } else { min };
        (min, max.max(min))
    }
}

/// Les deux tables qui tirent un objet au sort. Elles ont été la même jusqu'au jour où la loterie a
/// dû donner quelque chose sept fois sur dix : on dilue la loterie avec du poids de balls, et ce
/// que tiennent les Pokémon ne bouge pas. Un tirage dit toujours laquelle il veut.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Table {
    /// Ce que tient un Pokémon qui apparaît (`dropWeight`).
    Held,
    /// Le lot d'un tirage de loterie (`lotteryWeight`, `dropWeight` à défaut).
    Lottery,
}

impl Table {
    /// Le poids d'un objet dans la table, à cette génération : nul pour un objet fermé ou sans poids
    /// (un objet dont l'effet n'est pas branché ne tombe pas).
    pub fn weight(self, item: &CatalogueItem<'_>, config: &Pokemon, generation: u8) -> f64 {
        if !item.open_in(config, generation) {
            return 0.0;
        }
        let drop = item.item.drop_weight.unwrap_or(0.0).max(0.0);
        match self {
            Self::Held => drop,
            Self::Lottery => item
                .item
                .lottery_weight
                .filter(|weight| weight.is_finite() && *weight >= 0.0)
                .unwrap_or(drop),
        }
    }

    /// La part des tirages qui donnent un objet : le réglage vaut pour les objets de 1ʳᵉ génération,
    /// et ceux d'une génération ouverte ensuite s'ajoutent par-dessus sans rien retirer aux autres
    /// (chaque objet garde sa chance d'avant, les nouveaux prennent sur « rien »). Plafonnée à 1.
    pub fn chance(self, config: &Pokemon, generation: u8) -> f64 {
        let setting = match self {
            Self::Held => config.spawn.held_item_chance,
            Self::Lottery => config.lottery.win_chance,
        }
        .clamp(0.0, 1.0);
        let weights: Vec<(u8, f64)> = all(config)
            .map(|item| {
                (
                    item.generation(config),
                    self.weight(&item, config, generation),
                )
            })
            .collect();
        let base: f64 = weights
            .iter()
            .filter(|(g, _)| *g <= 1)
            .map(|(_, w)| w)
            .sum();
        if base <= 0.0 {
            return setting;
        }
        let total: f64 = weights.iter().map(|(_, w)| w).sum();
        (setting * total / base).min(1.0)
    }

    /// L'objet à la position `roll` (dans [0, 1)) de la table : un cumul, et le dernier en filet si
    /// l'arrondi passe juste au-dessus du total. `None` pour une table vide.
    pub fn pick_at<'a>(
        self,
        config: &'a Pokemon,
        generation: u8,
        roll: f64,
    ) -> Option<CatalogueItem<'a>> {
        let pool: Vec<(CatalogueItem<'a>, f64)> = all(config)
            .map(|item| (item, self.weight(&item, config, generation)))
            .filter(|(_, weight)| *weight > 0.0)
            .collect();
        let total: f64 = pool.iter().map(|(_, weight)| weight).sum();
        let target = roll * total;
        let mut cumulative = 0.0;
        for (item, weight) in &pool {
            cumulative += weight;
            if target < cumulative {
                return Some(*item);
            }
        }
        pool.last().map(|(item, _)| *item)
    }
}

/// Ce que tient un Pokémon qui vient d'apparaître, ou rien. Tiré à l'apparition et figé : ce qu'il
/// porte lui appartient, ça ne se décide pas au moment où quelqu'un l'attrape.
pub fn roll_held_item<'a>(
    config: &'a Pokemon,
    generation: u8,
    rng: &mut (impl Rng + ?Sized),
) -> Option<CatalogueItem<'a>> {
    let chance = Table::Held.chance(config, generation);
    if chance <= 0.0 || rng.random::<f64>() >= chance {
        return None;
    }
    Table::Held.pick_at(config, generation, rng.random())
}

#[cfg(test)]
#[allow(clippy::float_cmp)] // Des réglages relus tels quels : l'égalité stricte est voulue.
mod tests {
    use super::*;

    fn no_drops() -> crate::config::Items {
        let mut items = crate::config::Items::default();
        for item in [
            &mut items.ball_poke,
            &mut items.ball_super,
            &mut items.super_bonbon,
            &mut items.ball_hyper,
            &mut items.evolyte,
            &mut items.pierre_soleil,
            &mut items.roche_royale,
            &mut items.catalyseur,
            &mut items.pepite,
            &mut items.ticket_safari,
            &mut items.super_canne,
            &mut items.mega_canne,
        ] {
            item.drop_weight = None;
        }
        items
    }

    fn close(actual: f64, expected: f64) {
        assert!((actual - expected).abs() < 1e-9, "{actual} ≠ {expected}");
    }

    #[test]
    fn a_ball_item_borrows_its_ball_label_and_icon() {
        let config = Pokemon::default();
        let poke = get(&config, "ball_poke").expect("ball_poke");
        assert_eq!(poke.label, "Poké Ball");
        assert_eq!(poke.emoji, config.capture.balls.poke.emoji);
        assert_eq!(poke.sprite, Some("poke-ball"));
        assert_eq!(
            ball_item(&config, "master").map(|item| item.key),
            Some("ball_master")
        );
        assert!(get(&config, "constructor").is_none());
    }

    #[test]
    fn the_master_ball_is_capped_at_one_and_its_surplus_is_worth_10_000_points() {
        let config = Pokemon::default();
        let master = get(&config, "ball_master").expect("ball_master");
        assert_eq!((master.cap(), master.overflow_value()), (Some(1), 10_000));
        // Une limite sans prix de revente ne joue pas : rien ne se détruit contre zéro.
        let mut free = config.clone();
        free.items.ball_master.overflow_value = Some(0);
        assert_eq!(get(&free, "ball_master").and_then(|item| item.cap()), None);
    }

    #[test]
    fn charms_and_the_base_rod_do_not_trade() {
        let config = Pokemon::default();
        let tradable = |key| get(&config, key).is_some_and(|item| item.is_tradable());
        assert!(!tradable("charme_chroma_1"));
        assert!(!tradable("canne"));
        assert!(tradable("super_canne"));
        assert!(tradable("ball_master"));
        assert_eq!(
            charm_item(&config, 2).map(|item| item.key),
            Some("charme_chroma_2")
        );
        assert_eq!(
            charm_item(&config, 1).map(|item| item.key),
            Some("charme_chroma_1")
        );
        assert!(charm_item(&config, 3).is_none());
    }

    #[test]
    fn generation_2_items_open_with_their_generation() {
        let config = Pokemon::default();
        for key in ["pierre_soleil", "roche_royale", "catalyseur"] {
            let item = get(&config, key).expect(key);
            assert!(Table::Held.weight(&item, &config, 2) > 0.0, "{key}: held");
            assert!(
                Table::Lottery.weight(&item, &config, 2) > 0.0,
                "{key}: lottery"
            );
            assert_eq!(Table::Held.weight(&item, &config, 1), 0.0, "{key}: closed");
        }
        // Une canne s'ouvre avec la pêche.
        let rod = get(&config, "super_canne").expect("super_canne");
        assert_eq!(rod.generation(&config), config.fishing.generation);
        // Le poids de loterie retombe sur celui du butin quand le catalogue n'en dit rien.
        let candy = get(&config, "super_bonbon").expect("super_bonbon");
        assert_eq!(Table::Lottery.weight(&candy, &config, 1), 120.0);
    }

    #[test]
    fn opening_a_generation_takes_nothing_from_the_items_already_there() {
        let config = Pokemon::default();
        for table in [Table::Held, Table::Lottery] {
            let shares = |generation| {
                let total: f64 = all(&config)
                    .map(|item| table.weight(&item, &config, generation))
                    .sum();
                let chance = table.chance(&config, generation);
                all(&config)
                    .map(|item| chance * table.weight(&item, &config, generation) / total)
                    .collect::<Vec<_>>()
            };
            let (before, after) = (shares(1), shares(2));
            for (old, new) in before.iter().zip(&after) {
                if *old > 0.0 {
                    close(*new, *old);
                }
            }
            assert!(
                table.chance(&config, 2) > table.chance(&config, 1),
                "{table:?}"
            );
        }
        close(
            Table::Held.chance(&config, 1),
            config.spawn.held_item_chance,
        );
        close(Table::Lottery.chance(&config, 1), config.lottery.win_chance);
    }

    #[test]
    fn the_ends_of_a_draw_are_the_first_and_last_items_of_the_table() {
        let config = Pokemon::default();
        let pick = |roll| Table::Held.pick_at(&config, 2, roll).map(|item| item.key);
        assert_eq!(pick(0.0), Some("ball_poke"));
        assert_eq!(pick(0.999_999_9), Some("mega_canne"));
        // Une table sans poids ne donne rien plutôt que de planter.
        let empty = Pokemon {
            items: no_drops(),
            ..config.clone()
        };
        assert!(Table::Held.pick_at(&empty, 2, 0.5).is_none());
    }

    #[test]
    fn a_lot_falls_back_on_something_playable() {
        let config = Pokemon::default();
        assert_eq!(get(&config, "ball_poke").expect("item").lot(), (1, 5));
        assert_eq!(get(&config, "pepite").expect("item").lot(), (1, 1));
        let mut odd = config.clone();
        odd.items.ball_poke.lot = Some(crate::config::Range { min: 4, max: 2 });
        assert_eq!(get(&odd, "ball_poke").expect("item").lot(), (4, 4));
    }
}
