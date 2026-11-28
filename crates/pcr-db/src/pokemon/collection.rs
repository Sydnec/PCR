//! La collection des dresseurs (`pokemon_owned`) : ce qu'une fiche ou un Pokédex en lit, et la
//! naissance d'un individu dans une boîte.

use sqlx::SqliteConnection;

use crate::DbError;

/// Les exemplaires d'une espèce : normaux et shiny.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Owned {
    pub normal: i64,
    pub shiny: i64,
}

/// Les exemplaires que `user` possède de chacune de ces espèces (celles qu'il n'a pas manquent).
/// La liste passe en JSON : `query!` ne sait pas lier un `IN` variable.
pub async fn owned(
    conn: &mut SqliteConnection,
    user: i64,
    species: &[i64],
) -> Result<Vec<(i64, Owned)>, DbError> {
    let ids = serde_json::to_string(species).unwrap_or_else(|_| "[]".to_owned());
    let rows = sqlx::query!(
        r#"SELECT species_id,
                  SUM(is_shiny = 0) AS "normal!: i64",
                  SUM(is_shiny = 1) AS "shiny!: i64"
             FROM pokemon_owned
            WHERE user_id = ? AND species_id IN (SELECT value FROM json_each(?))
            GROUP BY species_id
            ORDER BY species_id"#,
        user,
        ids
    )
    .fetch_all(conn)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| {
            (
                row.species_id,
                Owned {
                    normal: row.normal,
                    shiny: row.shiny,
                },
            )
        })
        .collect())
}

/// Les sexes (`M`, `F`) que `user` a d'une espèce, shiny ou non.
pub async fn sexes(
    conn: &mut SqliteConnection,
    user: i64,
    species: i64,
) -> Result<Vec<String>, DbError> {
    Ok(sqlx::query_scalar!(
        r#"SELECT DISTINCT sex AS "sex!: String" FROM pokemon_owned
            WHERE user_id = ? AND species_id = ? AND sex IS NOT NULL ORDER BY sex"#,
        user,
        species
    )
    .fetch_all(conn)
    .await?)
}

/// Les formes (lettres de Zarbi) que `user` a d'une espèce, shiny ou non.
pub async fn forms(
    conn: &mut SqliteConnection,
    user: i64,
    species: i64,
) -> Result<Vec<String>, DbError> {
    Ok(sqlx::query_scalar!(
        r#"SELECT DISTINCT form AS "form!: String" FROM pokemon_owned
            WHERE user_id = ? AND species_id = ? AND form IS NOT NULL ORDER BY form"#,
        user,
        species
    )
    .fetch_all(conn)
    .await?)
}

/// Un individu qui rejoint une boîte.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewOwned<'a> {
    pub user: i64,
    pub species: i64,
    pub shiny: bool,
    pub sex: Option<&'a str>,
    pub form: Option<&'a str>,
    /// La ball de capture, gardée pour de bon.
    pub ball: Option<&'a str>,
    pub origin: &'a str,
    pub locked: bool,
    pub obtained_at: i64,
}

pub async fn insert(conn: &mut SqliteConnection, owned: &NewOwned<'_>) -> Result<i64, DbError> {
    let shiny = i64::from(owned.shiny);
    let locked = i64::from(owned.locked);
    Ok(sqlx::query_scalar!(
        "INSERT INTO pokemon_owned
                (user_id, species_id, is_shiny, sex, form, ball, origin, locked, obtained_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
        owned.user,
        owned.species,
        shiny,
        owned.sex,
        owned.form,
        owned.ball,
        owned.origin,
        locked,
        owned.obtained_at
    )
    .fetch_one(conn)
    .await?)
}

/// Les espèces que `user` possède, au moins un exemplaire chacune.
pub async fn species(conn: &mut SqliteConnection, user: i64) -> Result<Vec<i64>, DbError> {
    Ok(sqlx::query_scalar!(
        "SELECT DISTINCT species_id FROM pokemon_owned WHERE user_id = ? ORDER BY species_id",
        user
    )
    .fetch_all(conn)
    .await?)
}
