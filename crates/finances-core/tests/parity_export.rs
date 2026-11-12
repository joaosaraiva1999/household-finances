//! Cross-version parity exporter.
//!
//! Reads `tests/parity/scenarios.json` (the SAME fixtures the web parity
//! test drives through the Next.js API), replays them through the Rust
//! core, and writes the resulting summaries + display order to a JSON file
//! that `tests/parity/parity.test.ts` compares against the web results.
//!
//! Run: cargo test -p finances-core --test parity_export

use finances_core::model::{IncomeUpsert, NewExpense};
use finances_core::money::euros_to_cents;
use finances_core::repo;
use finances_core::validation::{Kind, Person, Responsible};
use finances_core::{view, Store};

#[test]
fn export_parity_results() {
    let manifest = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let scenarios_path = manifest
        .join("..")
        .join("..")
        .join("tests")
        .join("parity")
        .join("scenarios.json");
    let raw = std::fs::read_to_string(&scenarios_path)
        .expect("tests/parity/scenarios.json must exist next to the workspace");
    let doc: serde_json::Value = serde_json::from_str(&raw).expect("scenarios JSON is valid");

    let out_path =
        std::env::var("HF_PARITY_OUT").unwrap_or_else(|_| "/tmp/hf-parity-rust.json".into());

    let mut results: Vec<serde_json::Value> = Vec::new();
    for scenario in doc["scenarios"].as_array().expect("scenarios array") {
        let store = Store::open_in_memory().expect("in-memory store");
        let month = scenario["month"].as_str().expect("month");

        for inc in scenario["incomes"].as_array().expect("incomes") {
            let upsert = IncomeUpsert {
                person: Person::parse(inc["person"].as_str().expect("person"))
                    .expect("valid person"),
                month: month.to_string(),
                salary_cents: Some(euros_to_cents(inc["amount"].as_f64().unwrap_or(0.0))),
                meal_card_cents: Some(euros_to_cents(inc["mealCard"].as_f64().unwrap_or(0.0))),
            };
            repo::upsert_income(&store.conn, &upsert).expect("income upsert");
        }

        for exp in scenario["expenses"].as_array().expect("expenses") {
            let new = NewExpense {
                name: exp["name"].as_str().expect("name").to_string(),
                amount_cents: euros_to_cents(exp["amount"].as_f64().expect("amount")),
                kind: Kind::parse(exp["kind"].as_str().unwrap_or("expense")).expect("valid kind"),
                category: exp["category"].as_str().unwrap_or("Other").to_string(),
                responsible: Responsible::parse(exp["responsible"].as_str().unwrap_or("shared"))
                    .expect("valid responsible"),
                joao_share: exp["joaoShare"].as_f64().unwrap_or(50.0),
                joao_paid_cents: exp["joaoPaid"].as_f64().map(euros_to_cents),
                anna_paid_cents: exp["annaPaid"].as_f64().map(euros_to_cents),
                due_date: exp["dueDate"].as_str().map(String::from),
                paid: exp["paid"].as_bool().unwrap_or(false),
                notes: exp["notes"].as_str().map(String::from),
                month: month.to_string(),
            };
            let validated = repo::validate_new_expense(&new).expect("fixture must validate");
            repo::insert_expense(&store.conn, &validated).expect("insert");
        }

        let expenses = repo::list_expenses_by_month(&store.conn, month).expect("list");
        let incomes = repo::list_incomes_by_month(&store.conn, month).expect("list incomes");
        let summary = repo::compute_summary(&expenses, &incomes, "2026-11-13");

        results.push(serde_json::json!({
            "name": scenario["name"],
            "summary": serde_json::to_value(view::SummaryView::from(&summary)).unwrap(),
            "expenseOrder": expenses.iter().map(|e| e.name.clone()).collect::<Vec<_>>(),
        }));
    }

    std::fs::write(&out_path, serde_json::to_string_pretty(&results).unwrap())
        .expect("write parity output");
    println!(
        "parity results for {} scenarios → {out_path}",
        results.len()
    );
}
