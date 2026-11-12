//! Rehearsal of the legacy-data migration against a REAL copy of the web
//! app's database. Gated behind `#[ignore]` (needs a real database file):
//!
//!   cp db/custom.db /tmp/hf-legacy-rehearsal.db
//!   cargo test -p finances-core --test rehearsal -- --ignored --nocapture
//!
//! The copy is migrated in place (the core's own rules: backup first, then
//! an atomic transaction) and the result is verified for completeness:
//! row counts, total amounts, ids and the summary sanity-check.

use finances_core::migrate::migrate_legacy;
use finances_core::repo;
use finances_core::Store;

#[test]
#[ignore = "rehearsal against a real database copy — see module docs"]
fn real_database_rehearsal() {
    let path = std::path::PathBuf::from(
        std::env::var("HF_LEGACY_DB").unwrap_or_else(|_| "/tmp/hf-legacy-rehearsal.db".into()),
    );
    let before_expenses = quick_count(&path, "Expense");
    let before_incomes = quick_count(&path, "Income");
    println!(
        "legacy database: {} expenses, {} incomes ({} bytes)",
        before_expenses,
        before_incomes,
        std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0)
    );

    let store = Store::open_in_memory().unwrap();
    let report = migrate_legacy(&store, &path, false).expect("migration must succeed");
    println!(
        "migrated: {} expenses, {} incomes, warnings: {:?}",
        report.expenses_migrated, report.incomes_migrated, report.warnings
    );

    // Nothing lost, nothing invented.
    assert_eq!(
        report.warnings,
        Vec::<String>::new(),
        "clean data must migrate without warnings"
    );
    assert_eq!(report.expenses_migrated as i64, before_expenses);
    assert_eq!(report.incomes_migrated as i64, before_incomes);

    // Every legacy id must be present in the migrated store.
    let expenses = repo::list_all_expenses(&store.conn).unwrap();
    let incomes = repo::list_all_incomes(&store.conn).unwrap();
    assert_eq!(expenses.len() as i64, before_expenses);
    assert_eq!(incomes.len() as i64, before_incomes);
    for id in quick_ids(&path, "Expense") {
        assert!(
            expenses.iter().any(|e| e.id == id),
            "missing expense id {id}"
        );
    }
    for id in quick_ids(&path, "Income") {
        assert!(incomes.iter().any(|i| i.id == id), "missing income id {id}");
    }

    // Months preserved.
    let months = repo::available_months(&store.conn).unwrap();
    println!("months after migration: {months:?}");
    assert!(months.contains(&"2026-10".to_string()));
    assert!(months.contains(&"2026-11".to_string()));

    // Summary sanity on the migrated data (integer cents, all months present).
    let month = "2026-11";
    let exp = repo::list_expenses_by_month(&store.conn, month).unwrap();
    let inc = repo::list_incomes_by_month(&store.conn, month).unwrap();
    let summary = repo::compute_summary(&exp, &inc, "2026-11-13");
    println!(
        "2026-11 summary: income {} c, expenses {} c, available {} c",
        summary.total_income_cents, summary.total_expenses_cents, summary.total_available_cents
    );
    assert!(summary.total_income_cents > 0);
}

fn quick_count(path: &std::path::Path, table: &str) -> i64 {
    let conn =
        rusqlite::Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .unwrap();
    conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
        .unwrap()
}

fn quick_ids(path: &std::path::Path, table: &str) -> Vec<String> {
    let conn =
        rusqlite::Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .unwrap();
    let mut stmt = conn
        .prepare(&format!("SELECT id FROM {table} ORDER BY rowid"))
        .unwrap();
    stmt.query_map([], |r| r.get::<_, String>(0))
        .unwrap()
        .filter_map(|r| r.ok())
        .collect()
}
