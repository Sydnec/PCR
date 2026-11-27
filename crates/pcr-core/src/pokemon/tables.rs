//! Les tirages pondérés du jeu, convertis en probabilités (`/admin poids`). Un poids n'est pas un
//! pourcentage mais une part d'un total qui bouge dès qu'on ajoute une ligne : personne ne règle à
//! l'aveugle ce qu'il ne sait pas convertir.
//!
//! Règle absolue : ce module ne recalcule JAMAIS un poids à sa façon. Il appelle les fonctions des
//! tirages (`Draw::weight`, `items::Table`) sur les mêmes données : une table qui divergerait de ce
//! qu'elle décrit ferait régler le jeu à côté.

use super::{
    generation::ordinal,
    items::{self, Table},
    rarity::is_starter_line,
    species,
    weights::{Draw, Pool},
};
use crate::format;

/// Un groupe de tirages qui partagent le même poids : un objet (`count` 1), ou des espèces.
#[derive(Debug, Clone, PartialEq)]
pub struct Row {
    pub label: String,
    pub count: u32,
    pub weight: f64,
    pub total: f64,
    /// La part du tirage, et celle d'UN membre du groupe : « les stades 1 font 79 % » et « ce
    /// Roucool-là fait 1 % » ne répondent pas à la même question, et les deux se posent en réglant.
    pub share: f64,
    pub unit_share: f64,
    /// La fourchette d'un lot de loterie (« 1-5 »).
    pub lot: Option<String>,
}

/// La porte d'entrée d'un tirage : le butin ne se tire que si le Pokémon tient quelque chose, alors
/// qu'une apparition tire toujours une espèce.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Gate {
    pub label: &'static str,
    pub chance: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct WeightTable {
    /// La valeur de l'option `table` de `/admin poids`.
    pub key: &'static str,
    pub name: &'static str,
    pub note: String,
    /// Ce que compte une ligne : des catégories d'espèces, ou des objets.
    pub subject: &'static str,
    pub gate: Option<Gate>,
    /// Vrai quand les lignes portent une fourchette de quantité : une part de tirage ne dit rien du
    /// volume gagné si un lot va de un à cinq.
    pub lots: bool,
    pub total: f64,
    pub rows: Vec<Row>,
}

fn row(label: String, count: u32, weight: f64) -> Row {
    Row {
        label,
        count,
        weight,
        total: f64::from(count) * weight,
        share: 0.0,
        unit_share: 0.0,
        lot: None,
    }
}

fn table(
    key: &'static str,
    name: &'static str,
    note: String,
    subject: &'static str,
    gate: Option<Gate>,
    rows: Vec<Row>,
) -> WeightTable {
    let mut rows: Vec<Row> = rows.into_iter().filter(|r| r.count > 0).collect();
    let total: f64 = rows.iter().map(|r| r.total).sum();
    for r in &mut rows {
        if total > 0.0 {
            r.share = r.total / total;
            r.unit_share = r.weight / total;
        }
    }
    WeightTable {
        key,
        name,
        note,
        subject,
        gate,
        lots: rows.iter().any(|r| r.lot.is_some()),
        total,
        rows,
    }
}

/// L'ordre des catégories ; une espèce à facteur propre (« Zarbi (×2) ») se range juste avant les
/// légendaires.
const ORDER: [&str; 9] = [
    "Stade 1",
    "Stade 2",
    "Stade 3",
    "Starters, stade 1",
    "Starters, stade 2",
    "Starters, stade 3",
    "Légendaires",
    "Hors pool (échange, objet)",
    "Hors pool (œuf)",
];

fn rank(category: &str) -> f64 {
    let legendary = ORDER.iter().position(|c| *c == "Légendaires").unwrap_or(0);
    #[allow(clippy::cast_precision_loss)] // Neuf catégories.
    ORDER
        .iter()
        .position(|c| *c == category)
        .map_or(legendary as f64 - 0.5, |index| index as f64)
}

/// Les espèces, groupées comme `Draw::weight` les traite : les exclues chacune dans sa ligne (on ne
/// les obtient pas de la même façon), les légendaires, le reste par stade. Un groupe ne réunit que
/// des espèces de même poids : avec la majoration par génération, les stades 1 des deux générations
/// ne pèsent plus pareil, et c'est le poids tiré, jamais un calcul refait ici, qui les sépare.
fn species_rows(draw: &Draw<'_>, pool: Pool<'_>) -> Vec<Row> {
    struct Group {
        category: String,
        weight: f64,
        count: u32,
        generations: Vec<u8>,
    }
    let mut groups: Vec<Group> = Vec::new();
    for entry in species::all(draw.generation) {
        let weight = draw.weight(entry, pool);
        let factor = pool.species_factor(entry);
        let category = if entry.trade_evolution || draw.is_item_only(entry) {
            "Hors pool (échange, objet)".to_owned()
        } else if entry.baby {
            "Hors pool (œuf)".to_owned()
        } else if entry.is_legendary() {
            "Légendaires".to_owned()
        } else if (factor - 1.0).abs() > f64::EPSILON {
            format!("{} (×{})", entry.name, format::decimal(factor))
        } else if is_starter_line(entry, draw.config) {
            format!("Starters, stade {}", entry.stage)
        } else {
            format!("Stade {}", entry.stage)
        };
        let found = groups
            .iter_mut()
            .find(|g| g.category == category && g.weight.to_bits() == weight.to_bits());
        match found {
            Some(group) => {
                group.count += 1;
                if !group.generations.contains(&entry.generation) {
                    group.generations.push(entry.generation);
                }
            }
            None => groups.push(Group {
                category,
                weight,
                count: 1,
                generations: vec![entry.generation],
            }),
        }
    }
    let first = |g: &Group| g.generations.iter().copied().min().unwrap_or(1);
    groups.sort_by(|a, b| {
        rank(&a.category)
            .total_cmp(&rank(&b.category))
            .then(first(a).cmp(&first(b)))
    });
    let split = |category: &str| groups.iter().filter(|g| g.category == category).count() > 1;
    groups
        .iter()
        .map(|g| {
            let label = if split(&g.category) {
                let mut generations = g.generations.clone();
                generations.sort_unstable();
                let list: Vec<String> = generations.into_iter().map(ordinal).collect();
                format!("{} ({} gén.)", g.category, list.join(", "))
            } else {
                g.category.clone()
            };
            row(label, g.count, g.weight)
        })
        .collect()
}

pub fn spawn_pool(draw: &Draw<'_>) -> WeightTable {
    let rows = species_rows(draw, Pool::spawn(draw.config));
    let note = "L'espèce tirée à chaque apparition.".to_owned();
    table(
        "spawn",
        "Apparitions sauvages",
        note,
        "catégorie",
        None,
        rows,
    )
}

pub fn safari_pool(draw: &Draw<'_>) -> WeightTable {
    let rows = species_rows(draw, Pool::safari(draw.config));
    let note = "L'espèce tirée à chaque rencontre, une par action jouée.".to_owned();
    table(
        "safari",
        "Rencontres du parc safari",
        note,
        "catégorie",
        None,
        rows,
    )
}

fn item_rows(draw: &Draw<'_>, kind: Table) -> Vec<Row> {
    items::all(draw.config)
        .map(|item| {
            let mut r = row(
                item.label.to_owned(),
                1,
                kind.weight(&item, draw.config, draw.generation),
            );
            if kind == Table::Lottery {
                let (min, max) = item.lot();
                r.lot = Some(if min == max {
                    min.to_string()
                } else {
                    format!("{min}-{max}")
                });
            }
            r
        })
        .collect()
}

pub fn held_pool(draw: &Draw<'_>) -> WeightTable {
    let gate = Gate {
        label: "en tiennent un",
        chance: Table::Held.chance(draw.config, draw.generation),
    };
    let note = "L'objet que tient un Pokémon, quand il en tient un.".to_owned();
    table(
        "butin",
        "Butin des Pokémon",
        note,
        "objet",
        Some(gate),
        item_rows(draw, Table::Held),
    )
}

/// La loterie a ses propres poids depuis qu'elle donne quelque chose sept fois sur dix ; elle se lit
/// à côté du butin : c'est là, et nulle part ailleurs, qu'on voit que les deux ont divergé.
pub fn lottery_pool(draw: &Draw<'_>) -> WeightTable {
    let gate = Gate {
        label: "des tirages donnent un lot",
        chance: Table::Lottery.chance(draw.config, draw.generation),
    };
    // « N fois moins probable » se lit mieux que 0,5.
    let raw = draw.config.lottery.lot_decay;
    let decay = if raw.is_finite() && raw > 0.0 {
        1.0 / raw
    } else {
        1.0
    };
    let decay = format!("{decay:.1}").replace(".0", "").replace('.', ",");
    let note = format!(
        "Le lot d'un tirage, un par dresseur et par jour. Chaque exemplaire de plus est {decay} fois moins probable."
    );
    let rows = item_rows(draw, Table::Lottery);
    table(
        "loterie",
        "Loterie quotidienne",
        note,
        "objet",
        Some(gate),
        rows,
    )
}

/// Les quatre tables, dans l'ordre de `/admin poids`.
pub fn all(draw: &Draw<'_>) -> [WeightTable; 4] {
    [
        spawn_pool(draw),
        safari_pool(draw),
        held_pool(draw),
        lottery_pool(draw),
    ]
}

#[cfg(test)]
mod tests;
mod text;
