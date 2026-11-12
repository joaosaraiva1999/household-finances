//! SQLite persistence: connection management, schema migrations and
//! row ↔ model mapping. The database lives in the OS application-data
//! directory and is managed by Rust only — the frontend never touches it.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use rusqlite::Connection;

use crate::summary::ExpenseCents;
use crate::validate::from_cents;

pub struct Db {
    pub conn: Arc<Mutex<Connection>>,
    pub path: PathBuf,
}

// ─── Schema ──────────────────────────────────────────────────────────────────

const MIGRATION_V1: &str = r#"
CREATE TABLE IF NOT EXISTS income (
    id              TEXT PRIMARY KEY,
    person          TEXT NOT NULL CHECK (person IN ('joao', 'anna')),
    month           TEXT NOT NULL,
    amount_cents    INTEGER NOT NULL DEFAULT 0,
    meal_card_cents INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    UNIQUE (person, month)
);

CREATE TABLE IF NOT EXISTS expense (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    amount_cents    INTEGER NOT NULL,
    kind            TEXT NOT NULL DEFAULT 'expense' CHECK (kind IN ('expense', 'credit')),
    category        TEXT NOT NULL DEFAULT 'Other',
    responsible     TEXT NOT NULL DEFAULT 'shared' CHECK (responsible IN ('joao', 'anna', 'shared')),
    joao_share      REAL NOT NULL DEFAULT 50,
    joao_paid_cents INTEGER,
    anna_paid_cents INTEGER,
    due_date        TEXT,
    paid            INTEGER NOT NULL DEFAULT 0,
    notes           TEXT,
    month           TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_income_month  ON income(month);
CREATE INDEX IF NOT EXISTS idx_expense_month ON expense(month);
CREATE INDEX IF NOT EXISTS idx_expense_name  ON expense(name);
"#;

/// Run pending migrations. Before any migration on a non-empty, older
/// database an automatic backup is written to `<db dir>/backups/`.
pub fn migrate(conn: &Connection, db_path: &Path) -> Result<(), String> {
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;

    if version < 1 {
        if version == 0 && db_path.exists() && db_path.metadata().map(|m| m.len() > 4096).unwrap_or(false) {
            // Pre-existing database being upgraded: snapshot first.
            let _ = auto_backup(db_path, "pre-migration");
        }
        conn.execute_batch(MIGRATION_V1)
            .map_err(|e| format!("migration v1 failed: {e}"))?;
        conn.execute_batch("PRAGMA user_version = 1;")
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Open (creating parent dirs) and initialize the database at `path`.
pub fn open(db_path: &Path) -> Result<Db, String> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA foreign_keys = ON;
         PRAGMA synchronous = FULL;
         PRAGMA busy_timeout = 5000;",
    )
    .map_err(|e| e.to_string())?;
    migrate(&conn, db_path)?;
    Ok(Db { conn: Arc::new(Mutex::new(conn)), path: db_path.to_path_buf() })
}

/// Consistent snapshot of the live database into `target` (which must not
/// exist yet) using SQLite's `VACUUM INTO`. Returns the target path.
pub fn vacuum_snapshot(conn: &Connection, target: &Path) -> Result<PathBuf, String> {
    if target.exists() {
        return Err("Target file already exists".to_string());
    }
    let sql = format!(
        "VACUUM INTO '{}'",
        target.to_string_lossy().replace('\'', "''")
    );
    conn.execute_batch(&sql).map_err(|e| e.to_string())?;
    Ok(target.to_path_buf())
}

/// Copy of the raw database file into `<db dir>/backups/` with a label and
/// timestamp. Best-effort: failures are non-fatal for callers.
pub fn auto_backup(db_path: &Path, label: &str) -> Option<PathBuf> {
    let dir = db_path.parent()?.join("backups");
    std::fs::create_dir_all(&dir).ok()?;
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let target = dir.join(format!("{label}-{stamp}.db"));
    std::fs::copy(db_path, &target).ok()?;
    Some(target)
}

/// Prune old automatic backups, keeping the newest `keep`.
pub fn prune_auto_backups(db_path: &Path, keep: usize) {
    let Some(dir) = db_path.parent().map(|p| p.join("backups")) else {
        return;
    };
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return;
    };
    let mut files: Vec<_> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().map(|x| x == "db").unwrap_or(false))
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            let modified = meta.modified().ok()?;
            Some((modified, e.path()))
        })
        .collect();
    if files.len() <= keep {
        return;
    }
    files.sort_by(|a, b| b.0.cmp(&a.0));
    for (_, path) in files.into_iter().skip(keep) {
        let _ = std::fs::remove_file(path);
    }
}

// ─── Row mapping ─────────────────────────────────────────────────────────────

pub fn row_to_expense(row: &rusqlite::Row) -> rusqlite::Result<ExpenseCents> {
    let paid: i64 = row.get("paid")?;
    Ok(ExpenseCents {
        id: row.get("id")?,
        name: row.get("name")?,
        amount_cents: row.get("amount_cents")?,
        kind: row.get("kind")?,
        category: row.get("category")?,
        responsible: row.get("responsible")?,
        joao_share: row.get("joao_share")?,
        joao_paid_cents: row.get("joao_paid_cents")?,
        anna_paid_cents: row.get("anna_paid_cents")?,
        due_date: row.get("due_date")?,
        paid: paid != 0,
        notes: row.get("notes")?,
        month: row.get("month")?,
    })
}

pub fn expense_record_json(e: &ExpenseCents) -> crate::models::ExpenseRecord {
    crate::models::ExpenseRecord {
        id: e.id.clone(),
        name: e.name.clone(),
        amount: from_cents(e.amount_cents),
        kind: e.kind.clone(),
        category: e.category.clone(),
        responsible: e.responsible.clone(),
        joao_share: e.joao_share,
        joao_paid: e.joao_paid_cents.map(from_cents),
        anna_paid: e.anna_paid_cents.map(from_cents),
        due_date: e.due_date.clone(),
        paid: e.paid,
        notes: e.notes.clone(),
        month: e.month.clone(),
    }
}
