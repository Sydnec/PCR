//! Empreinte du schéma v1 : les tables et colonnes qu'une base doit avoir pour être convertie.
//!
//! La référence est le schéma que crée le code v1 gelé (`v1_points.sql`, `v1_botdata.sql`). Une base
//! qui s'en écarte vient d'une autre version de la v1 : la convertir supposerait des colonnes qui
//! n'existent pas, ou en oublierait. On refuse, avec la liste des écarts, plutôt que de deviner.
//! L'ordre des colonnes n'entre pas en compte : une base de prod, construite par `ALTER TABLE`
//! successifs, ne les range pas comme une base neuve.

use std::collections::{BTreeMap, BTreeSet};

use sqlx::{AssertSqlSafe, Connection as _, SqliteConnection};

use super::MigrateError;

pub(super) const POINTS_DDL: &str = include_str!("v1_points.sql");
pub(super) const BOTDATA_DDL: &str = include_str!("v1_botdata.sql");

/// Tables que la v1 a pu laisser derrière elle et que la conversion ignore : `pokemon_migrations`,
/// supprimée au démarrage par la v1 mais présente dans les vieilles bases.
const TOLERATED: [&str; 1] = ["pokemon_migrations"];

type Shape = BTreeMap<String, BTreeSet<String>>;

/// Vérifie que la base attachée sous `schema` a exactement la forme de `ddl`.
pub(super) async fn check(
    conn: &mut SqliteConnection,
    schema: &str,
    ddl: &'static str,
) -> Result<(), MigrateError> {
    let expected = reference(ddl).await?;
    let found = shape(conn, schema).await?;

    let mut gaps = Vec::new();
    for (table, columns) in &expected {
        match found.get(table) {
            None => gaps.push(format!("missing table {table}")),
            Some(have) => {
                for column in columns.difference(have) {
                    gaps.push(format!("missing column {table}.{column}"));
                }
                for column in have.difference(columns) {
                    gaps.push(format!("unknown column {table}.{column}"));
                }
            }
        }
    }
    for table in found.keys() {
        if !expected.contains_key(table) && !TOLERATED.contains(&table.as_str()) {
            gaps.push(format!("unknown table {table}"));
        }
    }

    if gaps.is_empty() {
        Ok(())
    } else {
        Err(MigrateError::Schema {
            schema: schema.to_owned(),
            gaps,
        })
    }
}

/// La forme du schéma de référence, construite dans une base en mémoire jetable.
async fn reference(ddl: &'static str) -> Result<Shape, MigrateError> {
    let mut conn = SqliteConnection::connect("sqlite::memory:").await?;
    sqlx::raw_sql(ddl).execute(&mut conn).await?;
    let found = shape(&mut conn, "main").await?;
    conn.close().await?;
    Ok(found)
}

async fn shape(conn: &mut SqliteConnection, schema: &str) -> Result<Shape, MigrateError> {
    // Le nom du schéma ne peut pas être un paramètre dans `FROM x.sqlite_master` : il vient du code
    // (« main », « v1 », « v1y »), jamais d'une saisie.
    let sql = format!(
        "SELECT m.name, p.name FROM {schema}.sqlite_master AS m
           JOIN pragma_table_info(m.name, '{schema}') AS p
          WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%'"
    );
    let rows: Vec<(String, String)> = sqlx::query_as(AssertSqlSafe(sql))
        .fetch_all(&mut *conn)
        .await?;
    let mut found = Shape::new();
    for (table, column) in rows {
        found.entry(table).or_default().insert(column);
    }
    Ok(found)
}
