//! SQL-injection proof tests: classic payloads are pushed through every
//! string-bearing input and must come out as inert, verbatim text — with the
//! database structure and other rows completely unaffected.

use finances_core::model::{ExpensePatch, IncomeUpsert, NewExpense};
use finances_core::repo;
use finances_core::validation::{Kind, Person, Responsible};
use finances_core::{AppError, Store};

fn store() -> Store {
    Store::open_in_memory().expect("in-memory store")
}

fn sample(name: &str) -> NewExpense {
    NewExpense {
        name: name.to_string(),
        amount_cents: 10_000,
        kind: Kind::Expense,
        category: "Groceries".into(),
        responsible: Responsible::Shared,
        joao_share: 50.0,
        joao_paid_cents: None,
        anna_paid_cents: None,
        due_date: None,
        paid: false,
        notes: None,
        month: "2026-11".into(),
    }
}

const PAYLOADS: [&str; 8] = [
    "Robert'); DROP TABLE expenses;--",
    "' OR '1'='1",
    "x'; DELETE FROM expenses WHERE '1'='1",
    "\"; DROP TABLE incomes; --",
    "1' UNION SELECT password FROM users--",
    "admin'--",
    "'); INSERT INTO expenses (name) VALUES ('pwned');--",
    "\\'; EXEC xp_cmdshell('dir');--",
];

#[test]
fn injection_in_name_is_stored_verbatim_and_harmless() {
    let s = store();
    for payload in PAYLOADS {
        let validated = repo::validate_new_expense(&sample(payload)).unwrap();
        let e = repo::insert_expense(&s.conn, &validated).unwrap();
        assert_eq!(e.name, payload, "payload was not stored verbatim");
    }

    // Table is intact, row count matches exactly.
    let all = repo::list_all_expenses(&s.conn).unwrap();
    assert_eq!(all.len(), PAYLOADS.len());
    // Schema is intact: normal operations still work.
    let normal = repo::insert_expense(
        &s.conn,
        &repo::validate_new_expense(&sample("Renda")).unwrap(),
    )
    .unwrap();
    assert_eq!(normal.name, "Renda");
    let got = repo::get_expense(&s.conn, &normal.id).unwrap().unwrap();
    assert_eq!(got.name, "Renda");
}

#[test]
fn injection_in_notes_is_stored_verbatim_and_harmless() {
    let s = store();
    let payload = "note'); UPDATE expenses SET amount_cents=0;--";
    let mut e = sample("Mercado");
    e.notes = Some(payload.to_string());
    let validated = repo::validate_new_expense(&e).unwrap();
    let stored = repo::insert_expense(&s.conn, &validated).unwrap();
    assert_eq!(stored.notes.as_deref(), Some(payload));
    assert_eq!(stored.amount_cents, 10_000, "UPDATE inside notes executed!");
}

#[test]
fn injection_in_month_filter_returns_validation_error_not_data() {
    let s = store();
    repo::insert_expense(&s.conn, &repo::validate_new_expense(&sample("A")).unwrap()).unwrap();

    for evil in ["' OR '1'='1", "2026-11'; DROP TABLE expenses;--", "x%"] {
        let err = repo::list_expenses_by_month(&s.conn, evil).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)), "{evil:?} → {err:?}");
    }
    // Nothing was dropped.
    assert_eq!(repo::count_expenses(&s.conn).unwrap(), 1);
}

#[test]
fn injection_in_ids_is_rejected() {
    let s = store();
    let e =
        repo::insert_expense(&s.conn, &repo::validate_new_expense(&sample("A")).unwrap()).unwrap();

    for evil in [
        "x' OR '1'='1",
        "a'; DELETE FROM expenses;--",
        "id '--",
        "id'--",
    ] {
        assert!(repo::get_expense(&s.conn, evil).is_err());
        assert!(repo::delete_expense(&s.conn, evil).is_err());
        assert!(repo::update_expense(
            &s.conn,
            evil,
            &ExpensePatch {
                paid: Some(true),
                ..Default::default()
            }
        )
        .is_err());
    }
    // The original row is untouched.
    assert!(repo::get_expense(&s.conn, &e.id).unwrap().is_some());
    assert_eq!(repo::count_expenses(&s.conn).unwrap(), 1);
}

#[test]
fn injection_in_update_fields_is_inert() {
    let s = store();
    let e =
        repo::insert_expense(&s.conn, &repo::validate_new_expense(&sample("A")).unwrap()).unwrap();

    let patch = ExpensePatch {
        name: Some("B'); DROP TABLE expenses;--".to_string()),
        notes: Some(Some("x' OR amount_cents = amount_cents;--".to_string())),
        ..Default::default()
    };
    let updated = repo::update_expense(&s.conn, &e.id, &patch)
        .unwrap()
        .unwrap();
    assert_eq!(updated.name, "B'); DROP TABLE expenses;--");
    assert_eq!(repo::count_expenses(&s.conn).unwrap(), 1);
}

#[test]
fn injection_in_income_person_is_rejected() {
    let s = store();
    let bad = IncomeUpsert {
        person: Person::Joao,
        month: "' OR '1'='1".into(),
        salary_cents: Some(100_000),
        meal_card_cents: None,
    };
    assert!(repo::upsert_income(&s.conn, &bad).is_err());
    assert_eq!(repo::count_incomes(&s.conn).unwrap(), 0);

    // A valid upsert still works after the attacks.
    let ok = IncomeUpsert {
        person: Person::Anna,
        month: "2026-11".into(),
        salary_cents: Some(180_000),
        meal_card_cents: None,
    };
    let inc = repo::upsert_income(&s.conn, &ok).unwrap();
    assert_eq!(inc.person, Person::Anna);
    assert_eq!(inc.salary_cents, 180_000);
}

#[test]
fn month_and_due_date_checks_block_spoofed_dates() {
    let mut e = sample("A");
    e.month = "2026-13".into();
    assert!(repo::validate_new_expense(&e).is_err());

    let mut e2 = sample("B");
    e2.due_date = Some("2026-11-31".into()); // impossible date
    assert!(repo::validate_new_expense(&e2).is_err());

    // Parity with the web API: a REAL calendar date outside the expense's
    // month is accepted (the web POST /api/expenses only validates that the
    // date exists — same behaviour required here).
    let mut e3 = sample("C");
    e3.month = "2026-11".into();
    e3.due_date = Some("2026-12-01".into());
    let v3 = repo::validate_new_expense(&e3)
        .expect("out-of-month real date must be accepted (web parity)");
    assert_eq!(v3.due_date.as_deref(), Some("2026-12-01"));
}

#[test]
fn paid_split_always_sums_to_total() {
    let s = store();
    // €900 bill, João paid €400 → Anna automatically covers €500.
    let mut e = sample("Rent");
    e.amount_cents = 90_000;
    e.joao_paid_cents = Some(40_000);
    let v = repo::validate_new_expense(&e).unwrap();
    assert_eq!(v.joao_paid_cents, Some(40_000));
    assert_eq!(v.anna_paid_cents, Some(50_000));
    assert!((v.joao_share - 44.4).abs() < 1e-9);
    let stored = repo::insert_expense(&s.conn, &v).unwrap();
    assert_eq!(
        stored.joao_paid_cents.unwrap() + stored.anna_paid_cents.unwrap(),
        stored.amount_cents
    );

    // Out-of-range provided value is clamped, never persisted raw.
    let mut e2 = sample("Rent2");
    e2.amount_cents = 90_000;
    e2.anna_paid_cents = Some(500_000); // more than the bill
    let v2 = repo::validate_new_expense(&e2).unwrap();
    assert_eq!(v2.anna_paid_cents, Some(90_000));
    assert_eq!(v2.joao_paid_cents, Some(0));

    // Non-shared or credit entries never keep paid amounts.
    let mut e3 = sample("Personal");
    e3.responsible = Responsible::Joao;
    e3.joao_paid_cents = Some(1);
    let v3 = repo::validate_new_expense(&e3).unwrap();
    assert_eq!(v3.joao_paid_cents, None);
    assert_eq!(v3.joao_share, 100.0);
}
