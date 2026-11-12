//! Exact port of the web app's financial calculations
//! (src/lib/finance.ts: personShare / breakdownFor / computeSummary).
//!
//! Works in integer cents; the JSON boundary converts back to euro floats.
//! Rule kept from the original: every expense counts towards the balance
//! regardless of `paid` — unpaid bills reserve money that is still due.

use serde::Serialize;

use crate::validate::{from_cents, json_truthy};

#[derive(Debug, Clone)]
pub struct ExpenseCents {
    pub id: String,
    pub name: String,
    pub amount_cents: i64,
    pub kind: String,
    pub category: String,
    pub responsible: String,
    /// 0–100 (up to one decimal).
    pub joao_share: f64,
    pub joao_paid_cents: Option<i64>,
    pub anna_paid_cents: Option<i64>,
    pub due_date: Option<String>,
    pub paid: bool,
    pub notes: Option<String>,
    pub month: String,
}

impl ExpenseCents {
    pub fn to_record(&self) -> crate::models::ExpenseRecord {
        crate::models::ExpenseRecord {
            id: self.id.clone(),
            name: self.name.clone(),
            amount: from_cents(self.amount_cents),
            kind: self.kind.clone(),
            category: self.category.clone(),
            responsible: self.responsible.clone(),
            joao_share: self.joao_share,
            joao_paid: self.joao_paid_cents.map(from_cents),
            anna_paid: self.anna_paid_cents.map(from_cents),
            due_date: self.due_date.clone(),
            paid: self.paid,
            notes: self.notes.clone(),
            month: self.month.clone(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct IncomeCents {
    pub id: String,
    pub person: String,
    pub month: String,
    pub amount_cents: i64,
    pub meal_card_cents: i64,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

impl IncomeCents {
    pub fn to_record(&self) -> crate::models::IncomeRecord {
        crate::models::IncomeRecord {
            id: self.id.clone(),
            person: self.person.clone(),
            month: self.month.clone(),
            amount: from_cents(self.amount_cents),
            meal_card: from_cents(self.meal_card_cents),
        }
    }
}

// ─── JSON DTOs ───────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonBreakdown {
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HouseholdSummary {
    pub joao: PersonBreakdown,
    pub anna: PersonBreakdown,
    pub total_income: f64,
    pub total_expenses: f64,
    pub total_available: f64,
    pub paid_expenses: f64,
    pub unpaid_expenses: f64,
    pub unpaid_count: usize,
    pub paid_count: usize,
    pub expense_count: usize,
    pub upcoming: Vec<crate::models::ExpenseRecord>,
    pub overdue: Vec<crate::models::ExpenseRecord>,
}

#[derive(Debug, Serialize)]
pub struct FinanceResponse {
    pub month: String,
    pub incomes: Vec<crate::models::IncomeRecord>,
    pub expenses: Vec<crate::models::ExpenseRecord>,
    pub available_months: Vec<String>,
    pub summary: HouseholdSummary,
    pub meta: MetaToday,
}

#[derive(Debug, Serialize)]
pub struct MetaToday {
    pub today: String,
}

// ─── Core rules ──────────────────────────────────────────────────────────────

/// How much of an expense (in cents) is borne by `person`.
/// `person` is "joao" | "anna".
pub fn person_share_cents(expense: &ExpenseCents, person: &str) -> i64 {
    if expense.responsible == person {
        return expense.amount_cents;
    }
    if expense.responsible == "shared" {
        // Exact paid amounts only apply to shared money-out entries.
        if expense.kind == "expense" {
            if let (Some(j), Some(a)) = (expense.joao_paid_cents, expense.anna_paid_cents) {
                return if person == "joao" { j } else { a };
            }
        }
        let share = if person == "joao" {
            expense.joao_share
        } else {
            100.0 - expense.joao_share
        };
        // JS: round2((amount * share) / 100) — in cents this is
        // Math.round((amount_cents/100) * share) with the same f64 ops.
        let amount_euros = expense.amount_cents as f64 / 100.0;
        return (amount_euros * share).round() as i64;
    }
    0
}

#[derive(Debug, Clone)]
struct BreakdownCents {
    salary: i64,
    meal_card: i64,
    credits: i64,
    personal: i64,
    shared: i64,
    paid: i64,
    unpaid: i64,
}

fn breakdown_cents(expenses: &[ExpenseCents], person: &str, salary: i64, meal_card: i64) -> BreakdownCents {
    let mut b = BreakdownCents { salary, meal_card, credits: 0, personal: 0, shared: 0, paid: 0, unpaid: 0 };
    for e in expenses {
        let share = person_share_cents(e, person);
        if e.kind == "credit" {
            b.credits += share;
            continue;
        }
        if e.responsible == person {
            b.personal += share;
        } else if e.responsible == "shared" {
            b.shared += share;
        }
        if e.paid {
            b.paid += share;
        } else {
            b.unpaid += share;
        }
    }
    b
}

/// "YYYY-MM-DD" today in UTC (the web app's `daysUntil` uses UTC dates).
fn today_utc_date() -> chrono::NaiveDate {
    chrono::Utc::now().date_naive()
}

/// Days until a due date relative to today (negative = overdue).
pub fn days_until(due_date: &str) -> i64 {
    let Ok(due) = chrono::NaiveDate::parse_from_str(due_date, "%Y-%m-%d") else {
        return 0;
    };
    (due - today_utc_date()).num_days()
}

fn to_breakdown(b: &BreakdownCents) -> PersonBreakdown {
    let total = b.personal + b.shared;
    let income = b.salary + b.meal_card + b.credits;
    PersonBreakdown {
        salary: from_cents(b.salary),
        meal_card: from_cents(b.meal_card),
        credits: from_cents(b.credits),
        income: from_cents(income),
        personal_expenses: from_cents(b.personal),
        shared_expenses: from_cents(b.shared),
        total_expenses: from_cents(total),
        available: from_cents(income - total),
        committed_pct: if income > 0 {
            let pct = (total as f64 / income as f64) * 100.0;
            (pct.round() as i64).min(200)
        } else {
            0
        },
        paid_amount: from_cents(b.paid),
        unpaid_amount: from_cents(b.unpaid),
    }
}

/// Compute the full household summary for a month (port of computeSummary).
pub fn compute_summary(expenses: &[ExpenseCents], incomes: &[IncomeCents]) -> HouseholdSummary {
    let income_for = |person: &str| -> (i64, i64) {
        incomes
            .iter()
            .find(|i| i.person == person)
            .map(|i| (i.amount_cents, i.meal_card_cents))
            .unwrap_or((0, 0))
    };

    let (j_sal, j_meal) = income_for("joao");
    let (a_sal, a_meal) = income_for("anna");
    let joao = breakdown_cents(expenses, "joao", j_sal, j_meal);
    let anna = breakdown_cents(expenses, "anna", a_sal, a_meal);

    let bills: Vec<&ExpenseCents> = expenses.iter().filter(|e| e.kind == "expense").collect();
    let unpaid: Vec<&ExpenseCents> = bills.iter().filter(|e| !e.paid).copied().collect();
    let mut with_due: Vec<&ExpenseCents> = unpaid
        .iter()
        .filter(|e| e.due_date.is_some())
        .copied()
        .collect();
    with_due.sort_by(|a, b| a.due_date.cmp(&b.due_date));

    let joao_b = to_breakdown(&joao);
    let anna_b = to_breakdown(&anna);

    // Totals sum the raw cent amounts (exactly what JS round2() does on
    // already cent-precise euro floats).
    let j_income = joao.salary + joao.meal_card + joao.credits;
    let a_income = anna.salary + anna.meal_card + anna.credits;
    let j_total = joao.personal + joao.shared;
    let a_total = anna.personal + anna.shared;

    HouseholdSummary {
        total_income: from_cents(j_income + a_income),
        total_expenses: from_cents(j_total + a_total),
        total_available: from_cents(j_income + a_income - j_total - a_total),
        paid_expenses: from_cents(joao.paid + anna.paid),
        unpaid_expenses: from_cents(joao.unpaid + anna.unpaid),
        unpaid_count: unpaid.len(),
        paid_count: bills.len() - unpaid.len(),
        expense_count: bills.len(),
        upcoming: with_due.iter().map(|e| e.to_record()).collect(),
        overdue: with_due
            .iter()
            .filter(|e| days_until(e.due_date.as_deref().unwrap_or_default()) < 0)
            .map(|e| e.to_record())
            .collect(),
        joao: joao_b,
        anna: anna_b,
    }
}
