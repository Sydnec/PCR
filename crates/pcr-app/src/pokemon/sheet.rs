//! La fiche d'une espèce : ce qu'elle est, ce qu'elle coûte à attraper, et où en est le dresseur dans
//! sa lignée. Elle sert le bouton « Infos » des apparitions (suivie du solde et des balls en poche),
//! et servira `/pokedex <espèce>` : « je l'ai déjà ? » n'est qu'un cas de « parle-moi de ce Pokémon ».
//!
//! Une lecture ratée de la collection omet ce qu'elle devait dire, plutôt que d'annoncer zéro.

use std::collections::BTreeMap;

use pcr_core::pokemon::{
    lineage,
    rarity::{Rarity, rarity_of},
    spawn as rules,
    species::{self, Sex, Species},
    weights::{Draw, Obtention},
};
use pcr_db::{
    Conn, DbError, points,
    pokemon::{
        collection::{self, Owned},
        spawn as spawns,
    },
};

use super::items::BallStock;
use crate::{App, error::UseCaseError};

/// Un maillon de la lignée.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Link {
    pub species: &'static Species,
    /// Comment on l'obtient (🔒, 🥚).
    pub obtention: Obtention,
}

/// La fiche d'une espèce, lue pour un dresseur.
#[derive(Debug, Clone, PartialEq)]
pub struct Sheet {
    pub species: &'static Species,
    pub rarity: Rarity,
    /// Devant une apparition shiny, « je l'ai » veut dire « je l'ai en shiny ».
    pub shiny: bool,
    /// Celui de l'apparition, figé à sa naissance : la fiche annonce le même chiffre que l'annonce.
    pub catch_rate: u32,
    /// La forme de l'individu d'où vient le clic (la lettre du Zarbi apparu).
    pub form: Option<String>,
    pub generation: u8,
    pub chain: Vec<Link>,
    /// Les exemplaires de chaque maillon ; `None` sur une lecture ratée.
    pub owned: Option<BTreeMap<u16, Owned>>,
    /// Les sexes qu'il en a ; `None` pour une espèce asexuée ou une lecture ratée.
    pub sexes: Option<Vec<Sex>>,
    /// Les formes qu'il en a ; `None` pour une espèce sans formes ou une lecture ratée.
    pub forms: Option<Vec<String>>,
}

/// Le bouton « Infos » d'une apparition : la fiche, le solde et les balls en poche, chacun omis si
/// sa lecture échoue.
#[derive(Debug, Clone, PartialEq)]
pub struct SpawnInfo {
    pub sheet: Sheet,
    pub balance: Option<i64>,
    pub balls: Option<Vec<BallStock>>,
}

/// La fiche de l'espèce de l'apparition `spawn`, pour `user`.
pub async fn for_spawn(app: &App, user: i64, spawn: i64) -> Result<SpawnInfo, UseCaseError> {
    let mut conn = app.db.reader().acquire().await.map_err(DbError::from)?;
    let found = spawns::get(&mut conn, spawn)
        .await?
        .ok_or_else(|| UseCaseError::refused(rules::GONE))?;
    let species = u16::try_from(found.species_id)
        .ok()
        .and_then(species::get)
        .ok_or_else(|| UseCaseError::refused(rules::UNKNOWN_SPECIES))?;
    let catch_rate = u32::try_from(found.catch_rate).unwrap_or_default();
    let sheet = read(
        app,
        &mut conn,
        user,
        species,
        found.is_shiny,
        catch_rate,
        found.form,
    )
    .await;
    let balance = points::balance_in(&mut conn, user)
        .await
        .inspect_err(|error| tracing::warn!(?error, "reading a balance for a sheet failed"))
        .ok();
    drop(conn);
    let balls = super::items::ball_stock(app, user)
        .await
        .inspect_err(|error| tracing::warn!(?error, "reading balls for a sheet failed"))
        .ok();
    Ok(SpawnInfo {
        sheet,
        balance,
        balls,
    })
}

/// Lit la fiche : chaque lecture de la collection qui échoue laisse sa partie vide.
async fn read(
    app: &App,
    conn: &mut Conn,
    user: i64,
    species: &'static Species,
    shiny: bool,
    catch_rate: u32,
    form: Option<String>,
) -> Sheet {
    let config = app.game_config();
    let generation = super::generation(app);
    let draw = Draw::new(&config.pokemon, generation);
    let chain: Vec<Link> = lineage::chain(species, generation)
        .into_iter()
        .map(|link| Link {
            species: link,
            obtention: draw.obtention(link),
        })
        .collect();
    let ids: Vec<i64> = chain
        .iter()
        .map(|link| i64::from(link.species.id))
        .collect();
    let owned = collection::owned(conn, user, &ids)
        .await
        .map(|rows| {
            rows.into_iter()
                .filter_map(|(id, owned)| Some((u16::try_from(id).ok()?, owned)))
                .collect()
        })
        .inspect_err(|error| tracing::warn!(?error, "reading a lineage for a sheet failed"))
        .ok();
    let id = i64::from(species.id);
    let sexes = if species.possible_sexes().is_empty() {
        None
    } else {
        collection::sexes(conn, user, id)
            .await
            .map(|codes| {
                codes
                    .iter()
                    .filter_map(|code| Sex::from_code(code))
                    .collect()
            })
            .inspect_err(|error| tracing::warn!(?error, "reading sexes for a sheet failed"))
            .ok()
    };
    let forms = if species.forms_in(generation).next().is_none() {
        None
    } else {
        collection::forms(conn, user, id)
            .await
            .inspect_err(|error| tracing::warn!(?error, "reading forms for a sheet failed"))
            .ok()
    };
    Sheet {
        species,
        rarity: rarity_of(species, &config.pokemon),
        shiny,
        catch_rate,
        form,
        generation,
        chain,
        owned,
        sexes,
        forms,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::TestApp;

    const ASH: i64 = 1;

    #[tokio::test]
    async fn the_sheet_tells_what_the_trainer_has_of_the_lineage() {
        let t = TestApp::new("sheet-spawn", "2026-11-27T12:00:00Z").await;
        assert_eq!(
            match for_spawn(&t.app, ASH, 42).await {
                Err(UseCaseError::Refused(refusal)) => refusal.text().to_owned(),
                other => panic!("expected a refusal, got {other:?}"),
            },
            rules::GONE
        );
        // Un Pikachu femelle shiny apparaît ; le dresseur a un Pichu, deux Raichu dont un shiny, et
        // trois Super Balls et une Pépite en poche.
        t.sql(
            "INSERT INTO pokemon_spawns (id, species_id, is_shiny, catch_rate, rarity, sex, status, spawned_at)
             VALUES (7, 25, 1, 190, 'PEU_COMMUN', 'F', 'ACTIVE', 1);
             INSERT INTO pokemon_owned (user_id, species_id, is_shiny, sex, origin, obtained_at) VALUES
               (1, 172, 0, 'M', 'capture', 1), (1, 26, 0, 'M', 'capture', 1), (1, 26, 1, 'F', 'capture', 1);
             INSERT INTO pokemon_inventory (user_id, item_key, count) VALUES
               (1, 'pepite', 1), (1, 'ball_super', 3), (1, 'ball_poke', 0);",
        )
        .await;
        let info = for_spawn(&t.app, ASH, 7).await.expect("sheet");
        let sheet = &info.sheet;
        assert_eq!(
            (sheet.species.id, sheet.shiny, sheet.catch_rate),
            (25, true, 190)
        );
        let chain: Vec<u16> = sheet.chain.iter().map(|link| link.species.id).collect();
        assert_eq!(chain, [172, 25, 26]);
        let owned = sheet.owned.as_ref().expect("read");
        assert_eq!(
            owned.get(&26),
            Some(&Owned {
                normal: 1,
                shiny: 1
            })
        );
        assert_eq!(owned.get(&25), None);
        assert_eq!(sheet.sexes.as_deref(), Some(&[][..]), "aucun Pikachu");
        assert_eq!(sheet.forms, None, "Pikachu n'a pas de formes");
        assert_eq!(info.balance, Some(0));
        let balls: Vec<_> = info
            .balls
            .expect("read")
            .into_iter()
            .map(|ball| (ball.key, ball.count))
            .collect();
        assert_eq!(
            balls,
            [("ball_super", 3)],
            "les balls seulement, épuisées exclues"
        );
        t.close().await;
    }
}
