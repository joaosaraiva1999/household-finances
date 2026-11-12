//! Parity tests: the Rust backend must produce identical results to the
//! original web API (src/lib/finance.ts + route handlers).

use financas_da_casa_lib::models::ExpenseInput;
use financas_da_casa_lib::summary::{compute_summary, person_share_cents, ExpenseCents, IncomeCents};
use financas_da_casa_lib::validate::{
    normalize_paid_split, sanitize_create, share_percent_from_paid, to_cents,
};

fn expense(
    id: &str,
    amount_cents: i64,
    kind: &str,
    responsible: &str,
    joao_share: f64,
    joao_paid: Option<i64>,
    anna_paid: Option<i64>,
    paid: bool,
) -> ExpenseCents {
    ExpenseCents {
        id: id.into(),
        name: format!("e-{id}"),
        amount_cents,
        kind: kind.into(),
        category: "Other".into(),
        responsible: responsible.into(),
        joao_share,
        joao_paid_cents: joao_paid,
        anna_paid_cents: anna_paid,
        due_date: None,
        paid,
        notes: None,
        month: "2026-11".into(),
    }
}

#[test]
fn normalize_paid_split_matches_web() {
    // The canonical example from the app: €900 bill, João paid €400.
    assert_eq!(normalize_paid_split(90_000, Some(400.0), None), Some((40_000, 50_000)));
    // Anna's value provided instead.
    assert_eq!(normalize_paid_split(90_000, None, Some(300.0)), Some((60_000, 30_000)));
    // Overpayment clamps to the bill total.
    assert_eq!(normalize_paid_split(10_000, Some(99.0), None), Some((9_900, 100)));
    // Explicit zero keeps zero for that person.
    assert_eq!(normalize_paid_split(10_000, Some(0.0), None), Some((0, 10_000)));
    // No usable value.
    assert_eq!(normalize_paid_split(10_000, None, None), None);
    assert_eq!(normalize_paid_split(0, Some(5.0), None), None);
}

#[test]
fn share_percent_from_paid_matches_web() {
    // JS: Math.round((400/900)*1000)/10 = 44.4
    assert!((share_percent_from_paid(40_000, 90_000) - 44.4).abs() < 1e-9);
    assert!((share_percent_from_paid(45_000, 90_000) - 50.0).abs() < 1e-9);
    assert_eq!(share_percent_from_paid(0, 90_000), 0.0);
    assert_eq!(share_percent_from_paid(90_000, 90_000), 100.0);
    assert_eq!(share_percent_from_paid(50, 0), 50.0);
}

#[test]
fn person_share_rounding_matches_js() {
    // round2(100.01 * 50 / 100) = round2(50.005) = 50.01 → 5001 cents
    let e = expense("a", 10_001, "expense", "shared", 50.0, None, None, false);
    assert_eq!(person_share_cents(&e, "joao"), 5_001);
    // One-decimal share: 33.3% of 100.00 → 3330 cents for João, 6670 for Anna.
    let e = expense("b", 10_000, "expense", "shared", 33.3, None, None, false);
    assert_eq!(person_share_cents(&e, "joao"), 3_330);
    assert_eq!(person_share_cents(&e, "anna"), 6_670);
    // Personal expense: full amount.
    let e = expense("c", 12_345, "expense", "joao", 0.0, None, None, false);
    assert_eq!(person_share_cents(&e, "joao"), 12_345);
    assert_eq!(person_share_cents(&e, "anna"), 0);
    // Exact paid amounts win for shared money-out.
    let e = expense("d", 90_000, "expense", "shared", 44.4, Some(40_000), Some(50_000), false);
    assert_eq!(person_share_cents(&e, "joao"), 40_000);
    assert_eq!(person_share_cents(&e, "anna"), 50_000);
    // Paid amounts do NOT apply to credits — percentage split is used.
    let e = expense("e", 90_000, "credit", "shared", 44.4, Some(40_000), Some(50_000), false);
    assert_eq!(person_share_cents(&e, "joao"), 39_960); // round2(900*44.4/100)
    assert_eq!(person_share_cents(&e, "anna"), 50_040);
}

#[test]
fn summary_math_matches_web() {
    // João 2000 + Anna 1800; shared bill 900 with paid split 400/500 (unpaid);
    // personal bills: João 800 paid, Anna 700 unpaid; shared credit 100 (50%).
    let expenses = vec![
        expense("rent", 90_000, "expense", "shared", 44.4, Some(40_000), Some(50_000), false),
        expense("j1", 80_000, "expense", "joao", 100.0, None, None, true),
        expense("a1", 70_000, "expense", "anna", 0.0, None, None, false),
        expense("cr", 10_000, "credit", "shared", 50.0, None, None, false),
    ];
    let incomes = vec![
        IncomeCents {
            id: "i1".into(),
            person: "joao".into(),
            month: "2026-11".into(),
            amount_cents: 200_000,
            meal_card_cents: 0,
            created_at: None,
            updated_at: None,
        },
        IncomeCents {
            id: "i2".into(),
            person: "anna".into(),
            month: "2026-11".into(),
            amount_cents: 180_000,
            meal_card_cents: 0,
            created_at: None,
            updated_at: None,
        },
    ];
    let s = compute_summary(&expenses, &incomes);

    // João: personal 800 + shared 400 = 1200; credits 50; income 2050; avail 850.
    assert!((s.joao.total_expenses - 1200.0).abs() < 1e-9);
    assert!((s.joao.credits - 50.0).abs() < 1e-9);
    assert!((s.joao.income - 2050.0).abs() < 1e-9);
    assert!((s.joao.available - 850.0).abs() < 1e-9);
    // Anna: personal 700 + shared 500 = 1200; credits 50; income 1850; avail 650.
    assert!((s.anna.total_expenses - 1200.0).abs() < 1e-9);
    assert!((s.anna.available - 650.0).abs() < 1e-9);
    // Household.
    assert!((s.total_income - 3900.0).abs() < 1e-9);
    assert!((s.total_expenses - 2400.0).abs() < 1e-9);
    assert!((s.total_available - 1500.0).abs() < 1e-9);
    // Unpaid bills: rent (900) + a1 (700) = 1600; paid: j1 800.
    assert!((s.unpaid_expenses - 1600.0).abs() < 1e-9);
    assert!((s.paid_expenses - 800.0).abs() < 1e-9);
    assert_eq!(s.unpaid_count, 2);
    assert_eq!(s.paid_count, 1);
    assert_eq!(s.expense_count, 3);
}

#[test]
fn sanitize_create_matches_web_rules() {
    // Missing name.
    let input: ExpenseInput = serde_json::from_value(serde_json::json!({ "amount": 10.0 })).unwrap();
    assert_eq!(sanitize_create(&input).unwrap_err(), "Expense name is required");

    // Amount ≤ 0 rejected.
    let input: ExpenseInput =
        serde_json::from_value(serde_json::json!({ "name": "x", "amount": 0 })).unwrap();
    assert_eq!(sanitize_create(&input).unwrap_err(), "Amount must be a positive number");

    // Invalid responsible.
    let input: ExpenseInput =
        serde_json::from_value(serde_json::json!({ "name": "x", "amount": 5, "responsible": "dog" }))
            .unwrap();
    assert_eq!(sanitize_create(&input).unwrap_err(), "Invalid responsible person");

    // Non-shared forces the share to 100/0 and ignores any provided split.
    let input: ExpenseInput = serde_json::from_value(serde_json::json!({
        "name": "Aluguer",
        "amount": 900,
        "responsible": "joao",
        "joaoShare": 30,
        "joaoPaid": 100,
        "category": "Nope",
        "paid": 1,
    }))
    .unwrap();
    let clean = sanitize_create(&input).unwrap();
    assert!((clean.joao_share - 100.0).abs() < 1e-9);
    assert_eq!(clean.joao_paid_cents, None);
    assert_eq!(clean.category, "Other"); // invalid category → Other
    assert_eq!(clean.amount_cents, 90_000);
    assert!(clean.paid); // JS Boolean(1) → true

    // Shared + paid: percent derived from the paid amount.
    let input: ExpenseInput = serde_json::from_value(serde_json::json!({
        "name": "Renda",
        "amount": 900,
        "responsible": "shared",
        "joaoPaid": 400,
    }))
    .unwrap();
    let clean = sanitize_create(&input).unwrap();
    assert_eq!(clean.joao_paid_cents, Some(40_000));
    assert_eq!(clean.anna_paid_cents, Some(50_000));
    assert!((clean.joao_share - 44.4).abs() < 1e-9);

    // Month validation + default.
    let input: ExpenseInput = serde_json::from_value(serde_json::json!({
        "name": "x",
        "amount": 5,
        "month": "2026-13",
    }))
    .unwrap();
    let clean = sanitize_create(&input).unwrap();
    assert_eq!(clean.month.len(), 7); // defaulted to the current month

    // Bad dueDate cleared; notes trimmed.
    let input: ExpenseInput = serde_json::from_value(serde_json::json!({
        "name": "x",
        "amount": 5,
        "dueDate": "18/11/2026",
        "notes": "  ola  ",
    }))
    .unwrap();
    let clean = sanitize_create(&input).unwrap();
    assert_eq!(clean.due_date, None);
    assert_eq!(clean.notes.as_deref(), Some("ola"));

    // Amount stored in exact cents: 10.005 → JS Math.round(1000.5) = 1001.
    let input: ExpenseInput =
        serde_json::from_value(serde_json::json!({ "name": "x", "amount": 10.005 })).unwrap();
    assert_eq!(sanitize_create(&input).unwrap().amount_cents, 1_001);
}

#[test]
fn cents_conversion_matches_js_round() {
    assert_eq!(to_cents(10.005), 1_001);
    assert_eq!(to_cents(0.1 + 0.2), 30); // 0.30000000000000004 → 30
    assert_eq!(to_cents(1_000_000.0), 100_000_000);
}
