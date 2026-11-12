//! Backup/restore round-trip + integrity + confirmation-gate tests, and CSV
//! export injection-safety on real stored data.

use std::path::PathBuf;

use finances_core::backup::{export_backup, export_csv, import_backup};
use finances_core::model::{IncomeUpsert, NewExpense};
use finances_core::repo;
use finances_core::validation::{Kind, Responsible};
use finances_core::{AppError, Store};

fn store() -> Store {
    Store::open_in_memory().expect("in-memory store")
}

fn tmpdir() -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("backup.json");
    (dir, path)
}

fn seed(s: &Store) {
    let rent = repo::validate_new_expense(&NewExpense {
        name: "Rent with ' quote\" and = formula".into(),
        amount_cents: 80_000,
        kind: Kind::Expense,
        category: "Housing".into(),
        responsible: Responsible::Shared,
        joao_share: 50.0,
        joao_paid_cents: None,
        anna_paid_cents: None,
        due_date: Some("2026-11-05".into()),
        paid: false,
        notes: Some("=HYPERLINK('http://evil')".into()),
        month: "2026-11".into(),
    })
    .unwrap();
    repo::insert_expense(&s.conn, &rent).unwrap();
    repo::upsert_income(
        &s.conn,
        &IncomeUpsert {
            person: finances_core::validation::Person::Joao,
            month: "2026-11".into(),
            salary_cents: Some(200_000),
            meal_card_cents: Some(5_000),
        },
    )
    .unwrap();
}

#[test]
fn backup_round_trip_preserves_everything() {
    let s = store();
    seed(&s);
    let (_dir, path) = tmpdir();

    let size = export_backup(&s, &path).unwrap();
    assert!(size > 0);

    let other = store();
    let report = import_backup(&other, &path, true).unwrap();
    assert_eq!(report.expenses_restored, 1);
    assert_eq!(report.incomes_restored, 1);

    let expenses = repo::list_all_expenses(&other.conn).unwrap();
    assert_eq!(expenses.len(), 1);
    assert_eq!(expenses[0].name, "Rent with ' quote\" and = formula");
    assert_eq!(expenses[0].notes.as_deref(), Some("=HYPERLINK('http://evil')"));
    assert_eq!(expenses[0].amount_cents, 80_000);
    let incomes = repo::list_all_incomes(&other.conn).unwrap();
    assert_eq!(incomes[0].salary_cents, 200_000);
    assert_eq!(incomes[0].meal_card_cents, 5_000);
}

#[test]
fn restore_without_confirmation_is_refused() {
    let s = store();
    seed(&s);
    let (_dir, path) = tmpdir();
    export_backup(&s, &path).unwrap();

    let other = store();
    let err = import_backup(&other, &path, false).unwrap_err();
    assert!(matches!(err, AppError::RestoreNotConfirmed));
    // Target untouched.
    assert_eq!(repo::count_expenses(&other.conn).unwrap(), 0);
}

#[test]
fn tampered_backup_is_rejected() {
    let s = store();
    seed(&s);
    let (_dir, path) = tmpdir();
    export_backup(&s, &path).unwrap();

    // Flip a value inside the JSON — the checksum must catch it.
    let raw = std::fs::read_to_string(&path).unwrap();
    let tampered = raw.replace("80000", "99999");
    assert_ne!(raw, tampered);
    std::fs::write(&path, tampered).unwrap();

    let other = store();
    let err = import_backup(&other, &path, true).unwrap_err();
    assert!(matches!(err, AppError::ChecksumMismatch));
    assert_eq!(repo::count_expenses(&other.conn).unwrap(), 0);
}

#[test]
fn restore_replaces_current_data_atomically() {
    let s = store();
    seed(&s);
    let (_dir, path) = tmpdir();
    export_backup(&s, &path).unwrap();

    let other = store();
    seed(&other); // target already has data
    let report = import_backup(&other, &path, true).unwrap();
    // Old rows were replaced, not duplicated.
    assert_eq!(report.expenses_restored, 1);
    assert_eq!(repo::count_expenses(&other.conn).unwrap(), 1);
    assert_eq!(repo::count_incomes(&other.conn).unwrap(), 1);
}

#[test]
fn csv_export_neutralizes_formulas_from_stored_notes() {
    let s = store();
    seed(&s);
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("out.csv");
    let n = export_csv(&s, &path, Some("2026-11")).unwrap();
    assert_eq!(n, 1);

    let content = std::fs::read_to_string(&path).unwrap();
    assert!(content.starts_with('\u{FEFF}'), "missing BOM");
    // The stored note starts with '=' — it must be neutralized in the CSV.
    assert!(content.contains("'=HYPERLINK"));
    assert!(!content.contains("\n=HYPERLINK"));
}
