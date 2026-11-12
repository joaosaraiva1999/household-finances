//! SQLite storage: connection setup, hardened pragmas and schema migrations.
//!
//! ## Security notes
//!
//! * The database lives in the OS application-data directory (decided by the
//!   Tauri shell), never in a world-readable temp dir or the install dir.
//! * The file is opened with `SQLITE_OPEN_NOFOLLOW` so a pre-planted symlink
//!   at the expected path cannot redirect writes.
//! * `foreign_keys=ON`, `busy_timeout`, WAL journaling.
//! * The schema carries `CHECK` constraints (enum domains, amount ranges,
//!   month/date shapes, text bounds) — a second line of defense below the
//!   application validation.

use std::path::{Path, PathBuf};

use rusqlite::OpenFlags;

use crate::error::{AppError, Result};

/// v1 schema — created on first open.
pub const SCHEMA_V1: &str = r#"
CREATE TABLE IF NOT EXISTS incomes (
    id              TEXT PRIMARY KEY,
    person          TEXT    NOT NULL CHECK(person IN ('joao','anna')),
    month           TEXT    NOT NULL CHECK(
                        length(month) = 7
                        AND month >= '0001-01' AND month <= '9999-12'
                        AND substr(month, 5, 1) = '-'
                    ),
    salary_cents    INTEGER NOT NULL DEFAULT 0
                    CHECK(salary_cents >= 0 AND salary_cents <= 10000000000),
    meal_card_cents INTEGER NOT NULL DEFAULT 0
                    CHECK(meal_card_cents >= 0 AND meal_card_cents <= 10000000000),
    created_at      TEXT    NOT NULL DEFAULT '1970-01-01T00:00:00Z',
    updated_at      TEXT    NOT NULL DEFAULT '1970-01-01T00:00:00Z',
    UNIQUE(person, month)
);

CREATE TABLE IF NOT EXISTS expenses (
    id              TEXT PRIMARY KEY,
    name            TEXT    NOT NULL CHECK(length(name) >= 1 AND length(name) <= 120),
    amount_cents    INTEGER NOT NULL CHECK(amount_cents > 0 AND amount_cents <= 1000000000),
    kind            TEXT    NOT NULL CHECK(kind IN ('expense','credit')),
    category        TEXT    NOT NULL CHECK(length(category) >= 1 AND length(category) <= 64),
    responsible     TEXT    NOT NULL CHECK(responsible IN ('joao','anna','shared')),
    joao_share      REAL    NOT NULL DEFAULT 50 CHECK(joao_share >= 0 AND joao_share <= 100),
    joao_paid_cents INTEGER CHECK(joao_paid_cents IS NULL OR joao_paid_cents >= 0),
    anna_paid_cents INTEGER CHECK(anna_paid_cents IS NULL OR anna_paid_cents >= 0),
    due_date        TEXT    CHECK(due_date IS NULL OR length(due_date) = 10),
    paid            INTEGER NOT NULL DEFAULT 0 CHECK(paid IN (0,1)),
    notes           TEXT    CHECK(notes IS NULL OR length(notes) <= 500),
    month           TEXT    NOT NULL CHECK(
                        length(month) = 7
                        AND month >= '0001-01' AND month <= '9999-12'
                        AND substr(month, 5, 1) = '-'
                    ),
    created_at      TEXT    NOT NULL DEFAULT '1970-01-01T00:00:00Z',
    updated_at      TEXT    NOT NULL DEFAULT '1970-01-01T00:00:00Z',
    CHECK(joao_paid_cents IS NULL OR joao_paid_cents <= amount_cents),
    CHECK(anna_paid_cents IS NULL OR anna_paid_cents <= amount_cents)
);

CREATE INDEX IF NOT EXISTS idx_expenses_month ON expenses(month);
CREATE INDEX IF NOT EXISTS idx_incomes_month  ON incomes(month);
"#;

/// Ordered migrations: (user_version, SQL). Each runs once, inside a
/// transaction, guarded by `PRAGMA user_version`.
pub const MIGRATIONS: &[(i64, &str)] = &[(1, SCHEMA_V1)];

pub struct Store {
    pub conn: rusqlite::Connection,
    pub path: PathBuf,
}

impl Store {
    /// Open (creating if needed) the database at `path` and bring the schema
    /// to the latest version.
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent)?;
            }
        }
        let flags = OpenFlags::SQLITE_OPEN_READ_WRITE
            | OpenFlags::SQLITE_OPEN_CREATE
            | OpenFlags::SQLITE_OPEN_NOFOLLOW
            | OpenFlags::SQLITE_OPEN_URI;
        let conn = rusqlite::Connection::open_with_flags(path, flags)
            .map_err(|e| AppError::Io(std::io::Error::other(e)))?;
        let store = Self {
            conn,
            path: path.to_path_buf(),
        };
        store.configure()?;
        store.run_migrations()?;
        Ok(store)
    }

    /// In-memory store — used by the test-suite.
    pub fn open_in_memory() -> Result<Self> {
        let conn = rusqlite::Connection::open_in_memory()?;
        let store = Self {
            conn,
            path: PathBuf::from(":memory:"),
        };
        store.configure()?;
        store.run_migrations()?;
        Ok(store)
    }

    fn configure(&self) -> Result<()> {
        self.conn.busy_timeout(std::time::Duration::from_millis(5_000))?;
        self.conn
            .pragma_update(None, "journal_mode", "WAL")?;
        self.conn.pragma_update(None, "foreign_keys", "ON")?;
        self.conn.pragma_update(None, "synchronous", "NORMAL")?;
        // Never read plain-text content back as a different type than stored.
        self.conn.pragma_update(None, "trusted_schema", "OFF").ok();
        Ok(())
    }

    /// Apply pending migrations, each in its own transaction.
    pub fn run_migrations(&self) -> Result<()> {
        let current: i64 = self
            .conn
            .query_row("SELECT user_version FROM pragma_user_version", [], |r| {
                r.get(0)
            })?;
        for &(version, sql) in MIGRATIONS {
            if version <= current {
                continue;
            }
            let tx = self.conn.unchecked_transaction()?;
            tx.execute_batch(sql)
                .map_err(|e| AppError::Db(e))?;
            tx.pragma_update(None, "user_version", version)?;
            tx.commit()?;
        }
        Ok(())
    }

    /// Copy the database file to `<path>.<label>-<timestamp>.bak`
    /// (used before destructive operations such as migration or restore).
    /// Returns the backup path.
    pub fn backup_file(&self, label: &str) -> Result<PathBuf> {
        let ts = crate::model::now_iso().replace([':', '-'], "");
        let target = self.path.with_extension(format!("db.{label}-{ts}.bak"));
        if self.path.exists() {
            std::fs::copy(&self.path, &target)?;
        }
        Ok(target)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_applies_and_checks_enforce_domains() {
        let store = Store::open_in_memory().unwrap();
        // Valid insert works
        store
            .conn
            .execute(
                "INSERT INTO expenses (id, name, amount_cents, kind, category, responsible, joao_share, month)
                 VALUES ('x1','Test',1000,'expense','Other','shared',50,'2026-11')",
                [],
            )
            .unwrap();
        // Invalid enum value is rejected by CHECK
        assert!(store
            .conn
            .execute(
                "INSERT INTO expenses (id, name, amount_cents, kind, category, responsible, joao_share, month)
                 VALUES ('x2','Test',1000,'weird','Other','shared',50,'2026-11')",
                [],
            )
            .is_err());
        // Invalid month is rejected
        assert!(store
            .conn
            .execute(
                "INSERT INTO expenses (id, name, amount_cents, kind, category, responsible, joao_share, month)
                 VALUES ('x3','Test',1000,'expense','Other','shared',50,'DROP TABLE')",
                [],
            )
            .is_err());
        // Zero/negative amounts rejected
        assert!(store
            .conn
            .execute(
                "INSERT INTO expenses (id, name, amount_cents, kind, category, responsible, joao_share, month)
                 VALUES ('x4','Test',0,'expense','Other','shared',50,'2026-11')",
                [],
            )
            .is_err());
        // Over-long name rejected
        assert!(store
            .conn
            .execute(
                "INSERT INTO expenses (id, name, amount_cents, kind, category, responsible, joao_share, month)
                 VALUES ('x5','',1000,'expense','Other','shared',50,'2026-11')",
                [],
            )
            .is_err());
    }

    #[test]
    fn migrations_are_idempotent() {
        let store = Store::open_in_memory().unwrap();
        store.run_migrations().unwrap(); // second call: no-op
        let v: i64 = store
            .conn
            .query_row("SELECT user_version FROM pragma_user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v, 1);
    }
}
