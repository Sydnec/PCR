//! Ce qu'une fiche ou un Pokédex lit de la collection d'un dresseur (`pokemon_owned`).

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
