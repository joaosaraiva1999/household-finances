//! Migration of the legacy Prisma web-app database (`db/custom.db`) into the
//! desktop core schema.
//!
//! Rules (from the project spec — *do not lose or destroy data*):
//! 1. A `.pre-migration-*.bak` copy of the target file is taken first.
//! 2. The migration is atomic: one transaction, all rows or none.
//! 3. If the target already holds data, an explicit `force` is required.
//! 4. Rows are **never dropped**. Anything odd is repaired with the least
//!    destructive clamp and reported in `MigrationReport.warnings`.
//! 5. Float euro amounts become integer cents (`.round()`, like `Math.round`).
//! 6. Ids and creation timestamps are preserved.

use std::path::Path;

use rusqlite::OpenFlags;

use crate::db::Store;
use crate::error::{AppError, Result};
use crate::model::{civil_from_unix, Expense, Income};
use crate::money::euros_to_cents;
use crate::repo;
use crate::validation::{self, Kind, Person, Responsible};

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationReport {
    pub expenses_migrated: usize,
    pub incomes_migrated: usize,
    pub warnings: Vec<String>,
    pub backup_path: Option<String>,
}

/// Migrate a legacy Prisma SQLite file into the (already open) store.
pub fn migrate_legacy(store: &Store, legacy_path: &Path, force: bool) -> Result<MigrationReport> {
    if !force && (repo::count_expenses(&store.conn)? > 0 || repo::count_incomes(&store.conn)? > 0) {
        return Err(AppError::TargetNotEmpty);
    }

    // Refuse to touch a legacy file that does not exist or is not a database.
    if !legacy_path.exists() {
        return Err(AppError::NotFound(format!(
            "Legacy database not found at {}",
            legacy_path.display()
        )));
    }

    let bak = store.backup_file("pre-migration")?;

    let legacy = rusqlite::Connection::open_with_flags(
        legacy_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NOFOLLOW,
    )?;

    let mut warnings: Vec<String> = Vec::new();
    let expenses = read_legacy_expenses(&legacy, &mut warnings)?;
    let incomes = read_legacy_incomes(&legacy, &mut warnings)?;

    let tx = store.conn.unchecked_transaction()?;
    tx.execute("DELETE FROM expenses", [])?;
    tx.execute("DELETE FROM incomes", [])?;
    for e in &expenses {
        repo::restore_expense_tx(&tx, e)?;
    }
    for i in &incomes {
        repo::restore_income_tx(&tx, i)?;
    }
    tx.commit()?;

    Ok(MigrationReport {
        expenses_migrated: expenses.len(),
        incomes_migrated: incomes.len(),
        warnings,
        backup_path: bak.to_str().map(String::from),
    })
}

// ─── Legacy readers (schema of the Prisma web app) ───────────────────────────

/// `responsible` in the current schema; older builds used `owner`.
fn column_of(legacy: &rusqlite::Connection, table: &str, candidates: &[&str]) -> Option<String> {
    let mut stmt = legacy
        .prepare(&format!("PRAGMA table_info({table})"))
        .ok()?;
    let cols: Vec<String> = stmt
        .query_map([], |r| r.get::<_, String>(1))
        .ok()?
        .filter_map(|c| c.ok())
        .collect();
    candidates
        .iter()
        .find(|c| cols.iter().any(|x| x == *c))
        .map(|c| (*c).to_string())
}

/// Read a value that may be stored as INTEGER (unix ms), TEXT or NULL.
fn as_timestamp(v: rusqlite::types::Value) -> String {
    match v {
        rusqlite::types::Value::Integer(ms) => {
            let (y, m, d, hh, mm, ss) = civil_from_unix(ms.div_euclid(1000));
            format!("{y:04}-{m:02}-{d:02}T{hh:02}:{mm:02}:{ss:02}Z")
        }
        rusqlite::types::Value::Text(t) => t,
        _ => String::new(),
    }
}

fn as_bool(v: rusqlite::types::Value) -> bool {
    match v {
        rusqlite::types::Value::Integer(n) => n != 0,
        rusqlite::types::Value::Text(t) => t == "1" || t.eq_ignore_ascii_case("true"),
        _ => false,
    }
}

fn read_legacy_expenses(
    legacy: &rusqlite::Connection,
    warnings: &mut Vec<String>,
) -> Result<Vec<Expense>> {
    let responsible_col =
        column_of(legacy, "Expense", &["responsible", "owner"]).ok_or_else(|| {
            AppError::Validation("Legacy Expense table has no responsible/owner column".into())
        })?;
    // Column names come from PRAGMA (schema constants), never user data.
    let sql = format!(
        "SELECT id, name, amount, kind, category, {responsible_col}, joaoShare, \
         joaoPaid, annaPaid, dueDate, paid, notes, month, createdAt, updatedAt \
         FROM Expense ORDER BY rowid"
    );
    let mut stmt = legacy.prepare(&sql)?;
    let rows = stmt.query_map([], |r| {
        Ok(LegacyExpense {
            id: r.get(0)?,
            name: r.get(1)?,
            amount: r.get::<_, Option<f64>>(2)?.unwrap_or(0.0),
            kind: r
                .get::<_, Option<String>>(3)?
                .unwrap_or_else(|| "expense".into()),
            category: r
                .get::<_, Option<String>>(4)?
                .unwrap_or_else(|| "Other".into()),
            responsible: r
                .get::<_, Option<String>>(5)?
                .unwrap_or_else(|| "shared".into()),
            joao_share: r.get::<_, Option<f64>>(6)?.unwrap_or(50.0),
            joao_paid: r.get::<_, Option<Option<f64>>>(7)?.flatten(),
            anna_paid: r.get::<_, Option<Option<f64>>>(8)?.flatten(),
            due_date: r.get::<_, Option<String>>(9)?,
            paid: as_bool(r.get::<_, rusqlite::types::Value>(10)?),
            notes: r.get::<_, Option<String>>(11)?,
            month: r.get::<_, Option<String>>(12)?.unwrap_or_default(),
            created_at: as_timestamp(r.get::<_, rusqlite::types::Value>(13)?),
            updated_at: as_timestamp(r.get::<_, rusqlite::types::Value>(14)?),
        })
    })?;

    let mut out = Vec::new();
    for (i, row) in rows.enumerate() {
        let l = row.map_err(AppError::Db)?;
        out.push(convert_expense(l, i, warnings));
    }
    Ok(out)
}

struct LegacyExpense {
    id: String,
    name: String,
    amount: f64,
    kind: String,
    category: String,
    responsible: String,
    joao_share: f64,
    joao_paid: Option<f64>,
    anna_paid: Option<f64>,
    due_date: Option<String>,
    paid: bool,
    notes: Option<String>,
    month: String,
    created_at: String,
    updated_at: String,
}

fn convert_expense(l: LegacyExpense, index: usize, warnings: &mut Vec<String>) -> Expense {
    let mut warn = |msg: String| warnings.push(format!("Expense #{index} ({}): {msg}", l.id));

    // Never drop a row — repair with the least destructive clamp.
    let name = {
        let n = validation::clean_text(&l.name);
        if n.is_empty() {
            warn("empty name → replaced with \"(sem nome)\"".into());
            "(sem nome)".to_string()
        } else {
            n.chars().take(validation::NAME_MAX).collect()
        }
    };
    let mut amount_cents = euros_to_cents(l.amount);
    if amount_cents <= 0 || amount_cents > crate::money::EXPENSE_MAX_CENTS {
        warn(format!(
            "amount {} out of range → clamped",
            crate::money::format_eur(amount_cents, true)
        ));
        amount_cents = amount_cents.clamp(1, crate::money::EXPENSE_MAX_CENTS);
    }
    let kind = match Kind::parse(l.kind.trim()) {
        Ok(k) => k,
        Err(_) => {
            warn(format!("unknown kind {:?} → \"expense\"", l.kind));
            Kind::Expense
        }
    };
    let responsible = match Responsible::parse(l.responsible.trim()) {
        Ok(r) => r,
        Err(_) => {
            warn(format!(
                "unknown responsible {:?} → \"shared\"",
                l.responsible
            ));
            Responsible::Shared
        }
    };
    let month = match validation::parse_month(l.month.trim()) {
        Ok(m) => m,
        Err(_) => {
            warn(format!("invalid month {:?} → \"1970-01\"", l.month));
            "1970-01".to_string()
        }
    };
    let due_date = l
        .due_date
        .as_deref()
        .and_then(|d| match validation::parse_due_date(d.trim()) {
            Ok(x) => Some(x),
            Err(_) => {
                warn(format!("invalid due date {d:?} → cleared"));
                None
            }
        });
    let joao_share = validation::validate_share(l.joao_share).unwrap_or_else(|_| {
        warn(format!("invalid joaoShare {} → 50", l.joao_share));
        50.0
    });

    let mut joao_paid = l.joao_paid.map(euros_to_cents);
    let mut anna_paid = l.anna_paid.map(euros_to_cents);
    if kind == Kind::Expense && responsible == Responsible::Shared {
        match (joao_paid, anna_paid) {
            (Some(j), _) => {
                let j = j.clamp(0, amount_cents);
                joao_paid = Some(j);
                anna_paid = Some(amount_cents - j);
            }
            (None, Some(a)) => {
                let a = a.clamp(0, amount_cents);
                anna_paid = Some(a);
                joao_paid = Some(amount_cents - a);
            }
            (None, None) => {}
        }
    } else {
        joao_paid = None;
        anna_paid = None;
    }

    Expense {
        id: l.id,
        name,
        amount_cents,
        kind,
        category: validation::normalize_category(&l.category),
        responsible,
        joao_share,
        joao_paid_cents: joao_paid,
        anna_paid_cents: anna_paid,
        due_date,
        paid: l.paid,
        notes: validation::clean_notes(l.notes.as_deref()),
        month,
        created_at: if l.created_at.is_empty() {
            crate::model::now_iso()
        } else {
            l.created_at
        },
        updated_at: if l.updated_at.is_empty() {
            crate::model::now_iso()
        } else {
            l.updated_at
        },
    }
}

fn read_legacy_incomes(
    legacy: &rusqlite::Connection,
    warnings: &mut Vec<String>,
) -> Result<Vec<Income>> {
    let sql = "SELECT id, person, month, amount, mealCard, createdAt, updatedAt \
               FROM Income ORDER BY rowid";
    let mut stmt = legacy.prepare(sql)?;
    let rows = stmt.query_map([], |r| {
        Ok(LegacyIncome {
            id: r.get(0)?,
            person: r.get::<_, Option<String>>(1)?.unwrap_or_default(),
            month: r.get::<_, Option<String>>(2)?.unwrap_or_default(),
            amount: r.get::<_, Option<f64>>(3)?.unwrap_or(0.0),
            meal_card: r.get::<_, Option<f64>>(4)?.unwrap_or(0.0),
            created_at: as_timestamp(r.get::<_, rusqlite::types::Value>(5)?),
            updated_at: as_timestamp(r.get::<_, rusqlite::types::Value>(6)?),
        })
    })?;

    let mut out = Vec::new();
    for (i, row) in rows.enumerate() {
        let l = row.map_err(AppError::Db)?;
        let mut warn = |msg: String| warnings.push(format!("Income #{i} ({}): {msg}", l.id));

        let person = match Person::parse(l.person.trim()) {
            Ok(p) => p,
            Err(_) => {
                warn(format!("unknown person {:?} → \"joao\"", l.person));
                Person::Joao
            }
        };
        let month = match validation::parse_month(l.month.trim()) {
            Ok(m) => m,
            Err(_) => {
                warn(format!("invalid month {:?} → \"1970-01\"", l.month));
                "1970-01".to_string()
            }
        };
        let salary = euros_to_cents(l.amount).clamp(0, crate::money::INCOME_MAX_CENTS);
        let meal = euros_to_cents(l.meal_card).clamp(0, crate::money::INCOME_MAX_CENTS);

        out.push(Income {
            id: l.id,
            person,
            month,
            salary_cents: salary,
            meal_card_cents: meal,
            created_at: if l.created_at.is_empty() {
                crate::model::now_iso()
            } else {
                l.created_at
            },
            updated_at: if l.updated_at.is_empty() {
                crate::model::now_iso()
            } else {
                l.updated_at
            },
        });
    }
    Ok(out)
}

struct LegacyIncome {
    id: String,
    person: String,
    month: String,
    amount: f64,
    meal_card: f64,
    created_at: String,
    updated_at: String,
}
