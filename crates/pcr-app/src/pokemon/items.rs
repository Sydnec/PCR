//! Les objets des dresseurs, côté lecture : les balls en poche, que `/solde` et la fiche d'une
//! apparition montrent (une ball en poche se lance sans toucher au solde).

use pcr_core::{config::Pokemon, pokemon::items};
use pcr_db::{DbError, pokemon::items as inventory};

use crate::App;

/// Une ball en poche, prête à afficher.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BallStock {
    pub key: &'static str,
    pub label: String,
    pub emoji: String,
    pub count: i64,
}

/// Les balls que `user` a en poche, dans l'ordre du catalogue. Est une ball tout objet adossé à une
/// ball (`ball: "poke"`), quelle que soit sa clé : c'est le catalogue qui décide.
pub async fn ball_stock(app: &App, user: i64) -> Result<Vec<BallStock>, DbError> {
    let mut conn = app.db.reader().acquire().await?;
    let rows = inventory::inventory(&mut conn, user).await?;
    Ok(balls_in(&app.game_config().pokemon, &rows))
}

fn balls_in(config: &Pokemon, rows: &[(String, i64)]) -> Vec<BallStock> {
    items::all(config)
        .filter(|item| item.item.ball.is_some())
        .filter_map(|item| {
            let count = rows
                .iter()
                .find_map(|(key, count)| (key == item.key).then_some(*count))?;
            Some(BallStock {
                key: item.key,
                label: item.label.to_owned(),
                emoji: item.emoji.to_owned(),
                count,
            })
        })
        .collect()
}
