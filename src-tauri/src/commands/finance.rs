//! `GET /api/finance` equivalent + database statistics.

use serde::Serialize;
use tauri::State;

use crate::db::Db;
use crate::ids::{current_month_key, current_utc_month_key};
use crate::summary::{compute_summary, FinanceResponse, IncomeCents};

#[derive(Debug, Serialize)]
pub struct MonthOnly {
    pub month: String,
}

/// Load all data for `month` (defaults to the current month), plus the
/// computed summary and every month that already has data.
#[tauri::command]
pub async fn finance_get(db: State<'_, Db>, month: Option<String>) -> Result<FinanceResponse, String> {
    let month = month
        .filter(|m| crate::ids::is_valid_month(m))
        .unwrap_or_else(current_month_key);

    // Move DB work off the async context.
    let conn = std::sync::Arc::clone(&db.conn);
    tauri::async_runtime::spawn_blocking(move || {
        let conn = conn.lock().map_err(|_| "Database is locked")?;

        let mut incomes: Vec<IncomeCents> = {
            let mut stmt = conn
                .prepare("SELECT id, person, month, amount_cents, meal_card_cents FROM income WHERE month = ?1")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([&month], |r| {
                    Ok(IncomeCents {
                        id: r.get(0)?,
                        person: r.get(1)?,
                        month: r.get(2)?,
                        amount_cents: r.get(3)?,
                        meal_card_cents: r.get(4)?,
                        created_at: None,
                        updated_at: None,
                    })
                })
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
        };
        incomes.sort_by(|a, b| a.person.cmp(&b.person));

        let mut expenses: Vec<crate::summary::ExpenseCents> = {
            let mut stmt = conn
                .prepare(
                    "SELECT id, name, amount_cents, kind, category, responsible, joao_share,
                            joao_paid_cents, anna_paid_cents, due_date, paid, notes, month
                     FROM expense WHERE month = ?1",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([&month], crate::db::row_to_expense)
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
        };

        // Same ordering as the web API: by due date (when present), then name.
        expenses.sort_by(|a, b| match (&a.due_date, &b.due_date) {
            (Some(da), Some(db)) => {
                if da != db {
                    da.cmp(db)
                } else {
                    name_key(&a.name).cmp(&name_key(&b.name))
                }
            }
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => name_key(&a.name).cmp(&name_key(&b.name)),
        });

        // Distinct months across both tables + the current month.
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
        months.push(current_month_key());
        months.sort();
        months.dedup();

        let summary = compute_summary(&expenses, &incomes);
        Ok(FinanceResponse {
            month,
            incomes: incomes.iter().map(|i| i.to_record()).collect(),
            expenses: expenses.iter().map(|e| e.to_record()).collect(),
            available_months: months,
            summary,
            meta: crate::summary::MetaToday {
                today: current_utc_month_key(),
            },
        })
    })
    .await
    .map_err(|e| format!("Task failed: {e}"))?
}

/// Case-insensitive, accent-sensitive name key for stable ordering
/// (approximates JS `localeCompare` for the names used here).
fn name_key(name: &str) -> String {
    name.trim().to_lowercase()
}

/// Counts used by the first-run legacy-data import dialog.
#[tauri::command]
pub async fn db_stats(db: State<'_, Db>) -> Result<crate::models::DbStats, String> {
    let conn = std::sync::Arc::clone(&db.conn);
    tauri::async_runtime::spawn_blocking(move || {
        let conn = conn.lock().map_err(|_| "Database is locked")?;
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
        Ok(crate::models::DbStats { incomes, expenses, months })
    })
    .await
    .map_err(|e| format!("Task failed: {e}"))?
}
