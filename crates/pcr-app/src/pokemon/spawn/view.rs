//! Ce que le message public d'une apparition montre, lu au moment de l'écrire : le journal des
//! derniers lancers tant qu'elle est là, ses participants et ce qu'elle a coûté une fois terminée.

use pcr_core::pokemon::{
    rarity::Rarity,
    species::{self, Species},
};
use pcr_db::{
    DbError,
    pokemon::spawn::{self as spawns, Spawn, Spent, Throw},
};

use crate::App;

/// Une apparition et ce que son message en dit.
#[derive(Debug, Clone, PartialEq)]
pub struct View {
    pub spawn: Spawn,
    pub species: &'static Species,
    pub rarity: Rarity,
    /// Les derniers lancers, du plus ancien au plus récent (tant qu'elle est là).
    pub recent: Vec<Throw>,
    /// Qui a lancé quoi (une fois terminée).
    pub spending: Spending,
    /// Elle a lâché son objet en partant, au lieu de le céder ou de l'emporter.
    pub dropped: bool,
}

/// Les points brûlés sur une apparition, et ses participants.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Spending {
    /// Les ratés seulement : c'est la mesure du puits.
    pub burned: i64,
    /// Le plus investi d'abord : c'est ce que les médailles promettent. À lancers égaux, celui qui y a
    /// laissé le plus de points passe devant (une salve d'Hyper Balls n'est pas une salve de Poké
    /// Balls).
    pub participants: Vec<Participant>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Participant {
    pub user_id: i64,
    pub throws: i64,
    pub burned: i64,
    /// Ses balls (clé, nombre), dans l'ordre où la base les rend.
    pub balls: Vec<(String, i64)>,
}

impl Spending {
    pub fn from_spent(spent: &[Spent]) -> Self {
        let mut participants: Vec<Participant> = Vec::new();
        for row in spent {
            let index =
                if let Some(index) = participants.iter().position(|p| p.user_id == row.user_id) {
                    index
                } else {
                    participants.push(Participant {
                        user_id: row.user_id,
                        throws: 0,
                        burned: 0,
                        balls: Vec::new(),
                    });
                    participants.len() - 1
                };
            let entry = &mut participants[index];
            entry.throws += row.throws;
            entry.burned += row.burned;
            entry.balls.push((row.ball.clone(), row.throws));
        }
        participants.sort_by(|a, b| b.throws.cmp(&a.throws).then(b.burned.cmp(&a.burned)));
        Self {
            burned: participants.iter().map(|p| p.burned).sum(),
            participants,
        }
    }
}

/// L'apparition `id` telle que son message doit la montrer ; `None` si elle n'existe pas, ou que son
/// espèce a disparu des données.
pub async fn view(app: &App, id: i64) -> Result<Option<View>, DbError> {
    let mut conn = app.db.reader().acquire().await?;
    let Some(spawn) = spawns::get(&mut conn, id).await? else {
        return Ok(None);
    };
    let Some(species) = u16::try_from(spawn.species_id).ok().and_then(species::get) else {
        return Ok(None);
    };
    let config = app.game_config();
    let rarity = Rarity::from_key(&spawn.rarity)
        .unwrap_or_else(|| pcr_core::pokemon::rarity::rarity_of(species, &config.pokemon));
    let (recent, spending, dropped) = if spawn.status.is_ended() {
        let spent = spawns::spending(&mut conn, id).await?;
        (
            Vec::new(),
            Spending::from_spent(&spent),
            spawn.held_item.is_some() && spawns::dropped(&mut conn, id).await?,
        )
    } else {
        let limit = i64::from(config.pokemon.spawn.throw_log_size);
        (
            spawns::recent_throws(&mut conn, id, limit).await?,
            Spending::default(),
            false,
        )
    };
    Ok(Some(View {
        spawn,
        species,
        rarity,
        recent,
        spending,
        dropped,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spent(user: i64, ball: &str, throws: i64, burned: i64) -> Spent {
        Spent {
            user_id: user,
            ball: ball.to_owned(),
            throws,
            cost: burned,
            burned,
        }
    }

    /// `test/spawn-lifecycle.test.js` : les lancers de chacun, les points brûlés sur les seuls ratés.
    #[test]
    fn the_most_invested_comes_first() {
        // a : 2 Poké Balls ratées et une Super Ball qui attrape ; b : une Hyper Ball ratée.
        let spending = Spending::from_spent(&[
            spent(1, "poke", 2, 200),
            spent(1, "super", 1, 0),
            spent(2, "hyper", 1, 400),
        ]);
        assert_eq!(spending.burned, 600);
        let order: Vec<_> = spending
            .participants
            .iter()
            .map(|p| (p.user_id, p.throws, p.burned))
            .collect();
        assert_eq!(order, [(1, 3, 200), (2, 1, 400)]);
        assert_eq!(
            spending.participants[0].balls,
            [("poke".to_owned(), 2), ("super".to_owned(), 1)]
        );
        // À lancers égaux, le plus dépensier d'abord.
        let tie = Spending::from_spent(&[spent(1, "poke", 1, 100), spent(2, "hyper", 1, 400)]);
        assert_eq!(tie.participants[0].user_id, 2);
    }
}
