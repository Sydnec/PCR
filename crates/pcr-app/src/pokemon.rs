//! Le jeu Pokémon côté cas d'usage : ce que Discord et le site lisent du jeu en cours.

use pcr_core::pokemon::{
    generation,
    tables::{self, WeightTable},
    weights::Draw,
};

use crate::App;

/// La génération jouable maintenant : relue à chaque action, la 2ᵉ s'ouvre d'elle-même à son heure.
pub fn generation(app: &App) -> u8 {
    generation::active(&app.game_config().pokemon, app.clock.now())
}

/// Les tables de tirage de `/admin poids`, calculées par les fonctions des tirages, sur la
/// configuration et la génération du moment.
pub fn weight_tables(app: &App) -> [WeightTable; 4] {
    let config = app.game_config();
    let draw = Draw::new(&config.pokemon, generation(app));
    tables::all(&draw)
}
