//! Data models mirroring the web app's JSON contract (src/lib/finance.ts).
//!
//! Money is stored in the database as **integer cents** and converted to
//! euro floats only at the JSON boundary, so all arithmetic stays exact.

use serde::{Deserialize, Serialize};

pub const PERSON_JOAO: &str = "joao";
pub const PERSON_ANNA: &str = "anna";
pub const RESPONSIBLES: [&str; 3] = ["joao", "anna", "shared"];
pub const KINDS: [&str; 2] = ["expense", "credit"];

/// Canonical expense categories (must match `CATEGORIES` in src/lib/finance.ts).
pub const CATEGORIES: [&str; 11] = [
    "Housing",
    "Utilities",
    "Groceries",
    "Transport",
    "Internet & Phone",
    "Insurance",
    "Health",
    "Entertainment",
    "Personal",
    "Education",
    "Other",
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IncomeRecord {
    pub id: String,
    pub person: String,
    pub month: String,
    pub amount: f64,
    pub meal_card: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpenseRecord {
    pub id: String,
    pub name: String,
    pub amount: f64,
    pub kind: String,
    pub category: String,
    pub responsible: String,
    /// 0–100, one decimal place.
    pub joao_share: f64,
    pub joao_paid: Option<f64>,
    pub anna_paid: Option<f64>,
    pub due_date: Option<String>,
    pub paid: bool,
    pub notes: Option<String>,
    pub month: String,
}

/// Body of `POST /api/expenses` (all fields required, month included).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpenseInput {
    pub name: Option<serde_json::Value>,
    pub amount: Option<serde_json::Value>,
    pub kind: Option<serde_json::Value>,
    pub category: Option<serde_json::Value>,
    pub responsible: Option<serde_json::Value>,
    pub joao_share: Option<serde_json::Value>,
    pub joao_paid: Option<serde_json::Value>,
    pub anna_paid: Option<serde_json::Value>,
    pub due_date: Option<serde_json::Value>,
    pub paid: Option<serde_json::Value>,
    pub notes: Option<serde_json::Value>,
    pub month: Option<serde_json::Value>,
}

/// Body of `PATCH /api/expenses/:id` — every field optional.
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExpensePatch {
    pub name: Option<serde_json::Value>,
    pub amount: Option<serde_json::Value>,
    pub kind: Option<serde_json::Value>,
    pub category: Option<serde_json::Value>,
    pub responsible: Option<serde_json::Value>,
    pub joao_share: Option<serde_json::Value>,
    pub joao_paid: Option<serde_json::Value>,
    pub anna_paid: Option<serde_json::Value>,
    pub due_date: Option<serde_json::Value>,
    pub paid: Option<serde_json::Value>,
    pub notes: Option<serde_json::Value>,
    /// The web contract never changes `month` on PATCH; accepted and ignored.
    #[serde(default)]
    pub month: Option<serde_json::Value>,
}

// ─── Response envelopes (identical JSON shapes to the web API) ──────────────

#[derive(Debug, Serialize)]
pub struct ExpenseEnvelope {
    pub expense: ExpenseRecord,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IncomeEnvelope {
    pub income: IncomeRecord,
}

#[derive(Debug, Serialize)]
pub struct OkEnvelope {
    pub ok: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbStats {
    pub incomes: i64,
    pub expenses: i64,
    pub months: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub incomes: i64,
    pub expenses: i64,
    pub skipped: i64,
}

// ─── JSON value helpers ──────────────────────────────────────────────────────

/// Coerce a JSON value into `String` the same way the web API does
/// (`String(body.x)` semantics for strings, numbers and booleans).
pub fn json_to_string(v: Option<&serde_json::Value>) -> String {
    match v {
        None | Some(serde_json::Value::Null) => "null".to_string(),
        Some(serde_json::Value::String(s)) => s.clone(),
        Some(serde_json::Value::Bool(b)) => b.to_string(),
        Some(serde_json::Value::Number(n)) => n.to_string(),
        Some(other) => other.to_string(),
    }
}

/// Extract a finite f64 from a JSON value, if possible.
pub fn json_to_f64(v: Option<&serde_json::Value>) -> Option<f64> {
    match v {
        Some(serde_json::Value::Number(n)) => n.as_f64().filter(|f| f.is_finite()),
        Some(serde_json::Value::String(s)) => s.trim().parse::<f64>().ok().filter(|f| f.is_finite()),
        Some(serde_json::Value::Bool(_)) | Some(serde_json::Value::Null) | None => None,
        _ => None,
    }
}
