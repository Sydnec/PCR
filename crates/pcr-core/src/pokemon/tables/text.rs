//! Le rendu d'une table en texte : la phrase d'introduction, puis l'en-tête et les lignes alignés
//! pour un bloc de code (chasse fixe : le seul moyen d'aligner des colonnes sur Discord).

use std::fmt::Write as _;

use super::{Row, WeightTable};
use crate::format;

/// Un nombre d'une cellule : le séparateur des milliers, l'espace fine insécable, ne vaut pas une
/// cellule en chasse fixe ; une espace ordinaire, si.
fn cell(value: f64) -> String {
    format::decimal(value).replace('\u{202f}', " ")
}

/// « Une chance sur N », qui se lit mieux qu'un pourcentage à trois décimales quand l'événement est
/// rare, et seulement là : au-dessus d'une chance sur deux, l'arrondi écrirait « 1/1 », qui est faux.
pub(super) fn one_in(probability: f64) -> String {
    if probability > 0.0 && probability <= 0.5 {
        format!("1/{}", cell((1.0 / probability).round()))
    } else {
        "—".to_owned()
    }
}

impl WeightTable {
    /// La phrase sous le titre : la note, la porte, et les objets hors tirage (un charme, un objet
    /// d'une génération fermée), nommés plutôt que listés. Une catégorie d'espèces à poids nul reste
    /// dans le tableau, marquée « hors pool » : elle dit combien d'espèces ne sortent jamais.
    pub fn intro(&self) -> String {
        let gate = self.gate.map_or(String::new(), |gate| {
            format!(" — **{}** {}", format::percent(gate.chance, 0), gate.label)
        });
        let mut intro = format!("*{}*{gate}", self.note);
        if !self.has_groups() {
            let outside: Vec<&str> = self
                .rows
                .iter()
                .filter(|r| r.weight <= 0.0)
                .map(|r| r.label.as_str())
                .collect();
            if !outside.is_empty() {
                let _ = write!(intro, "\nHors tirage : {}.", outside.join(", "));
            }
        }
        intro
    }

    /// Des groupes d'espèces, ou des objets un par un.
    fn has_groups(&self) -> bool {
        self.rows.iter().any(|r| r.count > 1)
    }

    /// L'en-tête et les lignes du tableau (total compris), alignés pour un bloc de code : la
    /// première colonne à gauche, les chiffres à droite. Un emoji serveur ne s'affiche pas dans un
    /// bloc de code, d'où des libellés en toutes lettres.
    pub fn lines(&self) -> (String, Vec<String>) {
        let groups = self.has_groups();
        let head: Vec<String> = if groups {
            let head = [self.subject, "espèces", "poids", "total", "part"];
            head.into_iter()
                .chain(["par espèce"])
                .map(str::to_owned)
                .collect()
        } else {
            let lot = self.lots.then_some("lot");
            [self.subject, "poids"]
                .into_iter()
                .chain(lot)
                .chain(["part", "au tirage", "soit"])
                .map(str::to_owned)
                .collect()
        };
        let rows = self
            .rows
            .iter()
            .filter(|r| groups || r.weight > 0.0)
            .map(|r| self.cells(r, groups));
        let table: Vec<Vec<String>> = std::iter::once(head)
            .chain(rows)
            .chain([self.total_cells(groups)])
            .collect();
        let mut lines = align(&table);
        let head = lines.remove(0);
        (head, lines)
    }

    /// Les cellules d'une ligne : un groupe d'espèces (sa part, et celle d'une espèce), ou un objet
    /// (sa part dans la table, puis au tirage une fois la porte passée).
    fn cells(&self, r: &Row, groups: bool) -> Vec<String> {
        if groups {
            let drawn = r.weight > 0.0;
            let share = if drawn {
                format::percent(r.share, 1)
            } else {
                "hors pool".to_owned()
            };
            let unit = if drawn {
                format::percent(r.unit_share, 2)
            } else {
                "—".to_owned()
            };
            return vec![
                r.label.clone(),
                cell(f64::from(r.count)),
                cell(r.weight),
                cell(r.total),
                share,
                unit,
            ];
        }
        let gate = self.gate.map_or(1.0, |gate| gate.chance);
        let mut line = vec![r.label.clone(), cell(r.weight)];
        if self.lots {
            line.push(r.lot.clone().unwrap_or_else(|| "1".to_owned()));
        }
        line.extend([
            format::percent(r.share, 1),
            format::percent(gate * r.share, 3),
            one_in(gate * r.share),
        ]);
        line
    }

    fn total_cells(&self, groups: bool) -> Vec<String> {
        if groups {
            let count: u32 = self.rows.iter().map(|r| r.count).sum();
            return vec![
                "TOTAL".to_owned(),
                cell(f64::from(count)),
                String::new(),
                cell(self.total),
                "100 %".to_owned(),
                String::new(),
            ];
        }
        let gate = self.gate.map_or(1.0, |gate| gate.chance);
        let mut line = vec!["TOTAL".to_owned(), cell(self.total)];
        if self.lots {
            line.push(String::new());
        }
        line.extend(["100 %".to_owned(), format::percent(gate, 3), one_in(gate)]);
        line
    }
}

/// Aligne les cellules en colonnes, largeur déduite du contenu : la première à gauche, les
/// chiffres à droite, comme dans n'importe quel tableau de chiffres.
fn align(table: &[Vec<String>]) -> Vec<String> {
    let columns = table.first().map_or(0, Vec::len);
    let widths: Vec<usize> = (0..columns)
        .map(|i| {
            table
                .iter()
                .map(|line| line[i].chars().count())
                .max()
                .unwrap_or(0)
        })
        .collect();
    table
        .iter()
        .map(|line| {
            let cells: Vec<String> = line
                .iter()
                .zip(&widths)
                .enumerate()
                .map(|(i, (cell, width))| {
                    if i == 0 {
                        format!("{cell:<width$}")
                    } else {
                        format!("{cell:>width$}")
                    }
                })
                .collect();
            cells.join("  ").trim_end().to_owned()
        })
        .collect()
}
