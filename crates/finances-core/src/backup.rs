//! Backup export / import with integrity verification.
//!
//! * Export: canonical JSON + SHA-256 checksum over the data payload.
//! * Import: refuses to run without an explicit `confirmed` flag (the UI must
//!   show a destructive-action warning first), verifies the checksum, strictly
//!   re-validates every record, then replaces all data in ONE transaction —
//!   any failure rolls the database back untouched. A `.pre-restore-*.bak`
//!   copy of the database file is taken before the transaction.

use std::io::Write;

use sha2::{Digest, Sha256};

use crate::db::Store;
use crate::error::{AppError, Result};
use crate::model::{Expense, Income};
use crate::repo;
use crate::validation::{self, Kind, Person, Responsible};

pub const BACKUP_VERSION: u32 = 1;
pub const APP_ID: &str = "household-finances";

// ─── File format (v1) ────────────────────────────────────────────────────────

#[derive(Debug, serde::Serialize, serde::Deserialize)]
struct BackupFile {
    version: u32,
    app: String,
    exported_at: String,
    checksum: String,
    data: serde_json::Value,
}

// ─── Export ──────────────────────────────────────────────────────────────────

/// Export everything to `path` (JSON, pretty-printed, checksummed).
pub fn export_backup(store: &Store, path: &std::path::Path) -> Result<u64> {
    let expenses = repo::list_all_expenses(&store.conn)?;
    let incomes = repo::list_all_incomes(&store.conn)?;
    let data = serde_json::json!({
        "expenses": expenses,
        "incomes": incomes,
    });
    let checksum = sha256_hex(&serde_json::to_vec(&data)?);
    let file = BackupFile {
        version: BACKUP_VERSION,
        app: APP_ID.to_string(),
        exported_at: crate::model::now_iso(),
        checksum,
        data,
    };
    // Write to a sibling temp file, then atomically rename, so a crash can
    // never leave a half-written backup that would later fail to restore.
    let tmp = path.with_extension("json.tmp");
    {
        let f = std::fs::File::create(&tmp)?;
        let mut w = std::io::BufWriter::new(f);
        serde_json::to_writer_pretty(&mut w, &file)?;
        w.flush()?;
        w.get_ref().sync_all().ok();
    }
    std::fs::rename(&tmp, path)?;
    let meta = std::fs::metadata(path)?;
    Ok(meta.len())
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let out = hasher.finalize();
    let mut s = String::with_capacity(out.len() * 2);
    for b in out {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

// ─── Import ──────────────────────────────────────────────────────────────────

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreReport {
    pub expenses_restored: usize,
    pub incomes_restored: usize,
    pub backup_path: Option<String>,
}

/// Restore a backup file. `confirmed` must be `true` — the caller (UI) is
/// responsible for showing the destructive-action warning first.
pub fn import_backup(
    store: &Store,
    path: &std::path::Path,
    confirmed: bool,
) -> Result<RestoreReport> {
    if !confirmed {
        return Err(AppError::RestoreNotConfirmed);
    }

    let raw = std::fs::read(path)?;
    let file: BackupFile = serde_json::from_slice(&raw)
        .map_err(|e| AppError::Validation(format!("Not a valid backup file: {e}")))?;
    if file.app != APP_ID {
        return Err(AppError::Validation(format!(
            "This backup was not created by {APP_ID}"
        )));
    }
    if file.version != BACKUP_VERSION {
        return Err(AppError::UnsupportedBackupVersion(file.version));
    }
    if sha256_hex(&serde_json::to_vec(&file.data)?) != file.checksum {
        return Err(AppError::ChecksumMismatch);
    }

    // Strict re-validation of every record before touching the database.
    let expenses: Vec<Expense> = serde_json::from_value::<Vec<serde_json::Value>>(
        file.data
            .get("expenses")
            .cloned()
            .ok_or_else(|| AppError::Validation("Backup is missing expenses".into()))?,
    )?
    .into_iter()
    .enumerate()
    .map(|(i, v)| {
        parse_expense_record(&v).map_err(|e| AppError::Validation(format!("Expense #{i}: {e}")))
    })
    .collect::<Result<Vec<_>>>()?;
    let incomes: Vec<Income> = serde_json::from_value::<Vec<serde_json::Value>>(
        file.data
            .get("incomes")
            .cloned()
            .ok_or_else(|| AppError::Validation("Backup is missing incomes".into()))?,
    )?
    .into_iter()
    .enumerate()
    .map(|(i, v)| {
        parse_income_record(&v).map_err(|e| AppError::Validation(format!("Income #{i}: {e}")))
    })
    .collect::<Result<Vec<_>>>()?;

    // Safety copy of the current state before we replace it.
    let bak = store.backup_file("pre-restore")?;

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

    Ok(RestoreReport {
        expenses_restored: expenses.len(),
        incomes_restored: incomes.len(),
        backup_path: bak.to_str().map(String::from),
    })
}

// ─── Strict record parsing (backup content is data, not trusted) ─────────────

fn get_str(v: &serde_json::Value, key: &str) -> std::result::Result<String, String> {
    v.get(key)
        .and_then(|x| x.as_str())
        .map(String::from)
        .ok_or_else(|| format!("missing field {key:?}"))
}

fn get_i64(v: &serde_json::Value, key: &str) -> std::result::Result<i64, String> {
    v.get(key)
        .and_then(|x| x.as_i64())
        .ok_or_else(|| format!("missing or non-integer field {key:?}"))
}

fn get_opt_i64(v: &serde_json::Value, key: &str) -> std::result::Result<Option<i64>, String> {
    match v.get(key) {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(x) => x
            .as_i64()
            .map(Some)
            .ok_or_else(|| format!("non-integer field {key:?}")),
    }
}

fn parse_expense_record(v: &serde_json::Value) -> std::result::Result<Expense, String> {
    let id = validation::parse_id(&get_str(v, "id")?).map_err(|e| e.to_string())?;
    let name = validation::clean_bounded(&get_str(v, "name")?, validation::NAME_MAX, "Name")
        .map_err(|e| e.to_string())?;
    let amount_cents = validation::validate_expense_cents(get_i64(v, "amountCents")?)
        .map_err(|e| e.to_string())?;
    let kind = Kind::parse(&get_str(v, "kind")?).map_err(|e| e.to_string())?;
    let responsible = Responsible::parse(&get_str(v, "responsible")?).map_err(|e| e.to_string())?;
    let joao_share =
        validation::validate_share(v.get("joaoShare").and_then(|x| x.as_f64()).unwrap_or(50.0))
            .map_err(|e| e.to_string())?;
    let month = validation::parse_month(&get_str(v, "month")?).map_err(|e| e.to_string())?;
    let due_date = match v.get("dueDate") {
        None | Some(serde_json::Value::Null) => None,
        Some(x) => Some(
            validation::parse_due_date(x.as_str().ok_or("dueDate must be text")?)
                .map_err(|e| e.to_string())?,
        ),
    };
    let notes = match v.get("notes") {
        None | Some(serde_json::Value::Null) => None,
        // Empty notes simply stay None (clean_notes maps "" → None).
        Some(x) => validation::clean_notes(Some(x.as_str().ok_or("notes must be text")?)),
    };
    Ok(Expense {
        id,
        name,
        amount_cents,
        kind,
        category: validation::normalize_category(&get_str(v, "category")?),
        responsible,
        joao_share,
        joao_paid_cents: get_opt_i64(v, "joaoPaidCents")?,
        anna_paid_cents: get_opt_i64(v, "annaPaidCents")?,
        due_date,
        paid: v.get("paid").and_then(|x| x.as_bool()).unwrap_or(false),
        notes,
        month,
        created_at: get_str(v, "createdAt").unwrap_or_default(),
        updated_at: get_str(v, "updatedAt").unwrap_or_default(),
    })
}

fn parse_income_record(v: &serde_json::Value) -> std::result::Result<Income, String> {
    let id = validation::parse_id(&get_str(v, "id")?).map_err(|e| e.to_string())?;
    let person = Person::parse(&get_str(v, "person")?).map_err(|e| e.to_string())?;
    let month = validation::parse_month(&get_str(v, "month")?).map_err(|e| e.to_string())?;
    let salary_cents =
        validation::validate_income_cents(get_i64(v, "salaryCents")?).map_err(|e| e.to_string())?;
    let meal_card_cents = validation::validate_income_cents(get_i64(v, "mealCardCents")?)
        .map_err(|e| e.to_string())?;
    Ok(Income {
        id,
        person,
        month,
        salary_cents,
        meal_card_cents,
        created_at: get_str(v, "createdAt").unwrap_or_default(),
        updated_at: get_str(v, "updatedAt").unwrap_or_default(),
    })
}

/// CSV export helper — every text cell goes through the formula-injection
/// sanitizer (`csv::sanitize_cell`).
pub fn export_csv(store: &Store, path: &std::path::Path, month: Option<&str>) -> Result<usize> {
    let expenses = match month {
        Some(m) => repo::list_expenses_by_month(&store.conn, m)?,
        None => repo::list_all_expenses(&store.conn)?,
    };

    let header = [
        "Month",
        "Name",
        "Amount",
        "Type",
        "Category",
        "Responsible",
        "João share %",
        "João paid",
        "Anna paid",
        "Due date",
        "Paid",
        "Notes",
    ];
    let mut rows: Vec<Vec<String>> = Vec::with_capacity(expenses.len());
    for e in &expenses {
        rows.push(vec![
            e.month.clone(),
            e.name.clone(),
            crate::money::format_eur(e.amount_cents, true),
            e.kind.as_str().to_string(),
            e.category.clone(),
            e.responsible.as_str().to_string(),
            if e.responsible == Responsible::Shared {
                format!("{:.1}", e.joao_share)
            } else {
                String::new()
            },
            e.joao_paid_cents
                .map(|c| crate::money::format_eur(c, true))
                .unwrap_or_default(),
            e.anna_paid_cents
                .map(|c| crate::money::format_eur(c, true))
                .unwrap_or_default(),
            e.due_date.clone().unwrap_or_default(),
            if e.paid { "yes" } else { "no" }.to_string(),
            e.notes.clone().unwrap_or_default(),
        ]);
    }
    let str_rows: Vec<Vec<&str>> = rows
        .iter()
        .map(|r| r.iter().map(String::as_str).collect())
        .collect();
    let doc = crate::csv::encode_document(&header, &str_rows);
    let tmp = path.with_extension("csv.tmp");
    std::fs::File::create(&tmp)?.write_all(doc.as_bytes())?;
    std::fs::rename(&tmp, path)?;
    Ok(expenses.len())
}
