//! Parity tests: the Rust summary math must produce exactly what the
//! TypeScript implementation (`src/lib/finance.ts`) produces for the same
//! input — including the "unpaid bills still occupy the balance" rule.

use finances_core::model::{Expense, Income, NewExpense};
use finances_core::repo::{compute_summary, days_until, person_share_cents};
use finances_core::validation::{Kind, Person, Responsible};

fn expense(
    name: &str,
    amount_cents: i64,
    kind: Kind,
    responsible: Responsible,
    joao_share: f64,
    joao_paid: Option<i64>,
    anna_paid: Option<i64>,
    paid: bool,
    due: Option<&str>,
) -> NewExpense {
    NewExpense {
        name: name.into(),
        amount_cents,
        kind,
        category: "Other".into(),
        responsible,
        joao_share,
        joao_paid_cents: joao_paid,
        anna_paid_cents: anna_paid,
        due_date: due.map(String::from),
        paid,
        notes: None,
        month: "2026-11".into(),
    }
}

fn to_expense(n: NewExpense) -> Expense {
    Expense {
        id: format!("test-{}", n.name),
        name: n.name,
        amount_cents: n.amount_cents,
        kind: n.kind,
        category: n.category,
        responsible: n.responsible,
        joao_share: n.joao_share,
        joao_paid_cents: n.joao_paid_cents,
        anna_paid_cents: n.anna_paid_cents,
        due_date: n.due_date,
        paid: n.paid,
        notes: n.notes,
        month: n.month,
        created_at: String::new(),
        updated_at: String::new(),
    }
}

fn income(person: Person, salary: i64, meal: i64) -> Income {
    Income {
        id: format!("inc-{person:?}"),
        person,
        month: "2026-11".into(),
        salary_cents: salary,
        meal_card_cents: meal,
        created_at: String::new(),
        updated_at: String::new(),
    }
}

#[test]
fn exact_paid_split_is_honoured() {
    // €900 rent, João paid €400 → João 400, Anna 500 (the €500 remainder).
    let e = to_expense(expense("Rent", 90_000, Kind::Expense, Responsible::Shared, 50.0, Some(40_000), Some(50_000), false, None));
    assert_eq!(person_share_cents(&e, Person::Joao), 40_000);
    assert_eq!(person_share_cents(&e, Person::Anna), 50_000);
}

#[test]
fn percentage_split_matches_web_rounding() {
    // 25% of €900 → round2(900 * 0.25) = 225.00
    let e = to_expense(expense("Rent", 90_000, Kind::Expense, Responsible::Shared, 25.0, None, None, false, None));
    assert_eq!(person_share_cents(&e, Person::Joao), 22_500);
    assert_eq!(person_share_cents(&e, Person::Anna), 67_500);

    // 33.3% of €100 → 33.30 / 66.70
    let e2 = to_expense(expense("X", 10_000, Kind::Expense, Responsible::Shared, 33.3, None, None, false, None));
    assert_eq!(person_share_cents(&e2, Person::Joao), 3_330);
    assert_eq!(person_share_cents(&e2, Person::Anna), 6_670);
}

#[test]
fn personal_expenses_belong_to_one_person() {
    let joao_only = to_expense(expense("Gym", 5_000, Kind::Expense, Responsible::Joao, 50.0, None, None, false, None));
    assert_eq!(person_share_cents(&joao_only, Person::Joao), 5_000);
    assert_eq!(person_share_cents(&joao_only, Person::Anna), 0);
}

#[test]
fn unpaid_bills_still_occupy_the_balance() {
    let expenses = vec![
        to_expense(expense("Rent", 80_000, Kind::Expense, Responsible::Shared, 50.0, None, None, false, None)),
        to_expense(expense("Gym", 5_000, Kind::Expense, Responsible::Joao, 50.0, None, None, false, None)),
    ];
    let incomes = vec![
        income(Person::Joao, 200_000, 5_000),
        income(Person::Anna, 180_000, 0),
    ];
    let summary = compute_summary(&expenses, &incomes, "2026-11-13");

    // João: 2000 + 50 income; 400 (half rent) + 50 gym = 450 expenses → 1600 available.
    assert_eq!(summary.joao.income_cents, 205_000);
    assert_eq!(summary.joao.total_expenses_cents, 45_000);
    assert_eq!(summary.joao.available_cents, 160_000);
    // Anna: 1800 income; 400 rent → 1400 available.
    assert_eq!(summary.anna.available_cents, 140_000);
    // Nothing is marked paid, yet everything counts (occupied, not settled).
    assert_eq!(summary.unpaid_count, 2);
    assert_eq!(summary.paid_count, 0);
    assert_eq!(summary.unpaid_expenses_cents, 85_000);
    assert_eq!(summary.total_available_cents, 300_000);
}

#[test]
fn credits_add_to_income_not_expenses() {
    let expenses = vec![
        to_expense(expense("Meal card top-up", 10_000, Kind::Credit, Responsible::Joao, 50.0, None, None, false, None)),
        to_expense(expense("Coffee", 2_000, Kind::Expense, Responsible::Joao, 50.0, None, None, false, None)),
    ];
    let summary = compute_summary(&expenses, &[], "2026-11-13");
    assert_eq!(summary.joao.credits_cents, 10_000);
    assert_eq!(summary.joao.income_cents, 10_000);
    assert_eq!(summary.joao.total_expenses_cents, 2_000);
    assert_eq!(summary.joao.available_cents, 8_000);
    // Credits are not counted in bill statistics.
    assert_eq!(summary.expense_count, 1);
}

#[test]
fn committed_pct_is_capped_like_the_web() {
    // income 100, expenses 500 → ratio 500% → capped at 200.
    let expenses = vec![to_expense(expense("Huge", 50_000, Kind::Expense, Responsible::Joao, 50.0, None, None, false, None))];
    let incomes = vec![income(Person::Joao, 10_000, 0)];
    let summary = compute_summary(&expenses, &incomes, "2026-11-13");
    assert_eq!(summary.joao.committed_pct, 200);
}

#[test]
fn upcoming_and_overdue_sorting() {
    let expenses = vec![
        to_expense(expense("Later", 1_000, Kind::Expense, Responsible::Shared, 50.0, None, None, false, Some("2026-11-28"))),
        to_expense(expense("Past", 1_000, Kind::Expense, Responsible::Shared, 50.0, None, None, false, Some("2026-11-01"))),
        to_expense(expense("PaidPast", 1_000, Kind::Expense, Responsible::Shared, 50.0, None, None, true, Some("2026-11-01"))),
        to_expense(expense("NoDue", 1_000, Kind::Expense, Responsible::Shared, 50.0, None, None, false, None)),
    ];
    let summary = compute_summary(&expenses, &[], "2026-11-13");
    assert_eq!(summary.upcoming.len(), 2); // unpaid with due date, sorted
    assert_eq!(summary.upcoming[0].name, "Past");
    assert_eq!(summary.upcoming[1].name, "Later");
    assert_eq!(summary.overdue.len(), 1);
    assert_eq!(summary.overdue[0].name, "Past");
}

#[test]
fn days_until_matches_ts_semantics() {
    assert_eq!(days_until("2026-11-13", "2026-11-13"), 0);
    assert_eq!(days_until("2026-11-14", "2026-11-13"), 1);
    assert_eq!(days_until("2026-11-01", "2026-11-13"), -12);
    assert_eq!(days_until("2027-01-01", "2026-12-31"), 1); // year boundary
    assert_eq!(days_until("2024-03-01", "2024-02-28"), 2); // leap year
}
