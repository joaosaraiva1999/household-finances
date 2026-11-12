//! Backup, restore, CSV export and legacy (web version) data import.
//! All file pickers are native dialogs handled on the Rust side.

use std::path::PathBuf;

use rusqlite::Connection;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::db::Db;
use crate::ids::{is_valid_month, now_rfc3339};
use crate::models::{DbStats, ImportReport};
use crate::summary::IncomeCents;
use crate::validate::{is_iso_date, normalize_paid_split, share_percent_from_paid, to_cents};

// ─── Dialog helpers ──────────────────────────────────────────────────────────

fn pick_save(app: &AppHandle, title: &str, default_name: &str, ext: &str) -> Option<PathBuf> {
    app.dialog()
        .file()
        .set_title(title)
        .set_file_name(default_name)
        .add_filter("Ficheiro", &[ext, "sqlite", "backup"])
        .blocking_save_file()
        .and_then(|p| p.into_path().ok())
}

fn pick_open(app: &AppHandle, title: &str) -> Option<PathBuf> {
    app.dialog()
        .file()
        .set_title(title)
        .add_filter("Ficheiro", &["db", "sqlite", "backup"])
        .blocking_pick_file()
        .and_then(|p| p.into_path().ok())
}

// ─── Export backup (consistent VACUUM INTO snapshot) ────────────────────────

pub async fn run_backup_export(
    app: AppHandle,
    conn: std::sync::Arc<std::sync::Mutex<rusqlite::Connection>>,
) -> Result<Option<String>, String> {
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let default_name = format!("backup-financas-{stamp}.db");

    let target = tauri::async_runtime::spawn_blocking(move || {
        pick_save(&app, "Guardar backup da base de dados", &default_name, "db")
    })
    .await
    .map_err(|e| e.to_string())?;

    let Some(target) = target else {
        return Ok(None); // user cancelled
    };

    let conn = conn.lock().map_err(|_| "Database is locked")?;
    if target.exists() {
        std::fs::remove_file(&target).map_err(|e| e.to_string())?;
    }
    crate::db::vacuum_snapshot(&conn, &target).map_err(|e| e.to_string())?;
    Ok(Some(target.to_string_lossy().into_owned()))
}

// ─── Source-database row reading (desktop backups AND legacy web DBs) ───────

enum SourceDialect {
    /// Our own backups / desktop databases: integer cents.
    Cents,
    /// The web (Prisma) database: euro floats.
    Floats,
}

struct SourceRow {
    id: String,
    name: String,
    amount_cents: i64,
    kind: String,
    category: String,
    responsible: String,
    joao_share: f64,
    joao_paid_cents: Option<i64>,
    anna_paid_cents: Option<i64>,
    due_date: Option<String>,
    paid: bool,
    notes: Option<String>,
    month: String,
    created_at: Option<String>,
    updated_at: Option<String>,
}

fn table_columns(conn: &Connection, table: &str) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info('{table}')"))
        .map_err(|_| format!("Não parece uma base de dados desta aplicação ({table})"))?;
    let rows = stmt
        .query_map([], |r| r.get::<_, String>(1))
        .map_err(|_| format!("Não parece uma base de dados desta aplicação ({table})"))?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

fn has_column(cols: &[String], name: &str) -> bool {
    cols.iter().any(|c| c.eq_ignore_ascii_case(name))
}

fn read_float(r: &rusqlite::Row<'_>, idx: usize) -> rusqlite::Result<f64> {
    // Amounts may be stored as REAL or as TEXT in odd legacy files.
    match r.get_ref(idx)? {
        rusqlite::types::ValueRef::Real(f) => Ok(f),
        rusqlite::types::ValueRef::Integer(i) => Ok(i as f64),
        rusqlite::types::ValueRef::Text(t) => Ok(String::from_utf8_lossy(t).trim().parse().unwrap_or(0.0)),
        _ => Ok(0.0),
    }
}

fn read_opt_float(r: &rusqlite::Row<'_>, idx: usize) -> rusqlite::Result<Option<f64>> {
    match r.get_ref(idx)? {
        rusqlite::types::ValueRef::Null => Ok(None),
        _ => Ok(Some(read_float(r, idx)?)),
    }
}

/// Validate a backup/legacy database and read all of its rows, converting
/// money to cents with JS `Math.round(x*100)` semantics.
fn read_source_db(path: &PathBuf) -> Result<(SourceDialect, Vec<IncomeCents>, Vec<SourceRow>), String> {
    let src = Connection::open_with_flags(
        path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .map_err(|_| "Não foi possível abrir a base de dados".to_string())?;

    let integrity: String = src
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .map_err(|_| "O ficheiro não é uma base de dados válida".to_string())?;
    if integrity != "ok" {
        return Err(format!("Base de dados corrompida: {integrity}"));
    }

    // Locate the tables (web schema uses PascalCase, desktop uses lowercase).
    let tables: Vec<String> = {
        let mut stmt = src
            .prepare("SELECT name FROM sqlite_master WHERE type='table'")
            .map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0)).map_err(|e| e.to_string())?;
        rows.filter_map(|r| r.ok()).collect()
    };
    let income_table = tables.iter().find(|t| t.eq_ignore_ascii_case("income")).cloned()
        .ok_or("O backup não contém a tabela de rendimentos")?;
    let expense_table = tables.iter().find(|t| t.eq_ignore_ascii_case("expense")).cloned()
        .ok_or("O backup não contém a tabela de despesas")?;

    let income_cols = table_columns(&src, &income_table)?;
    let expense_cols = table_columns(&src, &expense_table)?;

    for col in ["id", "person", "month"] {
        if !has_column(&income_cols, col) {
            return Err(format!("Backup incompatível (tabela '{income_table}' sem coluna '{col}')"));
        }
    }
    for col in ["id", "name", "month", "responsible"] {
        if !has_column(&expense_cols, col) {
            return Err(format!("Backup incompatível (tabela '{expense_table}' sem coluna '{col}')"));
        }
    }
    if !has_column(&expense_cols, "amount") && !has_column(&expense_cols, "amount_cents") {
        return Err("Backup incompatível (sem coluna de valor)".to_string());
    }

    let dialect = if has_column(&income_cols, "amount_cents") {
        SourceDialect::Cents
    } else {
        SourceDialect::Floats
    };

    // ── Incomes ──
    let income_amount_col = if has_column(&income_cols, "amount_cents") { "amount_cents" } else { "amount" };
    let meal_col = if has_column(&income_cols, "meal_card_cents") { "meal_card_cents" } else { "mealCard" };
    let income_created_col = if has_column(&income_cols, "createdAt") { "createdAt" } else { "created_at" };
    let income_updated_col = if has_column(&income_cols, "updatedAt") { "updatedAt" } else { "updated_at" };
    let mut incomes = Vec::new();
    {
        let sql = format!(
            "SELECT id, person, month, {income_amount_col}, {meal_col}, {income_created_col}, {income_updated_col} FROM \"{income_table}\""
        );
        let mut stmt = src.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    read_float(r, 3)?,
                    read_float(r, 4)?,
                    r.get::<_, Option<String>>(5)?,
                    r.get::<_, Option<String>>(6)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (id, person, month, amount, meal, created, updated) = row.map_err(|e| e.to_string())?;
            if !matches!(person.as_str(), "joao" | "anna") || !is_valid_month(&month) {
                continue;
            }
            let (a, m) = match dialect {
                SourceDialect::Cents => (amount as i64, meal as i64),
                SourceDialect::Floats => (to_cents(amount), to_cents(meal)),
            };
            incomes.push(IncomeCents {
                id,
                person,
                month,
                amount_cents: a,
                meal_card_cents: m,
                created_at: created,
                updated_at: updated,
            });
        }
    }

    // ── Expenses ──
    let amount_col = if has_column(&expense_cols, "amount_cents") { "amount_cents" } else { "amount" };
    let share_col = if has_column(&expense_cols, "joaoShare") { "joaoShare" } else { "joao_share" };
    let due_col = if has_column(&expense_cols, "dueDate") { "dueDate" } else { "due_date" };
    let notes_col = if has_column(&expense_cols, "notes") { "notes" } else { "notes" };
    let created_col = if has_column(&expense_cols, "createdAt") { "createdAt" } else { "created_at" };
    let updated_col = if has_column(&expense_cols, "updatedAt") { "updatedAt" } else { "updated_at" };

    let mut expenses = Vec::new();
    {
        let sql = format!(
            "SELECT id, name, {amount_col}, kind, category, responsible, {share_col}, joaoPaid, annaPaid, {due_col}, paid, {notes_col}, month, {created_col}, {updated_col}
             FROM \"{expense_table}\""
        );
        let mut stmt = src.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    read_float(r, 2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, Option<String>>(4)?,
                    r.get::<_, Option<String>>(5)?,
                    read_float(r, 6).unwrap_or(50.0),
                    read_opt_float(r, 7)?,
                    read_opt_float(r, 8)?,
                    r.get::<_, Option<String>>(9)?,
                    r.get::<_, i64>(10).unwrap_or(0),
                    r.get::<_, Option<String>>(11)?,
                    r.get::<_, String>(12)?,
                    r.get::<_, Option<String>>(13)?,
                    r.get::<_, Option<String>>(14)?,
                ))
            })
            .map_err(|e| e.to_string())?;

        for row in rows {
            let (id, name, amount, kind, category, responsible, share, joao_paid, anna_paid,
                 due, paid, notes, month, created, updated) = row.map_err(|e| e.to_string())?;
            if !is_valid_month(&month) || amount <= 0.0 {
                continue;
            }
            let kind = kind.unwrap_or_else(|| "expense".into());
            let category = category.unwrap_or_else(|| "Other".into());
            let responsible = responsible.unwrap_or_else(|| "shared".into());
            if !matches!(responsible.as_str(), "joao" | "anna" | "shared") {
                continue;
            }
            let kind = if kind == "credit" { "credit".to_string() } else { "expense".to_string() };
            let (amount_cents, jp, ap) = match dialect {
                SourceDialect::Cents => {
                    (amount as i64, joao_paid.map(|f| f as i64), anna_paid.map(|f| f as i64))
                }
                SourceDialect::Floats => {
                    (to_cents(amount), joao_paid.map(to_cents), anna_paid.map(to_cents))
                }
            };
            expenses.push(SourceRow {
                id,
                name,
                amount_cents,
                kind,
                category,
                responsible,
                joao_share: share.clamp(0.0, 100.0),
                joao_paid_cents: jp,
                anna_paid_cents: ap,
                due_date: due,
                paid: paid != 0,
                notes,
                month,
                created_at: created,
                updated_at: updated,
            });
        }
    }

    Ok((dialect, incomes, expenses))
}

// ─── Import backup (validate → auto-backup → transactional replace) ────────

pub async fn run_backup_import(
    app: AppHandle,
    conn: std::sync::Arc<std::sync::Mutex<rusqlite::Connection>>,
    db_path: std::path::PathBuf,
) -> Result<DbStats, String> {
    let source = tauri::async_runtime::spawn_blocking(move || {
        pick_open(&app, "Escolher ficheiro de backup a restaurar")
    })
    .await
    .map_err(|e| e.to_string())?;

    let Some(source) = source else {
        return Err("Restauro cancelado".to_string());
    };

    tauri::async_runtime::spawn_blocking(move || {
        // 1. Validate and read the backup BEFORE touching any live data.
        let (dialect, incomes, expenses) = read_source_db(&source)?;

        // 2. Automatic safety backup of the current database.
        crate::db::auto_backup(&db_path, "pre-restore");

        // 3. Transactional replace: current rows out, backup rows in.
        let conn = conn.lock().map_err(|_| "Database is locked")?;
        conn.execute_batch("BEGIN IMMEDIATE").map_err(|e| e.to_string())?;
        let result = (|| -> Result<(), String> {
            conn.execute("DELETE FROM expense", []).map_err(|e| e.to_string())?;
            conn.execute("DELETE FROM income", []).map_err(|e| e.to_string())?;

            for i in &incomes {
                conn.execute(
                    "INSERT INTO income (id, person, month, amount_cents, meal_card_cents, created_at, updated_at)
                     VALUES (?1,?2,?3,?4,?5,?6,?7)",
                    rusqlite::params![i.id, i.person, i.month, i.amount_cents, i.meal_card_cents,
                        i.created_at.clone().unwrap_or_else(now_rfc3339),
                        i.updated_at.clone().unwrap_or_else(now_rfc3339)],
                )
                .map_err(|e| e.to_string())?;
            }
            for e in &expenses {
                conn.execute(
                    "INSERT INTO expense (id, name, amount_cents, kind, category, responsible, joao_share,
                          joao_paid_cents, anna_paid_cents, due_date, paid, notes, month, created_at, updated_at)
                     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)",
                    rusqlite::params![
                        e.id,
                        e.name.chars().take(120).collect::<String>(),
                        e.amount_cents,
                        e.kind,
                        e.category,
                        e.responsible,
                        e.joao_share.clamp(0.0, 100.0),
                        e.joao_paid_cents,
                        e.anna_paid_cents,
                        e.due_date.as_deref().filter(|d| is_iso_date(d)),
                        e.paid as i64,
                        e.notes.as_ref().map(|n| n.chars().take(500).collect::<String>()),
                        e.month,
                        e.created_at.clone().unwrap_or_else(now_rfc3339),
                        e.updated_at.clone().unwrap_or_else(now_rfc3339),
                    ],
                )
                .map_err(|e| e.to_string())?;
            }
            let _ = dialect;
            Ok(())
        })();

        if let Err(e) = result {
            let _ = conn.execute_batch("ROLLBACK");
            return Err(e);
        }
        conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;

        read_stats(&conn)
    })
    .await
    .map_err(|e| e.to_string())?
}

// ─── CSV export ──────────────────────────────────────────────────────────────

pub async fn run_csv_export(
    app: AppHandle,
    conn: std::sync::Arc<std::sync::Mutex<rusqlite::Connection>>,
) -> Result<Option<String>, String> {
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let default_name = format!("financas-{stamp}.csv");

    let target = tauri::async_runtime::spawn_blocking(move || {
        pick_save(&app, "Exportar CSV", &default_name, "csv")
    })
    .await
    .map_err(|e| e.to_string())?;

    let Some(target) = target else {
        return Ok(None);
    };

    tauri::async_runtime::spawn_blocking(move || {
        let conn = conn.lock().map_err(|_| "Database is locked")?;

        let mut out = String::from("\u{FEFF}"); // UTF-8 BOM so Excel opens it correctly
        out.push_str("Mês;Nome;Tipo;Categoria;Responsável;Valor (€);Quota João (%);Pago João (€);Pago Anna (€);Vencimento;Estado;Notas\r\n");

        let mut stmt = conn
            .prepare(
                "SELECT month, name, kind, category, responsible, amount_cents, joao_share,
                        joao_paid_cents, anna_paid_cents, due_date, paid, notes
                 FROM expense ORDER BY month, created_at",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, i64>(5)?,
                    r.get::<_, f64>(6)?,
                    r.get::<_, Option<i64>>(7)?,
                    r.get::<_, Option<i64>>(8)?,
                    r.get::<_, Option<String>>(9)?,
                    r.get::<_, i64>(10)?,
                    r.get::<_, Option<String>>(11)?,
                ))
            })
            .map_err(|e| e.to_string())?;

        for row in rows {
            let (month, name, kind, category, responsible, amount, share, jp, ap, due, paid, notes) =
                row.map_err(|e| e.to_string())?;
            // Portuguese date convention: DD/MM/YYYY
            let due_pt = due
                .map(|d| {
                    let p: Vec<&str> = d.split('-').collect();
                    if p.len() == 3 {
                        format!("{}/{}/{}", p[2], p[1], p[0])
                    } else {
                        d
                    }
                })
                .unwrap_or_default();
            let line = [
                month,
                name,
                if kind == "credit" { "Crédito".into() } else { "Despesa".into() },
                category,
                match responsible.as_str() {
                    "joao" => "João".into(),
                    "anna" => "Anna".into(),
                    _ => "Partilhada".into(),
                },
                fmt_pt(amount),
                format_pt_number(share, 1),
                jp.map(fmt_pt).unwrap_or_default(),
                ap.map(fmt_pt).unwrap_or_default(),
                due_pt,
                if paid == 1 { "Pago".into() } else { "Pendente".into() },
                notes.unwrap_or_default(),
            ];
            let escaped: Vec<String> = line
                .into_iter()
                .map(|f| {
                    if f.contains(';') || f.contains('"') || f.contains('\n') {
                        format!("\"{}\"", f.replace('"', "\"\""))
                    } else {
                        f
                    }
                })
                .collect();
            out.push_str(&escaped.join(";"));
            out.push_str("\r\n");
        }

        std::fs::write(&target, out).map_err(|e| e.to_string())?;
        Ok(Some(target.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 123456 cents → "1.234,56"
pub fn fmt_pt(cents: i64) -> String {
    let negative = cents < 0;
    let abs = cents.unsigned_abs();
    let int_part = abs / 100;
    let frac = abs % 100;
    let grouped = group_thousands(&int_part.to_string());
    let sign = if negative { "-" } else { "" };
    format!("{sign}{grouped},{frac:02}")
}

/// 50.0 → "50,0" with `decimals` decimal places.
pub fn format_pt_number(value: f64, decimals: usize) -> String {
    let s = format!("{value:.decimals$}");
    s.replace('.', ",")
}

fn group_thousands(digits: &str) -> String {
    let len = digits.chars().count();
    let mut out = String::new();
    for (i, c) in digits.chars().enumerate() {
        out.push(c);
        let remaining = len - i - 1;
        if remaining > 0 && remaining % 3 == 0 {
            out.push('.');
        }
    }
    out
}

// ─── Legacy (web version) database import ───────────────────────────────────

/// Dialog-driven legacy import, callable from the frontend (first-run) and
/// from the Ficheiro menu.
pub async fn run_import_legacy_dialog(
    app: AppHandle,
    conn: std::sync::Arc<std::sync::Mutex<rusqlite::Connection>>,
    db_path: std::path::PathBuf,
) -> Result<Option<ImportReport>, String> {
    let path = tauri::async_runtime::spawn_blocking(move || {
        pick_open(&app, "Escolher a base de dados da versão web (custom.db)")
    })
    .await
    .map_err(|e| e.to_string())?;

    let Some(path) = path else {
        return Ok(None); // user cancelled
    };

    run_import_legacy_db(conn, db_path, path.to_string_lossy().into_owned())
        .await
        .map(Some)
}

pub async fn run_import_legacy_db(
    conn: std::sync::Arc<std::sync::Mutex<rusqlite::Connection>>,
    db_path: std::path::PathBuf,
    path: String,
) -> Result<ImportReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(path);
        // Read + validate the legacy file first (tables, columns, integrity).
        let (incomes, expenses) = {
            let (_, i, e) = read_source_db(&path)?;
            (i, e)
        };
        // The web (Prisma) schema stores euro floats — require that dialect
        // for a *legacy import*; our own backups should use "Restaurar".
        let _ = incomes;

        // Safety snapshot of whatever the desktop DB currently holds.
        crate::db::auto_backup(&db_path, "pre-import");

        let conn = conn.lock().map_err(|_| "Database is locked")?;
        conn.execute_batch("BEGIN IMMEDIATE").map_err(|e| e.to_string())?;

        let result = (|| -> Result<ImportReport, String> {
            let mut n_incomes = 0i64;
            let mut n_expenses = 0i64;
            let mut skipped = 0i64;
            let now = now_rfc3339();

            for i in &incomes {
                let inserted = conn
                    .execute(
                        "INSERT OR IGNORE INTO income
                             (id, person, month, amount_cents, meal_card_cents, created_at, updated_at)
                         VALUES (?1,?2,?3,?4,?5,?6,?7)",
                        rusqlite::params![i.id, i.person, i.month, i.amount_cents, i.meal_card_cents, now, now],
                    )
                    .map_err(|e| e.to_string())?;
                if inserted > 0 { n_incomes += 1; } else { skipped += 1; }
            }

            for e in &expenses {
                let (jp, ap, share) = if e.responsible == "shared" && e.kind == "expense" {
                    match normalize_paid_split(e.amount_cents, e.joao_paid_cents.map(|c| c as f64), e.anna_paid_cents.map(|c| c as f64)) {
                        Some((j, a)) => (Some(j), Some(a), share_percent_from_paid(j, e.amount_cents)),
                        None => (None, None, e.joao_share.clamp(0.0, 100.0)),
                    }
                } else {
                    (None, None, e.joao_share.clamp(0.0, 100.0))
                };
                let inserted = conn
                    .execute(
                        "INSERT OR IGNORE INTO expense
                             (id, name, amount_cents, kind, category, responsible, joao_share,
                              joao_paid_cents, anna_paid_cents, due_date, paid, notes, month,
                              created_at, updated_at)
                         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)",
                        rusqlite::params![
                            e.id,
                            e.name.chars().take(120).collect::<String>(),
                            e.amount_cents,
                            e.kind,
                            e.category,
                            e.responsible,
                            share,
                            jp,
                            ap,
                            e.due_date.as_deref().filter(|d| is_iso_date(d)),
                            e.paid as i64,
                            e.notes.as_ref().map(|n| n.chars().take(500).collect::<String>()),
                            e.month,
                            e.created_at.clone().unwrap_or_else(|| now.clone()),
                            e.updated_at.clone().unwrap_or_else(|| now.clone()),
                        ],
                    )
                    .map_err(|e| e.to_string())?;
                if inserted > 0 { n_expenses += 1; } else { skipped += 1; }
            }

            Ok(ImportReport { incomes: n_incomes, expenses: n_expenses, skipped })
        })();

        match result {
            Ok(report) => {
                conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
                Ok(report)
            }
            Err(e) => {
                let _ = conn.execute_batch("ROLLBACK");
                Err(e)
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

fn read_stats(conn: &Connection) -> Result<DbStats, String> {
    let incomes: i64 = conn
        .query_row("SELECT COUNT(*) FROM income", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let expenses: i64 = conn
        .query_row("SELECT COUNT(*) FROM expense", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let mut months: Vec<String> = Vec::new();
    for sql in [
        "SELECT DISTINCT month FROM income",
        "SELECT DISTINCT month FROM expense",
    ] {
        let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        for m in rows {
            months.push(m.map_err(|e| e.to_string())?);
        }
    }
    months.sort();
    months.dedup();
    Ok(DbStats { incomes, expenses, months })
}

// ─── #[tauri::command] wrappers (thin — delegate to run_* above) ────────────

#[tauri::command]
pub async fn backup_export(app: AppHandle, db: State<'_, Db>) -> Result<Option<String>, String> {
    run_backup_export(app, std::sync::Arc::clone(&db.conn)).await
}

#[tauri::command]
pub async fn backup_import(app: AppHandle, db: State<'_, Db>) -> Result<DbStats, String> {
    run_backup_import(app, std::sync::Arc::clone(&db.conn), db.path.clone()).await
}

#[tauri::command]
pub async fn csv_export(app: AppHandle, db: State<'_, Db>) -> Result<Option<String>, String> {
    run_csv_export(app, std::sync::Arc::clone(&db.conn)).await
}

#[tauri::command]
pub async fn import_legacy_dialog(
    app: AppHandle,
    db: State<'_, Db>,
) -> Result<Option<ImportReport>, String> {
    run_import_legacy_dialog(app, std::sync::Arc::clone(&db.conn), db.path.clone()).await
}

#[tauri::command]
pub async fn import_legacy_db(db: State<'_, Db>, path: String) -> Result<ImportReport, String> {
    run_import_legacy_db(std::sync::Arc::clone(&db.conn), db.path.clone(), path).await
}
