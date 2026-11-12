//! Exact port of the web API's validation/sanitization rules
//! (src/app/api/expenses/route.ts `sanitize()` + src/lib/finance.ts helpers).
//!
//! Money is handled in integer cents; `to_cents` reproduces JS
//! `Math.round(x * 100)` semantics for every value that reaches it
//! (all inputs are non-negative after clamping).

use crate::ids::{current_month_key, is_valid_month};
use crate::models::*;

// ─── Money conversion ────────────────────────────────────────────────────────

/// JS `Math.round(x * 100)` → integer cents. Inputs reaching this are always
/// finite; negative values are clamped by callers before use.
pub fn to_cents(x: f64) -> i64 {
    (x * 100.0).round() as i64
}

/// Integer cents → euro float for the JSON boundary.
pub fn from_cents(c: i64) -> f64 {
    c as f64 / 100.0
}

/// JS `Boolean(value)` truthiness applied to a JSON value.
pub fn json_truthy(v: Option<&serde_json::Value>) -> bool {
    match v {
        None | Some(serde_json::Value::Null) => false,
        Some(serde_json::Value::Bool(b)) => *b,
        Some(serde_json::Value::Number(n)) => n.as_f64().map(|f| f != 0.0 && !f.is_nan()).unwrap_or(false),
        Some(serde_json::Value::String(s)) => !s.is_empty(),
        Some(serde_json::Value::Array(_)) | Some(serde_json::Value::Object(_)) => true,
    }
}

/// `typeof x === "string"` check used by the web API before accepting
/// month/dueDate/notes fields.
pub fn json_as_string(v: Option<&serde_json::Value>) -> Option<&str> {
    match v {
        Some(serde_json::Value::String(s)) => Some(s),
        _ => None,
    }
}

// ─── Shared-split normalization (port of normalizePaidSplit) ────────────────

/// The value provided (usually the one typed last) is kept, clamped to
/// [0, amount], and the other person automatically covers the remainder.
/// Returns `(joao_cents, anna_cents)` or `None` when no usable value exists.
pub fn normalize_paid_split(
    amount_cents: i64,
    joao_raw: Option<f64>,
    anna_raw: Option<f64>,
) -> Option<(i64, i64)> {
    if amount_cents <= 0 {
        return None;
    }
    if let Some(j) = joao_raw.filter(|v| v.is_finite()) {
        let joao = to_cents(j).clamp(0, amount_cents);
        return Some((joao, amount_cents - joao));
    }
    if let Some(a) = anna_raw.filter(|v| v.is_finite()) {
        let anna = to_cents(a).clamp(0, amount_cents);
        return Some((amount_cents - anna, anna));
    }
    None
}

/// Percentage share implied by the paid amount (port of sharePercentFromPaid).
pub fn share_percent_from_paid(joao_cents: i64, amount_cents: i64) -> f64 {
    if amount_cents <= 0 {
        return 50.0;
    }
    let pct = (joao_cents as f64 / amount_cents as f64) * 100.0;
    // JS: Math.min(100, Math.max(0, Math.round(x * 10) / 10))
    ((pct * 10.0).round() / 10.0).clamp(0.0, 100.0)
}

// ─── Sanitized row (all values already converted to cents) ──────────────────

#[derive(Debug, Clone)]
pub struct SanitizedExpense {
    pub name: String,
    pub amount_cents: i64,
    pub kind: String,
    pub category: String,
    pub responsible: String,
    pub joao_share: f64,
    pub joao_paid_cents: Option<i64>,
    pub anna_paid_cents: Option<i64>,
    pub due_date: Option<String>,
    pub notes: Option<String>,
    pub paid: bool,
    pub month: String,
}

/// Port of `sanitize()` in POST /api/expenses — identical rules, identical
/// error strings so the frontend behaves exactly like against the web API.
pub fn sanitize_create(body: &ExpenseInput) -> Result<SanitizedExpense, String> {
    // name = String(body.name ?? "").trim()
    let name_raw = match body.name.as_ref() {
        None | Some(serde_json::Value::Null) => String::new(),
        Some(v) => json_to_string(Some(v)),
    };
    let name = name_raw.trim().to_string();
    if name.is_empty() {
        return Err("Expense name is required".to_string());
    }
    if name.chars().count() > 120 {
        return Err("Name is too long".to_string());
    }

    // amount
    let amount_raw = json_to_f64(body.amount.as_ref())
        .ok_or_else(|| "Amount must be a positive number".to_string())?;
    if amount_raw <= 0.0 || amount_raw > 10_000_000.0 {
        return Err("Amount must be a positive number".to_string());
    }
    let amount_cents = to_cents(amount_raw);

    // kind
    let kind = match body.kind.as_ref() {
        None | Some(serde_json::Value::Null) => "expense".to_string(),
        Some(v) => json_to_string(Some(v)),
    };
    if !KINDS.contains(&kind.as_str()) {
        return Err("Invalid entry type".to_string());
    }

    // responsible
    let responsible = match body.responsible.as_ref() {
        None | Some(serde_json::Value::Null) => "shared".to_string(),
        Some(v) => json_to_string(Some(v)),
    };
    if !RESPONSIBLES.contains(&responsible.as_str()) {
        return Err("Invalid responsible person".to_string());
    }

    // joaoShare — CREATE order: round to 1 decimal, then clamp.
    let mut joao_share = json_to_f64(body.joao_share.as_ref()).unwrap_or(50.0);
    if responsible != "shared" {
        joao_share = if responsible == "joao" { 100.0 } else { 0.0 };
    }
    joao_share = ((joao_share * 10.0).round() / 10.0).clamp(0.0, 100.0);

    // Shared money-out bills may carry exact per-person paid amounts.
    let mut joao_paid_cents: Option<i64> = None;
    let mut anna_paid_cents: Option<i64> = None;
    if responsible == "shared" && kind == "expense" {
        let raw_joao = body
            .joao_paid
            .as_ref()
            .filter(|v| !v.is_null())
            .and_then(|v| json_to_f64(Some(v)));
        let raw_anna = body
            .anna_paid
            .as_ref()
            .filter(|v| !v.is_null())
            .and_then(|v| json_to_f64(Some(v)));
        if let Some((j, a)) = normalize_paid_split(amount_cents, raw_joao, raw_anna) {
            joao_paid_cents = Some(j);
            anna_paid_cents = Some(a);
            joao_share = share_percent_from_paid(j, amount_cents);
        }
    }

    // category
    let category_raw = match body.category.as_ref() {
        None | Some(serde_json::Value::Null) => "Other".to_string(),
        Some(v) => json_to_string(Some(v)),
    };
    let category = if CATEGORIES.contains(&category_raw.as_str()) {
        category_raw
    } else {
        "Other".to_string()
    };

    // month
    let month = json_as_string(body.month.as_ref())
        .filter(|m| is_valid_month(m))
        .map(str::to_string)
        .unwrap_or_else(current_month_key);

    // dueDate
    let due_date = json_as_string(body.due_date.as_ref())
        .filter(|d| is_iso_date(d))
        .map(str::to_string);

    // notes
    let notes = json_as_string(body.notes.as_ref())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.chars().take(500).collect::<String>());

    let paid = json_truthy(body.paid.as_ref());

    Ok(SanitizedExpense {
        name,
        amount_cents,
        kind,
        category,
        responsible,
        joao_share,
        joao_paid_cents,
        anna_paid_cents,
        due_date,
        notes,
        paid,
        month,
    })
}

/// `^\d{4}-\d{2}-\d{2}$`
pub fn is_iso_date(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10
        && b[0..4].iter().all(|c| c.is_ascii_digit())
        && b[4] == b'-'
        && b[5..7].iter().all(|c| c.is_ascii_digit())
        && b[7] == b'-'
        && b[8..10].iter().all(|c| c.is_ascii_digit())
}
