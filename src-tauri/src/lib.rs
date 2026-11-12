//! Tauri 2 application shell — thin IPC layer over `finances-core`.
//!
//! Every command validates its inputs through the core before touching the
//! database; errors cross the IPC boundary as `{ code, message }` objects.
//! Responses use the EXACT JSON shapes of the web API (`src/app/api/*`), so
//! the existing React frontend runs unchanged against either backend — see
//! `crates/finances-core/src/view.rs`.
//!
//! The SQLite database lives in the OS application-data directory
//! (`app_data_dir/household-finances/data.sqlite` — platform-specific:
//! `%APPDATA%` on Windows, `~/Library/Application Support` on macOS,
//! `$XDG_DATA_HOME` on Linux) — never in a temp dir or the install folder.

use std::sync::Mutex;

use finances_core::backup::{export_backup, export_csv, import_backup, RestoreReport};
use finances_core::error::{AppError, Result};
use finances_core::migrate::{migrate_legacy, MigrationReport};
use finances_core::model::{current_month_key, ExpensePatch, IncomeUpsert, NewExpense};
use finances_core::validation::{Kind, Person, Responsible};
use finances_core::{repo, view, Store};
use serde::{Deserialize, Serialize};
use tauri::{Manager, State};

pub struct AppState {
    store: Mutex<Store>,
}

// ─── IPC payload types ───────────────────────────────────────────────────────

/// Treat an explicit JSON `null` as `Some(None)` and an absent field as
/// `None` — the standard serde `double_option` pattern, needed for
/// "clear this field" patches.
fn double_option<'de, T, D>(de: D) -> std::result::Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: serde::Deserializer<'de>,
{
    Deserialize::deserialize(de).map(Some)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExpenseInput {
    name: String,
    /// Euros (same unit as the web app); converted to integer cents here.
    amount: f64,
    kind: Option<String>,
    category: Option<String>,
    responsible: Option<String>,
    joao_share: Option<f64>,
    joao_paid: Option<f64>,
    anna_paid: Option<f64>,
    due_date: Option<String>,
    notes: Option<String>,
    paid: Option<bool>,
    month: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExpensePatchInput {
    name: Option<String>,
    amount: Option<f64>,
    kind: Option<String>,
    responsible: Option<String>,
    category: Option<String>,
    joao_share: Option<f64>,
    #[serde(default, deserialize_with = "double_option")]
    joao_paid: Option<Option<f64>>,
    #[serde(default, deserialize_with = "double_option")]
    anna_paid: Option<Option<f64>>,
    #[serde(default, deserialize_with = "double_option")]
    due_date: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    notes: Option<Option<String>>,
    paid: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct IncomeInput {
    person: String,
    month: Option<String>,
    amount: Option<f64>,
    meal_card: Option<f64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    version: String,
    db_path: String,
    offline: bool,
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn with_store<T>(state: &State<AppState>, f: impl FnOnce(&Store) -> Result<T>) -> Result<T> {
    let guard = state
        .store
        .lock()
        .map_err(|_| AppError::Validation("Store busy".into()))?;
    f(&guard)
}

fn parse_kind(s: Option<&str>) -> Result<Kind> {
    Kind::parse(s.unwrap_or("expense"))
}

fn parse_responsible(s: Option<&str>) -> Result<Responsible> {
    Responsible::parse(s.unwrap_or("shared"))
}

fn month_or_current(m: Option<&str>) -> Result<String> {
    match m {
        Some(m) if !m.is_empty() => finances_core::validation::parse_month(m),
        _ => Ok(current_month_key()),
    }
}

// ─── Commands ────────────────────────────────────────────────────────────────

/// Mirror of `GET /api/finance?month=` — identical JSON shape (web parity).
#[tauri::command]
fn get_month_data(state: State<AppState>, month: Option<String>) -> Result<view::MonthDataView> {
    let month = month_or_current(month.as_deref())?;
    with_store(&state, |store| {
        // Single fetch per table — reused for both the lists and the summary
        // (this command used to query each table twice).
        let expenses = repo::list_expenses_by_month(&store.conn, &month)?;
        let incomes = repo::list_incomes_by_month(&store.conn, &month)?;
        let mut months = repo::available_months(&store.conn)?;
        // Web parity: the current month is always offered in the month
        // picker, even with no data yet.
        let current = current_month_key();
        if !months.contains(&current) {
            months.push(current);
            months.sort();
        }
        let summary =
            repo::compute_summary(&expenses, &incomes, &finances_core::model::today_iso());
        Ok(view::MonthDataView {
            month,
            available_months: months,
            incomes: incomes.iter().map(view::IncomeView::from).collect(),
            expenses: expenses.iter().map(view::ExpenseView::from).collect(),
            summary: view::SummaryView::from(&summary),
            meta: view::MetaView {
                today: finances_core::model::today_iso(),
            },
        })
    })
}

/// Mirror of `POST /api/expenses` — returns the created expense in the web
/// API shape (`{ expense: … }`).
#[tauri::command]
fn create_expense(state: State<AppState>, input: ExpenseInput) -> Result<serde_json::Value> {
    let responsible = parse_responsible(input.responsible.as_deref())?;
    let kind = parse_kind(input.kind.as_deref())?;
    let new = NewExpense {
        name: input.name,
        amount_cents: finances_core::money::euros_to_cents(input.amount),
        kind,
        category: input.category.unwrap_or_else(|| "Other".into()),
        responsible,
        joao_share: input.joao_share.unwrap_or(50.0),
        joao_paid_cents: input.joao_paid.map(finances_core::money::euros_to_cents),
        anna_paid_cents: input.anna_paid.map(finances_core::money::euros_to_cents),
        due_date: input.due_date,
        paid: input.paid.unwrap_or(false),
        notes: input.notes,
        month: month_or_current(input.month.as_deref())?,
    };
    let validated = repo::validate_new_expense(&new)?;
    let created = with_store(&state, |store| {
        repo::insert_expense(&store.conn, &validated)
    })?;
    Ok(serde_json::json!({ "expense": view::ExpenseView::from(&created) }))
}

/// Mirror of `PATCH /api/expenses/[id]` — returns `{ expense: … }` or
/// `{ error: "Expense not found" }`-equivalent NotFound error.
#[tauri::command]
fn update_expense(
    state: State<AppState>,
    id: String,
    patch: ExpensePatchInput,
) -> Result<serde_json::Value> {
    let p = ExpensePatch {
        name: patch.name,
        amount_cents: patch.amount.map(finances_core::money::euros_to_cents),
        kind: patch.kind.as_deref().map(Kind::parse).transpose()?,
        responsible: patch
            .responsible
            .as_deref()
            .map(Responsible::parse)
            .transpose()?,
        category: patch.category,
        joao_share: patch.joao_share,
        joao_paid_cents: patch
            .joao_paid
            .map(|o| o.map(finances_core::money::euros_to_cents)),
        anna_paid_cents: patch
            .anna_paid
            .map(|o| o.map(finances_core::money::euros_to_cents)),
        due_date: patch.due_date,
        notes: patch.notes,
        paid: patch.paid,
    };
    let updated = with_store(&state, |store| repo::update_expense(&store.conn, &id, &p))?;
    match updated {
        Some(e) => Ok(serde_json::json!({ "expense": view::ExpenseView::from(&e) })),
        // Web parity: PATCH of an unknown id yields 404 "Expense not found".
        None => Err(AppError::NotFound("Expense not found".into())),
    }
}

/// Mirror of `DELETE /api/expenses/[id]` — returns `{ ok: true }`; deleting
/// an unknown id yields NotFound (web parity with the 404 response).
#[tauri::command]
fn delete_expense(state: State<AppState>, id: String) -> Result<serde_json::Value> {
    let existed = with_store(&state, |store| repo::delete_expense(&store.conn, &id))?;
    if existed {
        Ok(serde_json::json!({ "ok": true }))
    } else {
        Err(AppError::NotFound("Expense not found".into()))
    }
}

/// Mirror of `POST /api/income` — returns `{ income: … }` (web shape).
#[tauri::command]
fn save_income(state: State<AppState>, input: IncomeInput) -> Result<serde_json::Value> {
    let upsert = IncomeUpsert {
        person: Person::parse(&input.person)?,
        month: month_or_current(input.month.as_deref())?,
        salary_cents: input.amount.map(finances_core::money::euros_to_cents),
        meal_card_cents: input.meal_card.map(finances_core::money::euros_to_cents),
    };
    let saved = with_store(&state, |store| repo::upsert_income(&store.conn, &upsert))?;
    Ok(serde_json::json!({ "income": view::IncomeView::from(&saved) }))
}

#[tauri::command]
fn export_backup_cmd(state: State<AppState>, path: String) -> Result<u64> {
    with_store(&state, |store| {
        export_backup(store, std::path::Path::new(&path))
    })
}

#[tauri::command]
fn import_backup_cmd(
    state: State<AppState>,
    path: String,
    confirmed: bool,
) -> Result<RestoreReport> {
    with_store(&state, |store| {
        import_backup(store, std::path::Path::new(&path), confirmed)
    })
}

#[tauri::command]
fn export_csv_cmd(state: State<AppState>, path: String, month: Option<String>) -> Result<usize> {
    let month = match month.as_deref() {
        Some(m) if !m.is_empty() => Some(finances_core::validation::parse_month(m)?),
        _ => None,
    };
    with_store(&state, |store| {
        export_csv(store, std::path::Path::new(&path), month.as_deref())
    })
}

#[tauri::command]
fn migrate_legacy_cmd(
    state: State<AppState>,
    path: String,
    force: bool,
) -> Result<MigrationReport> {
    with_store(&state, |store| {
        migrate_legacy(store, std::path::Path::new(&path), force)
    })
}

#[tauri::command]
fn get_app_info(state: State<AppState>, app: tauri::AppHandle) -> Result<AppInfo> {
    let db_path = with_store(&state, |store| Ok(store.path.display().to_string()))?;
    Ok(AppInfo {
        version: app.package_info().version.to_string(),
        db_path,
        // The app never performs network I/O; this flag is declarative.
        offline: true,
    })
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Native application menu (File / Edit / View / Window / Help).
            let menu = tauri::menu::Menu::default(app.handle())?;
            app.set_menu(menu)?;

            // Database in the OS application-data directory.
            let dir = app.path().app_data_dir()?;
            let store = Store::open(&dir.join("data.sqlite"))?;
            app.manage(AppState {
                store: Mutex::new(store),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_month_data,
            create_expense,
            update_expense,
            delete_expense,
            save_income,
            export_backup_cmd,
            import_backup_cmd,
            export_csv_cmd,
            migrate_legacy_cmd,
            get_app_info
        ])
        .run(tauri::generate_context!())
        .expect("error while running the household finances application");
}
