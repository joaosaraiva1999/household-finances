//! CRUD commands for expenses — exact ports of POST/PATCH/DELETE
//! `/api/expenses` including the shared-split normalization and the
//! rescale-on-amount-change behaviour.

use tauri::State;

use crate::db::Db;
use crate::ids::{new_id, now_rfc3339};
use crate::models::*;
use crate::summary::ExpenseCents;
use crate::validate::*;

// ─── POST /api/expenses ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn expense_create(
    db: State<'_, Db>,
    payload: ExpenseInput,
) -> Result<ExpenseEnvelope, String> {
    let clean = sanitize_create(&payload)?;

    let conn = std::sync::Arc::clone(&db.conn);
    tauri::async_runtime::spawn_blocking(move || {
        let conn = conn.lock().map_err(|_| "Database is locked")?;

        // Guard against accidental duplicate entries (desktop-only rule).
        let dupe: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM expense
                 WHERE month = ?1 AND LOWER(TRIM(name)) = LOWER(?2)
                   AND amount_cents = ?3 AND kind = ?4",
                rusqlite::params![clean.month, clean.name, clean.amount_cents, clean.kind],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if dupe > 0 {
            return Err("Já existe uma entrada idêntica neste mês".to_string());
        }

        let id = new_id();
        let now = now_rfc3339();
        conn.execute(
            "INSERT INTO expense
                 (id, name, amount_cents, kind, category, responsible, joao_share,
                  joao_paid_cents, anna_paid_cents, due_date, paid, notes, month,
                  created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)",
            rusqlite::params![
                id,
                clean.name,
                clean.amount_cents,
                clean.kind,
                clean.category,
                clean.responsible,
                clean.joao_share,
                clean.joao_paid_cents,
                clean.anna_paid_cents,
                clean.due_date,
                clean.paid as i64,
                clean.notes,
                clean.month,
                now,
                now,
            ],
        )
        .map_err(|e| e.to_string())?;

        fetch_expense(&conn, &id).map(|e| ExpenseEnvelope { expense: e.to_record() })
    })
    .await
    .map_err(|e| format!("Task failed: {e}"))?
}

// ─── PATCH /api/expenses/:id ────────────────────────────────────────────────

#[tauri::command]
pub async fn expense_update(
    db: State<'_, Db>,
    id: String,
    payload: ExpensePatch,
) -> Result<ExpenseEnvelope, String> {
    let conn = std::sync::Arc::clone(&db.conn);
    tauri::async_runtime::spawn_blocking(move || {
        let conn = conn.lock().map_err(|_| "Database is locked")?;
        let existing = fetch_expense(&conn, &id)?;

        // Accumulates "SET col = value" fragments and their bound values.
        let mut sets: Vec<(&'static str, serde_json::Value)> = Vec::new();

        // name — String(body.name) semantics, exactly like the web API.
        if payload.name.is_some() {
            let name = json_to_string(payload.name.as_ref()).trim().to_string();
            if name.is_empty() {
                return Err("Name is required".to_string());
            }
            let name: String = name.chars().take(120).collect();
            sets.push(("name", serde_json::Value::String(name)));
        }

        // amount
        let mut amount_cents: Option<i64> = None;
        if payload.amount.is_some() {
            let raw = json_to_f64(payload.amount.as_ref()).ok_or("Invalid amount")?;
            if raw <= 0.0 || raw > 10_000_000.0 {
                return Err("Invalid amount".to_string());
            }
            let cents = to_cents(raw);
            amount_cents = Some(cents);
            sets.push(("amount_cents", serde_json::Value::from(cents)));
        }

        // kind
        let mut kind: Option<String> = None;
        if payload.kind.is_some() {
            let k = json_to_string(payload.kind.as_ref());
            if !KINDS.contains(&k.as_str()) {
                return Err("Invalid entry type".to_string());
            }
            kind = Some(k.clone());
            sets.push(("kind", serde_json::Value::String(k)));
        }

        // responsible
        let mut responsible: Option<String> = None;
        if payload.responsible.is_some() {
            let r = json_to_string(payload.responsible.as_ref());
            if !RESPONSIBLES.contains(&r.as_str()) {
                return Err("Invalid responsible".to_string());
            }
            responsible = Some(r.clone());
            sets.push(("responsible", serde_json::Value::String(r)));
        }

        // joaoShare — applies when share or responsible is being touched.
        if payload.joao_share.is_some() || responsible.is_some() {
            let eff_responsible =
                responsible.clone().unwrap_or_else(|| existing.responsible.clone());
            if eff_responsible != "shared" {
                let share = if eff_responsible == "joao" { 100.0 } else { 0.0 };
                sets.push(("joao_share", serde_json::Value::from(share)));
            } else {
                // JS: Number(body.joaoShare ?? existing.joaoShare)
                let raw = match payload.joao_share.as_ref() {
                    None | Some(serde_json::Value::Null) => Some(existing.joao_share),
                    Some(v) => json_to_f64(Some(v)),
                };
                // PATCH order: clamp first, then round to 1 decimal.
                let share = match raw {
                    Some(v) if v.is_finite() => v.clamp(0.0, 100.0),
                    _ => 50.0,
                };
                let share = (share * 10.0).round() / 10.0;
                sets.push(("joao_share", serde_json::Value::from(share)));
            }
        }

        // category
        if payload.category.is_some() {
            let c = json_to_string(payload.category.as_ref());
            let c = if CATEGORIES.contains(&c.as_str()) { c } else { "Other".to_string() };
            sets.push(("category", serde_json::Value::String(c)));
        }

        // dueDate — any non-string or malformed value clears the field.
        if payload.due_date.is_some() {
            let due = json_as_string(payload.due_date.as_ref())
                .filter(|d| is_iso_date(d))
                .map(str::to_string);
            sets.push(("due_date", serde_json::Value::from(due)));
        }

        // paid
        if payload.paid.is_some() {
            let paid = json_truthy(payload.paid.as_ref());
            sets.push(("paid", serde_json::Value::from(paid)));
        }

        // notes
        if payload.notes.is_some() {
            let notes = json_as_string(payload.notes.as_ref())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(|s| s.chars().take(500).collect::<String>());
            sets.push(("notes", serde_json::Value::from(notes)));
        }

        // ─── Per-person paid amounts (shared bills, money out) ──────────
        let eff_amount = amount_cents.unwrap_or(existing.amount_cents);
        let eff_responsible =
            responsible.clone().unwrap_or_else(|| existing.responsible.clone());
        let eff_kind = kind.clone().unwrap_or_else(|| existing.kind.clone());

        if eff_responsible == "shared" && eff_kind == "expense" {
            let raw_joao = payload
                .joao_paid
                .as_ref()
                .filter(|v| !v.is_null())
                .and_then(|v| json_to_f64(Some(v)));
            let raw_anna = payload
                .anna_paid
                .as_ref()
                .filter(|v| !v.is_null())
                .and_then(|v| json_to_f64(Some(v)));

            if let Some((j, a)) = normalize_paid_split(eff_amount, raw_joao, raw_anna) {
                sets.push(("joao_paid_cents", serde_json::Value::from(j)));
                sets.push(("anna_paid_cents", serde_json::Value::from(a)));
                sets.push((
                    "joao_share",
                    serde_json::Value::from(share_percent_from_paid(j, eff_amount)),
                ));
            } else if amount_cents.is_some()
                && existing.joao_paid_cents.is_some()
                && existing.anna_paid_cents.is_some()
            {
                // Amount changed without new paid values: rescale the stored
                // split proportionally so both amounts still add up.
                // JS: round2((existing.joaoPaid / existing.amount) * effAmount)
                // → in cents: Math.round((j_c / a_total_c) * eff_c).
                let old_j = existing.joao_paid_cents.unwrap() as f64;
                let old_total =
                    (existing.joao_paid_cents.unwrap() + existing.anna_paid_cents.unwrap()) as f64;
                let scaled = if old_total > 0.0 {
                    (old_j / old_total * eff_amount as f64).round() as i64
                } else {
                    0
                };
                if let Some((j, a)) = normalize_paid_split(eff_amount, Some(scaled as f64), None) {
                    sets.push(("joao_paid_cents", serde_json::Value::from(j)));
                    sets.push(("anna_paid_cents", serde_json::Value::from(a)));
                    sets.push((
                        "joao_share",
                        serde_json::Value::from(share_percent_from_paid(j, eff_amount)),
                    ));
                }
            }
        } else if (responsible.is_some() || kind.is_some())
            && (existing.joao_paid_cents.is_some() || existing.anna_paid_cents.is_some())
        {
            // Attribution changed away from "shared" or became a credit.
            sets.push(("joao_paid_cents", serde_json::Value::Null));
            sets.push(("anna_paid_cents", serde_json::Value::Null));
        }

        // Dynamic UPDATE (web API always bumps updated_at even on no-op).
        let now = now_rfc3339();
        let mut sql = String::from("UPDATE expense SET ");
        sql.push_str(
            &sets
                .iter()
                .map(|(col, _)| format!("{col} = ?"))
                .collect::<Vec<_>>()
                .join(", "),
        );
        sql.push_str(", updated_at = ? WHERE id = ?");

        let mut bindings: Vec<rusqlite::types::Value> = sets
            .iter()
            .map(|(_, v)| serde_json_to_sqlite(v))
            .collect();
        bindings.push(rusqlite::types::Value::Text(now));
        bindings.push(rusqlite::types::Value::Text(id.clone()));

        conn.execute(&sql, rusqlite::params_from_iter(bindings.iter()))
            .map_err(|e| e.to_string())?;

        let updated = fetch_expense(&conn, &id)?;
        Ok(ExpenseEnvelope { expense: updated.to_record() })
    })
    .await
    .map_err(|e| format!("Task failed: {e}"))?
}

// ─── DELETE /api/expenses/:id ───────────────────────────────────────────────

#[tauri::command]
pub async fn expense_delete(db: State<'_, Db>, id: String) -> Result<OkEnvelope, String> {
    let conn = std::sync::Arc::clone(&db.conn);
    tauri::async_runtime::spawn_blocking(move || {
        let conn = conn.lock().map_err(|_| "Database is locked")?;
        let exists: i64 = conn
            .query_row("SELECT COUNT(*) FROM expense WHERE id = ?1", [&id], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if exists == 0 {
            return Err("Expense not found".to_string());
        }
        conn.execute("DELETE FROM expense WHERE id = ?1", [&id])
            .map_err(|e| e.to_string())?;
        Ok(OkEnvelope { ok: true })
    })
    .await
    .map_err(|e| format!("Task failed: {e}"))?
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

pub fn fetch_expense(conn: &rusqlite::Connection, id: &str) -> Result<ExpenseCents, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, amount_cents, kind, category, responsible, joao_share,
                    joao_paid_cents, anna_paid_cents, due_date, paid, notes, month
             FROM expense WHERE id = ?1",
        )
        .map_err(|e| e.to_string())?;
    stmt.query_row([id], crate::db::row_to_expense)
        .map_err(|_| "Expense not found".to_string())
}

fn serde_json_to_sqlite(v: &serde_json::Value) -> rusqlite::types::Value {
    match v {
        serde_json::Value::Null => rusqlite::types::Value::Null,
        serde_json::Value::Bool(b) => rusqlite::types::Value::Integer(*b as i64),
        serde_json::Value::Number(n) => n
            .as_i64()
            .map(rusqlite::types::Value::Integer)
            .unwrap_or(rusqlite::types::Value::Real(n.as_f64().unwrap_or(0.0))),
        serde_json::Value::String(s) => rusqlite::types::Value::Text(s.clone()),
        other => rusqlite::types::Value::Text(other.to_string()),
    }
}
