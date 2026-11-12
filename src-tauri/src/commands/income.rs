//! `POST /api/income` equivalent — create or update a person's monthly
//! salary and meal card (upsert by person+month, omitted fields kept).

use tauri::State;

use crate::db::Db;
use crate::ids::{current_month_key, is_valid_month, new_id, now_rfc3339};
use crate::models::{IncomeEnvelope, IncomeRecord};
use crate::models::json_to_f64;
use crate::validate::{from_cents, to_cents};

#[tauri::command]
pub async fn income_set(
    db: State<'_, Db>,
    person: Option<String>,
    month: Option<String>,
    amount: Option<serde_json::Value>,
    meal_card: Option<serde_json::Value>,
) -> Result<IncomeEnvelope, String> {
    let person = match person.as_deref() {
        Some("joao") | Some("anna") => person.unwrap(),
        _ => return Err("Invalid person".to_string()),
    };
    let month = month
        .filter(|m| is_valid_month(m))
        .unwrap_or_else(current_month_key);

    // hasAmount / hasMealCard follow the web API: present and not null.
    let has_amount = amount.as_ref().map(|v| !v.is_null()).unwrap_or(false);
    let has_meal = meal_card.as_ref().map(|v| !v.is_null()).unwrap_or(false);
    if !has_amount && !has_meal {
        return Err("Provide amount or mealCard".to_string());
    }

    // parseField: JS `Number(raw)` semantics (numbers and numeric strings),
    // finite, 0..=100_000_000, rounded to cents.
    let parse_field = |raw: Option<serde_json::Value>| -> Result<Option<i64>, String> {
        match raw {
            Some(v) if !v.is_null() => match json_to_f64(Some(&v)) {
                Some(f) if f >= 0.0 && f <= 100_000_000.0 => Ok(Some(to_cents(f))),
                _ => Err("invalid".to_string()),
            },
            _ => Ok(None),
        }
    };

    let new_amount = parse_field(amount).map_err(|_| "Invalid amount".to_string());
    let new_meal = parse_field(meal_card).map_err(|_| "Invalid mealCard".to_string());

    let conn = std::sync::Arc::clone(&db.conn);
    tauri::async_runtime::spawn_blocking(move || {
        let new_amount = new_amount?;
        let new_meal = new_meal?;
        let conn = conn.lock().map_err(|_| "Database is locked")?;

        let existing: Option<(String, i64, i64, String)> = conn
            .query_row(
                "SELECT id, amount_cents, meal_card_cents, created_at FROM income
                 WHERE person = ?1 AND month = ?2",
                [&person, &month],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .ok();

        let now = now_rfc3339();
        let (id, amount_cents, meal_cents, created_at) = match existing {
            Some((id, a, m, created)) => (
                id,
                if has_amount { new_amount.unwrap_or(a) } else { a },
                if has_meal { new_meal.unwrap_or(m) } else { m },
                created,
            ),
            None => (
                new_id(),
                new_amount.unwrap_or(0),
                new_meal.unwrap_or(0),
                now.clone(),
            ),
        };

        conn.execute(
            "INSERT INTO income (id, person, month, amount_cents, meal_card_cents, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7)
             ON CONFLICT(person, month) DO UPDATE SET
                amount_cents = excluded.amount_cents,
                meal_card_cents = excluded.meal_card_cents,
                updated_at = excluded.updated_at",
            rusqlite::params![id, person, month, amount_cents, meal_cents, created_at, now],
        )
        .map_err(|e| e.to_string())?;

        Ok(IncomeEnvelope {
            income: IncomeRecord {
                id,
                person,
                month,
                amount: from_cents(amount_cents),
                meal_card: from_cents(meal_cents),
            },
        })
    })
    .await
    .map_err(|e| format!("Task failed: {e}"))?
}
