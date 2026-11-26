//! Rapport de conversion : ce qui a été lu, écrit, écarté ou corrigé, table par table, et les
//! contrôles d'invariants. C'est lui qu'on relit avant de mettre une base convertie en service.

use std::fmt;

use sqlx::{AssertSqlSafe, SqliteConnection};

use super::MigrateError;

#[derive(Debug, Default)]
pub struct Report {
    pub tables: Vec<TableReport>,
    pub checks: Vec<Check>,
}

/// Une table v2 remplie depuis une table v1.
#[derive(Debug)]
pub struct TableReport {
    pub table: &'static str,
    pub from: &'static str,
    pub read: i64,
    pub written: i64,
    /// Corrections et lignes écartées, avec leur nombre et leur raison.
    pub notes: Vec<String>,
}

/// Un invariant vérifié entre la v1 et la v2 (`ok = false` : à examiner avant la mise en service).
#[derive(Debug)]
pub struct Check {
    pub name: &'static str,
    pub ok: bool,
    pub detail: String,
}

impl Report {
    /// Copie `from` (v1) dans `table` (v2) par `insert` (un `INSERT … SELECT`) et compte ce qui est
    /// resté en route : toute ligne lue mais non écrite l'a été pour `dropped_why`.
    pub(super) async fn copy(
        &mut self,
        conn: &mut SqliteConnection,
        table: &'static str,
        from: &'static str,
        insert: &str,
        dropped_why: &str,
    ) -> Result<(), MigrateError> {
        let read = scalar(conn, &format!("SELECT count(*) FROM {from}")).await?;
        let written = sqlx::query(AssertSqlSafe(insert.to_owned()))
            .execute(&mut *conn)
            .await
            .map_err(|source| MigrateError::Step { table, source })?
            .rows_affected();
        let written = i64::try_from(written).unwrap_or(i64::MAX);
        let mut notes = Vec::new();
        if read > written {
            notes.push(format!("{} écartée(s) : {dropped_why}", read - written));
        }
        self.tables.push(TableReport {
            table,
            from,
            read,
            written,
            notes,
        });
        Ok(())
    }

    /// Note sur la dernière table copiée le nombre de lignes v1 que `count_sql` compte, si non nul.
    pub(super) async fn fixed(
        &mut self,
        conn: &mut SqliteConnection,
        count_sql: &str,
        what: &str,
    ) -> Result<(), MigrateError> {
        let n = scalar(conn, count_sql).await?;
        if n > 0
            && let Some(last) = self.tables.last_mut()
        {
            last.notes.push(format!("{n} {what}"));
        }
        Ok(())
    }

    /// Compare deux grandeurs qui doivent être égales (`v1`, `v2` : des requêtes scalaires).
    pub(super) async fn check_equal(
        &mut self,
        conn: &mut SqliteConnection,
        name: &'static str,
        v1: &str,
        v2: &str,
    ) -> Result<(), MigrateError> {
        let a = scalar(conn, v1).await?;
        let b = scalar(conn, v2).await?;
        self.checks.push(Check {
            name,
            ok: a == b,
            detail: format!("v1 {a}, v2 {b}"),
        });
        Ok(())
    }

    /// Vrai si aucun contrôle n'a échoué.
    pub fn is_clean(&self) -> bool {
        self.checks.iter().all(|check| check.ok)
    }
}

pub(super) async fn scalar(conn: &mut SqliteConnection, sql: &str) -> Result<i64, MigrateError> {
    let value: Option<i64> = sqlx::query_scalar(AssertSqlSafe(sql.to_owned()))
        .fetch_one(&mut *conn)
        .await?;
    Ok(value.unwrap_or(0))
}

impl fmt::Display for Report {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(f, "Conversion v1 → v2")?;
        writeln!(f)?;
        writeln!(
            f,
            "{:<28} {:<28} {:>9} {:>9}",
            "table v2", "depuis", "lues", "écrites"
        )?;
        for t in &self.tables {
            writeln!(
                f,
                "{:<28} {:<28} {:>9} {:>9}",
                t.table, t.from, t.read, t.written
            )?;
            for note in &t.notes {
                writeln!(f, "    · {note}")?;
            }
        }
        writeln!(f)?;
        writeln!(f, "Contrôles")?;
        for c in &self.checks {
            let mark = if c.ok { "ok " } else { "ÉCART" };
            writeln!(f, "  {mark:<5} {} ({})", c.name, c.detail)?;
        }
        Ok(())
    }
}
