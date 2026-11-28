//! L'objet que tenait un Pokémon capturé : il suit son vainqueur dans son sac (sous la limite de
//! détention), ou, de temps en temps, il le lâche au sol, et c'est une seconde course ouverte aux
//! autres. Une pêche n'a pas de salon où le poser : il suit le Pokémon. Sans salon configuré non
//! plus : il n'est pas tombé, il revient au capteur.

use pcr_core::{
    config::GameConfig,
    pokemon::{
        bag::{self, Overflow},
        drop, items as catalogue,
        throw::Held,
    },
};
use pcr_db::{Conn, DbError, pokemon::spawn::Spawn};
use rand::{Rng, RngExt as _};

use super::super::{drops, items, spawn};
use crate::App;

pub(super) async fn hand_over(
    conn: &mut Conn,
    app: &App,
    config: &GameConfig,
    spawn: &Spawn,
    user: i64,
    now_ms: i64,
    rng: &mut (impl Rng + ?Sized),
) -> Result<Option<Held>, DbError> {
    let Some(item) = spawn
        .held_item
        .as_deref()
        .and_then(|key| catalogue::get(&config.pokemon, key))
    else {
        return Ok(None);
    };
    let channel = spawn::channel(app).filter(|_| !spawn.fished);
    if let Some(channel) = channel
        && drop::leaves_item_behind(&config.pokemon.spawn, rng.random())
    {
        drops::place(conn, spawn, item.key, channel, now_ms).await?;
        return Ok(Some(Held {
            emoji: item.emoji.to_owned(),
            label: item.label.to_owned(),
            dropped: true,
            notice: None,
        }));
    }
    let source = format!("capture:{}", spawn.id);
    let granted = items::grant(
        conn,
        &config.pokemon,
        user,
        item.key,
        1,
        Overflow::Sell,
        &source,
        now_ms,
    )
    .await?;
    Ok(Some(Held {
        emoji: item.emoji.to_owned(),
        label: item.label.to_owned(),
        dropped: false,
        notice: granted.and_then(|granted| bag::overflow_notice(&config.pokemon, &item, &granted)),
    }))
}
