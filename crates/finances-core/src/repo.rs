//! All SQL lives here. **Invariant:** every statement is a compile-time
//! literal; user data reaches SQLite exclusively through bound parameters.
//! There must be no `format!`, `push_str` or string concatenation building
//! SQL from data — the injection test-suite (`tests/sql_injection.rs`)
//! guards this.

use rusqlite::params;

use crate::error::{map_constraint, AppError, Result};
use crate::model::{
    days_from_civil, Expense, ExpensePatch, Income, IncomeUpsert, NewExpense,
};
use crate::validation::{self, Kind, Person, Responsible};

// ─── Mapping ─────────────────────────────────────────────────────────────────

fn expense_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Expense> {
    Ok(Expense {
        id: row.get("id")?,
        name: row.get("name")?,
        amount_cents: row.get("amount_cents")?,
        kind: Kind::parse(&row.get::<_, String>("kind")?)
            .map_err(|e| rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e)))?,
        category: row.get("category")?,
        responsible: Responsible::parse(&row.get::<_, String>("responsible")?)
            .map_err(|e| rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e)))?,
        joao_share: row.get("joao_share")?,
        joao_paid_cents: row.get("joao_paid_cents")?,
        anna_paid_cents: row.get("anna_paid_cents")?,
        due_date: row.get("due_date")?,
        paid: row.get::<_, i64>("paid")? != 0,
        notes: row.get("notes")?,
        month: row.get("month")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn income_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Income> {
    Ok(Income {
        id: row.get("id")?,
        person: Person::parse(&row.get::<_, String>("person")?)
            .map_err(|e| rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e)))?,
        month: row.get("month")?,
        salary_cents: row.get("salary_cents")?,
        meal_card_cents: row.get("meal_card_cents")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

const EXPENSE_COLS: &str = "id, name, amount_cents, kind, category, responsible, \
     joao_share, joao_paid_cents, anna_paid_cents, due_date, paid, notes, month, \
     created_at, updated_at";

// ─── Expenses ────────────────────────────────────────────────────────────────

/// Insert a new expense. The input must already be validated (the command
/// layer does this); CHECK constraints re-validate at the DB level.
pub fn insert_expense(conn: &rusqlite::Connection, e: &NewExpense) -> Result<Expense> {
    let id = crate::model::new_id();
    conn.execute(
        "INSERT INTO expenses
             (id, name, amount_cents, kind, category, responsible,
              joao_share, joao_paid_cents, anna_paid_cents, due_date, paid,
              notes, month, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14)",
        params![
            id,
            e.name,
            e.amount_cents,
            e.kind.as_str(),
            e.category,
            e.responsible.as_str(),
            e.joao_share,
            e.joao_paid_cents,
            e.anna_paid_cents,
            e.due_date,
            e.paid as i64,
            e.notes,
            e.month,
            crate::model::now_iso(),
        ],
    )
    .map_err(|err| map_constraint(err, "Invalid expense data"))?;
    get_expense(conn, &id)?.ok_or_else(|| AppError::NotFound("expense".into()))
}

/// Validate a [`NewExpense`] end-to-end (text bounds, enums, calendar dates,
/// amount ranges, split consistency) before persistence.
pub fn validate_new_expense(e: &NewExpense) -> Result<NewExpense> {
    let name = validation::clean_bounded(&e.name, validation::NAME_MAX, "Name")?;
    let amount_cents = validation::validate_expense_cents(e.amount_cents)?;
    validation::parse_month(&e.month)?;
    let category = validation::normalize_category(&e.category);
    if let Some(due) = &e.due_date {
        validation::parse_due_date(due)?;
        // due date must fall inside the expense's month
        if !due.starts_with(&format!("{}-", e.month)) {
            return Err(AppError::Validation(
                "Due date must fall inside the expense month".to_string(),
            ));
        }
    }
    let joao_share = validation::validate_share(e.joao_share)?;
    let mut out = e.clone();
    out.name = name;
    out.amount_cents = amount_cents;
    out.category = category;
    out.joao_share = joao_share;
    out.notes = validation::clean_notes(e.notes.as_deref());
    out.due_date = e.due_date.clone();

    // Split consistency: per-person paid amounts only apply to shared bills.
    if out.responsible != Responsible::Shared || out.kind != Kind::Expense {
        out.joao_paid_cents = None;
        out.anna_paid_cents = None;
        out.joao_share = match out.responsible {
            Responsible::Joao => 100.0,
            Responsible::Anna => 0.0,
            Responsible::Shared => out.joao_share,
        };
    } else if let Some(j) = out.joao_paid_cents {
        let j = j.clamp(0, out.amount_cents);
        out.joao_paid_cents = Some(j);
        out.anna_paid_cents = Some(out.amount_cents - j);
        out.joao_share = share_percent_from_paid(j, out.amount_cents);
    } else if let Some(a) = out.anna_paid_cents {
        let a = a.clamp(0, out.amount_cents);
        out.anna_paid_cents = Some(a);
        out.joao_paid_cents = Some(out.amount_cents - a);
        out.joao_share = share_percent_from_paid(out.amount_cents - a, out.amount_cents);
    }
    Ok(out)
}

/// Percentage share implied by a paid amount (rounded to 0.1) — mirrors
/// `sharePercentFromPaid`.
#[must_use]
pub fn share_percent_from_paid(joao_cents: i64, amount_cents: i64) -> f64 {
    if amount_cents <= 0 {
        return 50.0;
    }
    ((joao_cents as f64 / amount_cents as f64) * 1000.0).round() / 10.0
}

/// Fetch one expense by id.
pub fn get_expense(conn: &rusqlite::Connection, id: &str) -> Result<Option<Expense>> {
    let id = validation::parse_id(id)?;
    let sql = format!("SELECT {EXPENSE_COLS} FROM expenses WHERE id = ?1");
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query_map(params![id], expense_from_row)?;
    Ok(rows.next().transpose()?)
}

/// List all expenses of a month, sorted like the web API
/// (due date first, then name).
pub fn list_expenses_by_month(
    conn: &rusqlite::Connection,
    month: &str,
) -> Result<Vec<Expense>> {
    let month = validation::parse_month(month)?;
    let sql = format!(
        "SELECT {EXPENSE_COLS} FROM expenses WHERE month = ?1 \
         ORDER BY (due_date IS NULL), due_date, name COLLATE NOCASE"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![month], expense_from_row)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// Delete an expense; returns `true` when a row was removed.
pub fn delete_expense(conn: &rusqlite::Connection, id: &str) -> Result<bool> {
    let id = validation::parse_id(id)?;
    let n = conn
        .execute("DELETE FROM expenses WHERE id = ?1", params![id])
        .map_err(AppError::Db)?;
    Ok(n > 0)
}

/// Apply a patch with the exact semantics of the web `PATCH /api/expenses/[id]`
/// route (including the paid-split rescale when the amount changes).
/// Returns the updated record, or `None` when the id does not exist.
pub fn update_expense(
    conn: &rusqlite::Connection,
    id: &str,
    patch: &ExpensePatch,
) -> Result<Option<Expense>> {
    let id = validation::parse_id(id)?;
    if patch.is_empty() {
        return Err(AppError::Validation(
            "Provide at least one field to update".to_string(),
        ));
    }
    let existing = get_expense(conn, &id)?.ok_or(AppError::NotFound("expense".into()))?;

    // Validate the incoming pieces first.
    let name = patch
        .name
        .as_ref()
        .map(|n| validation::clean_bounded(n, validation::NAME_MAX, "Name"))
        .transpose()?;
    let amount_cents = patch
        .amount_cents
        .map(validation::validate_expense_cents)
        .transpose()?;
    if let Some(due) = &patch.due_date {
        if let Some(due) = due {
            validation::parse_due_date(due)?;
        }
    }
    let category = patch.category.as_ref().map(|c| validation::normalize_category(c));

    let mut out = existing.clone();
    if let Some(v) = name {
        out.name = v;
    }
    if let Some(v) = amount_cents {
        out.amount_cents = v;
    }
    if let Some(v) = patch.kind {
        out.kind = v;
    }
    if let Some(v) = patch.responsible {
        out.responsible = v;
    }
    if let Some(v) = category {
        out.category = v;
    }
    if let Some(v) = patch.joao_share {
        out.joao_share = validation::validate_share(v)?;
    }
    if let Some(v) = &patch.due_date {
        out.due_date = v.clone();
    }
    if let Some(v) = patch.paid {
        out.paid = v;
    }
    if let Some(v) = &patch.notes {
        out.notes = v.as_deref().and_then(|s| validation::clean_notes(Some(s)));
    }

    // ─── Share & paid-split reconciliation (mirrors the web route) ────────
    let responsible_changed = patch.responsible.is_some();
    let kind_changed = patch.kind.is_some();

    if out.responsible != Responsible::Shared || out.kind != Kind::Expense {
        if responsible_changed || kind_changed {
            // Attribution changed away from "shared" or the entry became a
            // credit: paid amounts no longer apply.
            out.joao_paid_cents = None;
            out.anna_paid_cents = None;
        }
        if out.responsible != Responsible::Shared {
            out.joao_share = if out.responsible == Responsible::Joao { 100.0 } else { 0.0 };
        }
    } else {
        // shared + money-out
        let provided_joao = patch.joao_paid_cents.as_ref().and_then(|o| o.as_ref());
        let provided_anna = patch.anna_paid_cents.as_ref().and_then(|o| o.as_ref());
        let amount_changed = patch.amount_cents.is_some();

        if provided_joao.is_some() || provided_anna.is_some() {
            let (j, a) = normalize_paid_split(
                out.amount_cents,
                provided_joao.copied(),
                provided_anna.copied(),
            );
            out.joao_paid_cents = Some(j);
            out.anna_paid_cents = Some(a);
            out.joao_share = share_percent_from_paid(j, out.amount_cents);
        } else if amount_changed {
            match (existing.joao_paid_cents, existing.anna_paid_cents) {
                (Some(old_j), Some(_)) => {
                    let scaled = scale_paid(old_j, existing.amount_cents, out.amount_cents);
                    let (j, a) = normalize_paid_split(out.amount_cents, Some(scaled), None);
                    out.joao_paid_cents = Some(j);
                    out.anna_paid_cents = Some(a);
                    out.joao_share = share_percent_from_paid(j, out.amount_cents);
                }
                _ => {
                    out.joao_paid_cents = None;
                    out.anna_paid_cents = None;
                }
            }
        }
    }

    let now = crate::model::now_iso();
    conn.execute(
        "UPDATE expenses SET
             name = ?1, amount_cents = ?2, kind = ?3, category = ?4,
             responsible = ?5, joao_share = ?6, joao_paid_cents = ?7,
             anna_paid_cents = ?8, due_date = ?9, paid = ?10, notes = ?11,
             updated_at = ?12
         WHERE id = ?13",
        params![
            out.name,
            out.amount_cents,
            out.kind.as_str(),
            out.category,
            out.responsible.as_str(),
            out.joao_share,
            out.joao_paid_cents,
            out.anna_paid_cents,
            out.due_date,
            out.paid as i64,
            out.notes,
            now,
            id,
        ],
    )
    .map_err(|err| map_constraint(err, "Invalid expense update"))?;
    get_expense(conn, &id)
}

/// How much of an expense is borne by `person` in cents — mirrors
/// `personShare` in `src/lib/finance.ts` exactly.
#[must_use]
pub fn person_share_cents(e: &Expense, person: Person) -> i64 {
    let attributed = matches!(
        (e.responsible, person),
        (Responsible::Joao, Person::Joao) | (Responsible::Anna, Person::Anna)
    );
    if e.responsible == Responsible::Shared {
        if e.kind == Kind::Expense {
            if let (Some(j), Some(a)) = (e.joao_paid_cents, e.anna_paid_cents) {
                return if person == Person::Joao { j } else { a };
            }
        }
        let share = if person == Person::Joao {
            e.joao_share
        } else {
            100.0 - e.joao_share
        };
        // round2(euros * share / 100) == round(cents * share / 100)
        ((e.amount_cents as f64 * share / 100.0).round()) as i64
    } else if attributed {
        e.amount_cents
    } else {
        0
    }
}

/// Keep the provided amount for one person; the other covers the remainder.
/// Mirrors `normalizePaidSplit` (integer-cents variant).
#[must_use]
pub fn normalize_paid_split(
    amount_cents: i64,
    joao: Option<i64>,
    anna: Option<i64>,
) -> (i64, i64) {
    if amount_cents <= 0 {
        return (0, 0);
    }
    if let Some(j) = joao {
        let j = j.clamp(0, amount_cents);
        return (j, amount_cents - j);
    }
    if let Some(a) = anna {
        let a = a.clamp(0, amount_cents);
        return (amount_cents - a, a);
    }
    ((amount_cents + 1) / 2, amount_cents / 2) // unreachable guard: 50/50
}

fn scale_paid(old_joao: i64, old_amount: i64, new_amount: i64) -> i64 {
    if old_amount == 0 {
        return 0;
    }
    ((old_joao as f64 / old_amount as f64) * new_amount as f64).round() as i64
}

// ─── Income ──────────────────────────────────────────────────────────────────

/// Create or update a person's monthly income. `None` fields keep their
/// current value (or 0 on create).
pub fn upsert_income(
    conn: &rusqlite::Connection,
    input: &IncomeUpsert,
) -> Result<Income> {
    validation::parse_month(&input.month)?;
    let salary = match input.salary_cents {
        Some(v) => validation::validate_income_cents(v)?,
        None => {
            existing_field(conn, &input.person, &input.month, "salary_cents")?.unwrap_or(0)
        }
    };
    let meal = match input.meal_card_cents {
        Some(v) => validation::validate_income_cents(v)?,
        None => {
            existing_field(conn, &input.person, &input.month, "meal_card_cents")?.unwrap_or(0)
        }
    };

    let changed = conn
        .execute(
            "INSERT INTO incomes (id, person, month, salary_cents, meal_card_cents, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
             ON CONFLICT(person, month) DO UPDATE SET
                 salary_cents = excluded.salary_cents,
                 meal_card_cents = excluded.meal_card_cents,
                 updated_at = excluded.updated_at",
            params![
                crate::model::new_id(),
                input.person.as_str(),
                input.month,
                salary,
                meal,
                crate::model::now_iso(),
            ],
        )
        .map_err(|err| map_constraint(err, "Invalid income data"))?;
    debug_assert!(changed == 1);

    let sql = "SELECT id, person, month, salary_cents, meal_card_cents, created_at, updated_at \
               FROM incomes WHERE person = ?1 AND month = ?2";
    let mut stmt = conn.prepare(sql)?;
    let mut rows = stmt.query_map(params![input.person.as_str(), input.month], income_from_row)?;
    Ok(rows.next().transpose()?.ok_or_else(|| AppError::NotFound("income".into()))?)
}

fn existing_field(
    conn: &rusqlite::Connection,
    person: &Person,
    month: &str,
    column: &str,
) -> Result<Option<i64>> {
    // `column` is a compile-time caller constant (never user data); the value
    // is bound as a parameter.
    let sql = match column {
        "salary_cents" => {
            "SELECT salary_cents FROM incomes WHERE person = ?1 AND month = ?2"
        }
        "meal_card_cents" => {
            "SELECT meal_card_cents FROM incomes WHERE person = ?1 AND month = ?2"
        }
        _ => return Err(AppError::Validation("Unknown column".to_string())),
    };
    let mut stmt = conn.prepare(sql)?;
    let mut rows = stmt.query_map(params![person.as_str(), month], |r| r.get::<_, i64>(0))?;
    Ok(rows.next().transpose()?)
}

/// List incomes of a month.
pub fn list_incomes_by_month(
    conn: &rusqlite::Connection,
    month: &str,
) -> Result<Vec<Income>> {
    let month = validation::parse_month(month)?;
    let mut stmt = conn.prepare(
        "SELECT id, person, month, salary_cents, meal_card_cents, created_at, updated_at \
         FROM incomes WHERE month = ?1 ORDER BY person",
    )?;
    let rows = stmt.query_map(params![month], income_from_row)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// Every expense ever stored (all months) — backup export.
pub fn list_all_expenses(conn: &rusqlite::Connection) -> Result<Vec<Expense>> {
    let sql = format!(
        "SELECT {EXPENSE_COLS} FROM expenses ORDER BY month, (due_date IS NULL), due_date, id"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], expense_from_row)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// Every income ever stored (all months) — backup export.
pub fn list_all_incomes(conn: &rusqlite::Connection) -> Result<Vec<Income>> {
    let mut stmt = conn.prepare(
        "SELECT id, person, month, salary_cents, meal_card_cents, created_at, updated_at \
         FROM incomes ORDER BY month, person",
    )?;
    let rows = stmt.query_map([], income_from_row)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// Insert a fully-formed record **preserving id and timestamps** — used by
/// backup restore and legacy migration, never by user-facing create.
/// Must be called inside an open transaction.
pub fn restore_expense_tx(conn: &rusqlite::Connection, e: &Expense) -> Result<()> {
    conn.execute(
        "INSERT INTO expenses
             (id, name, amount_cents, kind, category, responsible,
              joao_share, joao_paid_cents, anna_paid_cents, due_date, paid,
              notes, month, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
        params![
            e.id,
            e.name,
            e.amount_cents,
            e.kind.as_str(),
            e.category,
            e.responsible.as_str(),
            e.joao_share,
            e.joao_paid_cents,
            e.anna_paid_cents,
            e.due_date,
            e.paid as i64,
            e.notes,
            e.month,
            e.created_at,
            e.updated_at,
        ],
    )
    .map_err(|err| map_constraint(err, "Invalid expense record in backup"))?;
    Ok(())
}

/// Insert a fully-formed income record preserving id/timestamps.
/// Must be called inside an open transaction.
pub fn restore_income_tx(conn: &rusqlite::Connection, i: &Income) -> Result<()> {
    conn.execute(
        "INSERT INTO incomes
             (id, person, month, salary_cents, meal_card_cents, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            i.id,
            i.person.as_str(),
            i.month,
            i.salary_cents,
            i.meal_card_cents,
            i.created_at,
            i.updated_at,
        ],
    )
    .map_err(|err| map_constraint(err, "Invalid income record in backup"))?;
    Ok(())
}

/// Count rows (used by migration idempotency and restore sanity checks).
pub fn count_expenses(conn: &rusqlite::Connection) -> Result<i64> {
    Ok(conn.query_row("SELECT COUNT(*) FROM expenses", [], |r| r.get(0))?)
}

/// Count income rows.
pub fn count_incomes(conn: &rusqlite::Connection) -> Result<i64> {
    Ok(conn.query_row("SELECT COUNT(*) FROM incomes", [], |r| r.get(0))?)
}

/// All months that already hold data (either table), sorted ascending.
pub fn available_months(conn: &rusqlite::Connection) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT DISTINCT month FROM expenses
         UNION
         SELECT DISTINCT month FROM incomes
         ORDER BY 1",
    )?;
    let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

// ─── Summary (mirror of computeSummary) ──────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonBreakdown {
    pub salary_cents: i64,
    pub meal_card_cents: i64,
    pub credits_cents: i64,
    pub income_cents: i64,
    pub personal_expenses_cents: i64,
    pub shared_expenses_cents: i64,
    pub total_expenses_cents: i64,
    pub available_cents: i64,
    pub committed_pct: i64,
    pub paid_amount_cents: i64,
    pub unpaid_amount_cents: i64,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HouseholdSummary {
    pub joao: PersonBreakdown,
    pub anna: PersonBreakdown,
    pub total_income_cents: i64,
    pub total_expenses_cents: i64,
    pub total_available_cents: i64,
    pub paid_expenses_cents: i64,
    pub unpaid_expenses_cents: i64,
    pub unpaid_count: usize,
    pub paid_count: usize,
    pub expense_count: usize,
    pub upcoming: Vec<Expense>,
    pub overdue: Vec<Expense>,
}

fn breakdown_for(expenses: &[Expense], person: Person, income: Option<&Income>) -> PersonBreakdown {
    let salary = income.map(|i| i.salary_cents).unwrap_or(0);
    let meal_card = income.map(|i| i.meal_card_cents).unwrap_or(0);

    let mut personal: i64 = 0;
    let mut shared: i64 = 0;
    let mut paid: i64 = 0;
    let mut unpaid: i64 = 0;
    let mut credits: i64 = 0;

    for e in expenses {
        let share = person_share_cents(e, person);
        if e.kind == Kind::Credit {
            credits += share;
            continue;
        }
        let is_theirs = matches!(
            (e.responsible, person),
            (Responsible::Joao, Person::Joao) | (Responsible::Anna, Person::Anna)
        );
        if e.responsible == Responsible::Shared {
            shared += share;
        } else if is_theirs {
            personal += share;
        }
        if e.paid {
            paid += share;
        } else {
            unpaid += share;
        }
    }

    let total = personal + shared;
    let income_total = salary + meal_card + credits;
    let committed_pct = if income_total > 0 {
        (((total as f64 / income_total as f64) * 100.0).round() as i64).min(200)
    } else {
        0
    };

    PersonBreakdown {
        salary_cents: salary,
        meal_card_cents: meal_card,
        credits_cents: credits,
        income_cents: income_total,
        personal_expenses_cents: personal,
        shared_expenses_cents: shared,
        total_expenses_cents: total,
        available_cents: income_total - total,
        committed_pct,
        paid_amount_cents: paid,
        unpaid_amount_cents: unpaid,
    }
}

/// Compute the full household summary for `month`.
///
/// NOTE: every expense occupies the balance regardless of `paid` — payment
/// status only tracks settlement. Credits add to income instead.
pub fn compute_summary(
    expenses: &[Expense],
    incomes: &[Income],
    today: &str,
) -> HouseholdSummary {
    let income_for = |p: Person| incomes.iter().find(|i| i.person == p);
    let joao = breakdown_for(expenses, Person::Joao, income_for(Person::Joao));
    let anna = breakdown_for(expenses, Person::Anna, income_for(Person::Anna));

    let bills: Vec<Expense> = expenses
        .iter()
        .filter(|e| e.kind == Kind::Expense)
        .cloned()
        .collect();
    let unpaid: Vec<Expense> = bills.iter().filter(|e| !e.paid).cloned().collect();
    let mut with_due: Vec<Expense> = unpaid
        .iter()
        .filter(|e| e.due_date.is_some())
        .cloned()
        .collect();
    with_due.sort_by(|a, b| a.due_date.cmp(&b.due_date));

    let overdue: Vec<Expense> = with_due
        .iter()
        .filter(|e| days_until(e.due_date.as_deref().unwrap_or(""), today) < 0)
        .cloned()
        .collect();

    HouseholdSummary {
        total_income_cents: joao.income_cents + anna.income_cents,
        total_expenses_cents: joao.total_expenses_cents + anna.total_expenses_cents,
        total_available_cents: joao.available_cents + anna.available_cents,
        paid_expenses_cents: joao.paid_amount_cents + anna.paid_amount_cents,
        unpaid_expenses_cents: joao.unpaid_amount_cents + anna.unpaid_amount_cents,
        unpaid_count: unpaid.len(),
        paid_count: bills.len() - unpaid.len(),
        expense_count: bills.len(),
        upcoming: with_due,
        overdue,
        joao,
        anna,
    }
}

/// Days from `today` ("YYYY-MM-DD") until `due_date` ("YYYY-MM-DD").
#[must_use]
pub fn days_until(due_date: &str, today: &str) -> i64 {
    let parse = |s: &str| -> Option<i64> {
        if s.len() != 10 {
            return None;
        }
        let y: i64 = s[..4].parse().ok()?;
        let m: u32 = s[5..7].parse().ok()?;
        let d: u32 = s[8..].parse().ok()?;
        Some(days_from_civil(y, m, d))
    };
    match (parse(due_date), parse(today)) {
        (Some(due), Some(today)) => due - today,
        _ => 0,
    }
}
