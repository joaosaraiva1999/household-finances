//! Web-API-shaped serialization of the core records.
//!
//! The Tauri IPC layer serves these structs so the **existing React
//! frontend runs unchanged** against either backend: every field name and
//! unit matches `GET /api/finance` in `src/app/api/finance/route.ts` —
//! money as euros (`f64`, converted exactly from integer cents), camelCase
//! keys, `summary` mirroring `HouseholdSummary` in `src/lib/finance.ts`.
//!
//! Money never *computes* in floats: conversion happens once, here, at the
//! IPC boundary (`cents as f64 / 100.0` is exact for any cent value — the
//! same double the web app stores for that amount).

use crate::model::{Expense, Income};
use crate::repo::HouseholdSummary;
use crate::validation::{Kind, Person, Responsible};

/// Convert integer cents to the euro float the web API would have returned.
/// Exact: every cent value maps to the nearest double, which is precisely
/// the double produced when the web app parses/stores that euro amount.
#[must_use]
pub fn euros(cents: i64) -> f64 {
    cents as f64 / 100.0
}

// ─── Records ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExpenseView {
    pub id: String,
    pub name: String,
    /// Euros (same unit as the web API).
    pub amount: f64,
    pub kind: Kind,
    pub category: String,
    pub responsible: Responsible,
    pub joao_share: f64,
    pub joao_paid: Option<f64>,
    pub anna_paid: Option<f64>,
    pub due_date: Option<String>,
    pub paid: bool,
    pub notes: Option<String>,
    pub month: String,
    // NOTE: created_at/updated_at are deliberately NOT exposed — the web
    // API payloads omit them and both frontends consume the same shape.
}

impl From<&Expense> for ExpenseView {
    fn from(e: &Expense) -> Self {
        ExpenseView {
            id: e.id.clone(),
            name: e.name.clone(),
            amount: euros(e.amount_cents),
            kind: e.kind,
            category: e.category.clone(),
            responsible: e.responsible,
            joao_share: e.joao_share,
            joao_paid: e.joao_paid_cents.map(euros),
            anna_paid: e.anna_paid_cents.map(euros),
            due_date: e.due_date.clone(),
            paid: e.paid,
            notes: e.notes.clone(),
            month: e.month.clone(),
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IncomeView {
    pub id: String,
    pub person: Person,
    pub month: String,
    /// Euros (same unit as the web API).
    pub amount: f64,
    /// Euros (same unit as the web API).
    pub meal_card: f64,
}

impl From<&Income> for IncomeView {
    fn from(i: &Income) -> Self {
        IncomeView {
            id: i.id.clone(),
            person: i.person,
            month: i.month.clone(),
            amount: euros(i.salary_cents),
            meal_card: euros(i.meal_card_cents),
        }
    }
}

// ─── Summary (mirrors HouseholdSummary in src/lib/finance.ts) ────────────────

#[derive(Debug, Clone, serde::Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PersonBreakdownView {
    pub salary: f64,
    pub meal_card: f64,
    pub credits: f64,
    pub income: f64,
    pub personal_expenses: f64,
    pub shared_expenses: f64,
    pub total_expenses: f64,
    pub available: f64,
    pub committed_pct: i64,
    pub paid_amount: f64,
    pub unpaid_amount: f64,
}

impl From<&crate::repo::PersonBreakdown> for PersonBreakdownView {
    fn from(b: &crate::repo::PersonBreakdown) -> Self {
        PersonBreakdownView {
            salary: euros(b.salary_cents),
            meal_card: euros(b.meal_card_cents),
            credits: euros(b.credits_cents),
            income: euros(b.income_cents),
            personal_expenses: euros(b.personal_expenses_cents),
            shared_expenses: euros(b.shared_expenses_cents),
            total_expenses: euros(b.total_expenses_cents),
            available: euros(b.available_cents),
            committed_pct: b.committed_pct,
            paid_amount: euros(b.paid_amount_cents),
            unpaid_amount: euros(b.unpaid_amount_cents),
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SummaryView {
    pub joao: PersonBreakdownView,
    pub anna: PersonBreakdownView,
    pub total_income: f64,
    pub total_expenses: f64,
    pub total_available: f64,
    pub paid_expenses: f64,
    pub unpaid_expenses: f64,
    pub unpaid_count: usize,
    pub paid_count: usize,
    pub expense_count: usize,
    pub upcoming: Vec<ExpenseView>,
    pub overdue: Vec<ExpenseView>,
}

impl From<&HouseholdSummary> for SummaryView {
    fn from(s: &HouseholdSummary) -> Self {
        SummaryView {
            joao: PersonBreakdownView::from(&s.joao),
            anna: PersonBreakdownView::from(&s.anna),
            total_income: euros(s.total_income_cents),
            total_expenses: euros(s.total_expenses_cents),
            total_available: euros(s.total_available_cents),
            paid_expenses: euros(s.paid_expenses_cents),
            unpaid_expenses: euros(s.unpaid_expenses_cents),
            unpaid_count: s.unpaid_count,
            paid_count: s.paid_count,
            expense_count: s.expense_count,
            upcoming: s.upcoming.iter().map(ExpenseView::from).collect(),
            overdue: s.overdue.iter().map(ExpenseView::from).collect(),
        }
    }
}

// ─── Month payload (mirrors the web GET /api/finance response) ───────────────

#[derive(Debug, Clone, serde::Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MetaView {
    /// Today's UTC date as `YYYY-MM-DD` (web: `toMonthKey(new Date())`-style meta).
    pub today: String,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MonthDataView {
    pub month: String,
    pub incomes: Vec<IncomeView>,
    pub expenses: Vec<ExpenseView>,
    pub available_months: Vec<String>,
    pub summary: SummaryView,
    pub meta: MetaView,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::NewExpense;
    use crate::repo;
    use crate::validation::Kind;

    fn store() -> crate::Store {
        crate::Store::open_in_memory().unwrap()
    }

    fn sample(name: &str, cents: i64) -> NewExpense {
        NewExpense {
            name: name.into(),
            amount_cents: cents,
            kind: Kind::Expense,
            category: "Groceries".into(),
            responsible: crate::validation::Responsible::Shared,
            joao_share: 50.0,
            joao_paid_cents: None,
            anna_paid_cents: None,
            due_date: None,
            paid: false,
            notes: None,
            month: "2026-11".into(),
        }
    }

    /// Golden test: the JSON served over IPC must have EXACTLY the shape the
    /// web frontend expects (`src/hooks/use-finance.ts` + components).
    #[test]
    fn expense_view_serializes_like_the_web_api() {
        let s = store();
        let mut e = sample("Electricidade", 12_035);
        e.joao_paid_cents = Some(7_050);
        e.anna_paid_cents = Some(4_985);
        e.due_date = Some("2026-11-08".into());
        e.notes = Some("nota com acentos: ção".into());
        e.paid = true;
        let stored =
            repo::insert_expense(&s.conn, &repo::validate_new_expense(&e).unwrap()).unwrap();

        let json = serde_json::to_value(ExpenseView::from(&stored)).unwrap();
        let obj = json.as_object().unwrap();
        let keys: Vec<&String> = obj.keys().collect();
        for expected in [
            "id",
            "name",
            "amount",
            "kind",
            "category",
            "responsible",
            "joaoShare",
            "joaoPaid",
            "annaPaid",
            "dueDate",
            "paid",
            "notes",
            "month",
        ] {
            assert!(
                keys.contains(&&expected.to_string()),
                "missing key {expected}: {keys:?}"
            );
        }
        // Timestamps stay internal — the web API payloads omit them.
        assert!(!keys.contains(&&"createdAt".to_string()));
        assert!(!keys.contains(&&"updatedAt".to_string()));
        assert_eq!(json["amount"], 120.35);
        assert_eq!(json["joaoPaid"], 70.5);
        assert_eq!(json["annaPaid"], 49.85);
        assert_eq!(json["kind"], "expense");
        assert_eq!(json["responsible"], "shared");
        assert_eq!(json["paid"], true);
        assert_eq!(json["dueDate"], "2026-11-08");
    }

    #[test]
    fn income_view_serializes_like_the_web_api() {
        let s = store();
        repo::upsert_income(
            &s.conn,
            &crate::model::IncomeUpsert {
                person: crate::validation::Person::Anna,
                month: "2026-11".into(),
                salary_cents: Some(180_000),
                meal_card_cents: Some(5_050),
            },
        )
        .unwrap();
        let income = &repo::list_incomes_by_month(&s.conn, "2026-11").unwrap()[0];
        let json = serde_json::to_value(IncomeView::from(income)).unwrap();
        assert_eq!(json["person"], "anna");
        assert_eq!(json["amount"], 1800.0);
        assert_eq!(json["mealCard"], 50.5);
        assert_eq!(json["month"], "2026-11");
    }

    /// The whole month payload — including summary — must round-trip through
    /// the same numbers the TypeScript `computeSummary` would produce.
    #[test]
    fn month_payload_matches_web_contract() {
        let s = store();
        repo::insert_expense(
            &s.conn,
            &repo::validate_new_expense(&sample("Rent", 80_000)).unwrap(),
        )
        .unwrap();
        repo::upsert_income(
            &s.conn,
            &crate::model::IncomeUpsert {
                person: crate::validation::Person::Joao,
                month: "2026-11".into(),
                salary_cents: Some(200_000),
                meal_card_cents: Some(5_000),
            },
        )
        .unwrap();

        let expenses = repo::list_expenses_by_month(&s.conn, "2026-11").unwrap();
        let incomes = repo::list_incomes_by_month(&s.conn, "2026-11").unwrap();
        let summary = repo::compute_summary(&expenses, &incomes, "2026-11-13");
        let payload = MonthDataView {
            month: "2026-11".into(),
            incomes: incomes.iter().map(IncomeView::from).collect(),
            expenses: expenses.iter().map(ExpenseView::from).collect(),
            available_months: vec!["2026-11".into()],
            summary: SummaryView::from(&summary),
            meta: MetaView {
                today: "2026-11-13".into(),
            },
        };

        let json = serde_json::to_value(&payload).unwrap();
        // Web response keys: month, incomes, expenses, availableMonths, summary, meta
        for key in [
            "month",
            "incomes",
            "expenses",
            "availableMonths",
            "summary",
            "meta",
        ] {
            assert!(json.get(key).is_some(), "missing {key}");
        }
        assert_eq!(json["meta"]["today"], "2026-11-13");
        assert_eq!(json["summary"]["joao"]["salary"], 2000.0);
        assert_eq!(json["summary"]["joao"]["mealCard"], 50.0);
        assert_eq!(json["summary"]["joao"]["income"], 2050.0);
        assert_eq!(json["summary"]["joao"]["totalExpenses"], 400.0);
        assert_eq!(json["summary"]["joao"]["available"], 1650.0);
        assert_eq!(json["summary"]["anna"]["totalExpenses"], 400.0);
        assert_eq!(json["summary"]["totalIncome"], 2050.0);
        assert_eq!(json["summary"]["totalExpenses"], 800.0);
        assert_eq!(json["summary"]["totalAvailable"], 1250.0);
        assert_eq!(json["summary"]["unpaidCount"], 1);
        assert_eq!(json["summary"]["expenseCount"], 1);
        assert_eq!(json["expenses"][0]["amount"], 800.0);
    }

    #[test]
    fn cents_conversion_is_exact() {
        for cents in [0i64, 1, 5, 99, 100, 12_035, 999_999_999, -1] {
            let back = (euros(cents) * 100.0).round() as i64;
            assert_eq!(back, cents, "{cents} did not round-trip");
        }
        assert_eq!(euros(70_50), 70.5);
        assert_eq!(euros(1), 0.01);
    }
}
