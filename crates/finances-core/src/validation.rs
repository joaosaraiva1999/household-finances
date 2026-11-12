//! Input validation — the Rust mirror of `src/lib/validation.ts`.
//!
//! Every value that crosses the IPC boundary or arrives from a file (backup,
//! legacy database) passes through here before it may reach SQL or JSON.

use crate::error::{AppError, Result};

/// Maximum length of an expense name (characters).
pub const NAME_MAX: usize = 120;
/// Maximum length of the notes field (characters).
pub const NOTES_MAX: usize = 500;

// ─── Enumerations (closed sets, mirrored from the web app) ──────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Person {
    Joao,
    Anna,
}

impl Person {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Person::Joao => "joao",
            Person::Anna => "anna",
        }
    }

    /// Strict parse — used for stored/serialized values.
    pub fn parse(s: &str) -> Result<Self> {
        match s {
            "joao" => Ok(Person::Joao),
            "anna" => Ok(Person::Anna),
            other => Err(AppError::Validation(format!(
                "Invalid person: {other:?} (expected \"joao\" or \"anna\")"
            ))),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Responsible {
    Joao,
    Anna,
    Shared,
}

impl Responsible {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Responsible::Joao => "joao",
            Responsible::Anna => "anna",
            Responsible::Shared => "shared",
        }
    }

    pub fn parse(s: &str) -> Result<Self> {
        match s {
            "joao" => Ok(Responsible::Joao),
            "anna" => Ok(Responsible::Anna),
            "shared" => Ok(Responsible::Shared),
            other => Err(AppError::Validation(format!(
                "Invalid responsible: {other:?} (expected \"joao\", \"anna\" or \"shared\")"
            ))),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Expense,
    Credit,
}

impl Kind {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Kind::Expense => "expense",
            Kind::Credit => "credit",
        }
    }

    pub fn parse(s: &str) -> Result<Self> {
        match s {
            "expense" => Ok(Kind::Expense),
            "credit" => Ok(Kind::Credit),
            other => Err(AppError::Validation(format!(
                "Invalid entry type: {other:?} (expected \"expense\" or \"credit\")"
            ))),
        }
    }
}

/// Categories — must stay in sync with `CATEGORIES` in `src/lib/finance.ts`.
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

/// Unknown categories fall back to `"Other"` (same behaviour as the web app).
#[must_use]
pub fn normalize_category(raw: &str) -> String {
    let cleaned = clean_text(raw);
    if CATEGORIES.contains(&cleaned.as_str()) {
        cleaned
    } else {
        "Other".to_string()
    }
}

// ─── Text cleaning ───────────────────────────────────────────────────────────

/// Remove control characters except tab and newline; trim ends.
/// Mirrors `stripControlChars` in `src/lib/sanitize.ts`.
#[must_use]
pub fn clean_text(raw: &str) -> String {
    raw.chars()
        .filter(|c| !c.is_control() || *c == '\t' || *c == '\n')
        .collect::<String>()
        .trim()
        .to_string()
}

/// Clean and bound a required text field (name): rejects empty input and
/// anything longer than `max` after cleaning.
pub fn clean_bounded(raw: &str, max: usize, what: &str) -> Result<String> {
    let cleaned = clean_text(raw);
    if cleaned.is_empty() {
        return Err(AppError::Validation(format!("{what} is required")));
    }
    if cleaned.chars().count() > max {
        return Err(AppError::Validation(format!("{what} is too long")));
    }
    Ok(cleaned)
}

/// Clean an optional notes field: empty → `None`, otherwise capped at
/// [`NOTES_MAX`] characters (truncation, matching web behaviour).
#[must_use]
pub fn clean_notes(raw: Option<&str>) -> Option<String> {
    raw.map(clean_text)
        .filter(|s| !s.is_empty())
        .map(|s| s.chars().take(NOTES_MAX).collect())
}

// ─── Calendar values ─────────────────────────────────────────────────────────

fn is_digits(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())
}

/// Validate a `YYYY-MM` month key (01–12). Returns the input on success.
pub fn parse_month(raw: &str) -> Result<String> {
    let s = raw.trim();
    let ok = s.len() == 7
        && is_digits(&s[..4])
        && s.as_bytes()[4] == b'-'
        && matches!(
            &s[5..],
            "01" | "02" | "03" | "04" | "05" | "06" | "07" | "08" | "09" | "10" | "11" | "12"
        );
    if ok {
        Ok(s.to_string())
    } else {
        Err(AppError::Validation(format!(
            "Month must look like YYYY-MM, got {raw:?}"
        )))
    }
}

fn is_leap_year(y: i64) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

#[must_use]
pub fn days_in_month(year: i64, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if is_leap_year(year) {
                29
            } else {
                28
            }
        }
        _ => 0,
    }
}

/// Validate a `YYYY-MM-DD` due date — must be a **real** calendar date
/// (rejects `2026-02-31`, `2026-13-01`, `2026-99-99`, …). Returns the input.
pub fn parse_due_date(raw: &str) -> Result<String> {
    let s = raw.trim();
    let bad = || AppError::Validation(format!("Invalid due date: {raw:?}"));
    if s.len() != 10 || s.as_bytes()[4] != b'-' || s.as_bytes()[7] != b'-' {
        return Err(bad());
    }
    let (y, m, d) = (&s[..4], &s[5..7], &s[8..]);
    if !is_digits(y) || !is_digits(m) || !is_digits(d) {
        return Err(bad());
    }
    let year: i64 = y.parse().map_err(|_| bad())?;
    let month: u32 = m.parse().map_err(|_| bad())?;
    let day: u32 = d.parse().map_err(|_| bad())?;
    if month == 0 || month > 12 || day == 0 || day > days_in_month(year, month) {
        return Err(bad());
    }
    Ok(s.to_string())
}

/// Validate a database id: bounded length, alphanumerics plus `-`/`_`.
pub fn parse_id(raw: &str) -> Result<String> {
    let ok = !raw.is_empty()
        && raw.len() <= 64
        && raw
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
    if ok {
        Ok(raw.to_string())
    } else {
        Err(AppError::Validation("Invalid id".to_string()))
    }
}

/// Validate an expense amount in cents: `0 < cents <= EXPENSE_MAX_CENTS`.
pub fn validate_expense_cents(cents: i64) -> Result<i64> {
    if cents <= 0 || cents > crate::money::EXPENSE_MAX_CENTS {
        return Err(AppError::Validation(
            "Amount must be a positive number within limits".to_string(),
        ));
    }
    Ok(cents)
}

/// Validate an income field in cents: `0 <= cents <= INCOME_MAX_CENTS`.
pub fn validate_income_cents(cents: i64) -> Result<i64> {
    if !(0..=crate::money::INCOME_MAX_CENTS).contains(&cents) {
        return Err(AppError::Validation(
            "Income value must be within limits".to_string(),
        ));
    }
    Ok(cents)
}

/// Validate a split percentage: `0.0 <= share <= 100.0`, rounded to 0.1.
pub fn validate_share(share: f64) -> Result<f64> {
    if !share.is_finite() || !(0.0..=100.0).contains(&share) {
        return Err(AppError::Validation(
            "Share must be between 0 and 100".to_string(),
        ));
    }
    Ok((share * 10.0).round() / 10.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn months() {
        assert!(parse_month("2026-11").is_ok());
        assert!(parse_month("2026-13").is_err());
        assert!(parse_month("2026-00").is_err());
        assert!(parse_month("2026-1").is_err());
        assert!(parse_month("2026-11; DROP").is_err());
        assert!(parse_month("abcd-ef").is_err());
    }

    #[test]
    fn due_dates_reject_impossible_dates() {
        assert!(parse_due_date("2026-02-28").is_ok());
        assert!(parse_due_date("2024-02-29").is_ok()); // leap year
        assert!(parse_due_date("2026-02-31").is_err());
        assert!(parse_due_date("2026-13-01").is_err());
        assert!(parse_due_date("2026-99-99").is_err());
    }

    #[test]
    fn ids_reject_injection_payloads() {
        assert!(parse_id("cmwb37x400002os6dbjjqvobp").is_ok());
        assert!(parse_id("a'; DROP TABLE expenses;--").is_err());
        assert!(parse_id("").is_err());
        assert!(parse_id(&"x".repeat(65)).is_err());
    }

    #[test]
    fn text_cleaning() {
        assert_eq!(clean_text("  pão \u{0} e leite  "), "pão  e leite");
        assert!(clean_bounded("   ", NAME_MAX, "Name").is_err());
        assert!(clean_bounded(&"x".repeat(121), NAME_MAX, "Name").is_err());
        assert_eq!(clean_bounded(" ok ", NAME_MAX, "Name").unwrap(), "ok");
        assert_eq!(clean_notes(Some("  ")), None);
        assert_eq!(clean_notes(None), None);
        assert_eq!(
            clean_notes(Some(&"x".repeat(600))),
            Some("x".repeat(NOTES_MAX))
        );
    }

    #[test]
    fn categories_fall_back() {
        assert_eq!(normalize_category("Groceries"), "Groceries");
        assert_eq!(normalize_category("Internet & Phone"), "Internet & Phone");
        assert_eq!(normalize_category("EvilCategory"), "Other");
        assert_eq!(normalize_category("  Health "), "Health");
    }

    #[test]
    fn shares_and_cents() {
        assert_eq!(validate_share(50.0).unwrap(), 50.0);
        assert_eq!(validate_share(33.333).unwrap(), 33.3);
        assert!(validate_share(101.0).is_err());
        assert!(validate_share(f64::NAN).is_err());
        assert!(validate_expense_cents(0).is_err());
        assert!(validate_expense_cents(-1).is_err());
        assert!(validate_expense_cents(1_000_000_001).is_err());
        assert_eq!(
            validate_expense_cents(1_000_000_000).unwrap(),
            1_000_000_000
        );
        assert!(validate_income_cents(-1).is_err());
        assert_eq!(validate_income_cents(0).unwrap(), 0);
    }
}
