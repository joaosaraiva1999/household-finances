//! Money as integer cents — the only representation used for balances.
//!
//! Floating point never stores money: the web API accepts euros as `Float`
//! (legacy Prisma schema) but the desktop core converts at the boundary and
//! computes exclusively in `i64` cents. Conversion from legacy floats uses
//! round-half-away-from-zero (`.round()`), matching `Math.round` in TS.

/// Highest expense amount accepted: €10,000,000.00 (mirrors web `LIMITS.amountMax`).
pub const EXPENSE_MAX_CENTS: i64 = 1_000_000_000;
/// Highest income field accepted: €100,000,000.00 (mirrors web `LIMITS.incomeMax`).
pub const INCOME_MAX_CENTS: i64 = 10_000_000_000;

/// Convert a legacy float euro amount into integer cents (round-half-away).
#[must_use]
pub fn euros_to_cents(euros: f64) -> i64 {
    // Guard against NaN/∞ produced by corrupted legacy rows.
    if !euros.is_finite() {
        return 0;
    }
    (euros * 100.0).round() as i64
}

/// Format integer cents as a euro string.
///
/// * `pt` — Portuguese convention: `1.234,56 €` (dot thousands, comma decimals)
/// * `en` — English convention: `€1,234.56`
#[must_use]
pub fn format_eur(cents: i64, pt: bool) -> String {
    let negative = cents < 0;
    let abs = cents.unsigned_abs();
    let whole = abs / 100;
    let frac = abs % 100;
    let whole_str = thousands_group(whole, if pt { '.' } else { ',' });
    let sign = if negative { "-" } else { "" };
    if pt {
        format!("{sign}{whole_str},{frac:02} €")
    } else {
        format!("€{sign}{whole_str}.{frac:02}")
    }
}

fn thousands_group(mut n: u64, sep: char) -> String {
    let mut groups: Vec<String> = Vec::new();
    loop {
        groups.push((n % 1000).to_string());
        n /= 1000;
        if n == 0 {
            break;
        }
    }
    groups.reverse();
    groups
        .iter()
        .enumerate()
        .map(|(i, g)| {
            if i == 0 {
                g.clone()
            } else {
                format!("{sep}{g:0>3}")
            }
        })
        .collect()
}

/// Parse a user-typed monetary string into integer cents, tolerant of both
/// English ("1,234.56") and Portuguese ("1.234,56") conventions — a byte-wise
/// port of `parseAmountInput` in `src/lib/finance.ts`.
///
/// Returns `None` for anything that is not a plain (optionally signed) number.
#[must_use]
pub fn parse_amount_input(raw: &str) -> Option<i64> {
    let filtered: String = raw
        .chars()
        .filter(|c| *c != '€' && !c.is_whitespace())
        .collect();
    if filtered.is_empty() {
        return None;
    }

    let last_comma = filtered.rfind(',');
    let last_dot = filtered.rfind('.');

    let normalized = match (last_comma, last_dot) {
        (Some(c), Some(d)) => {
            if c > d {
                // Portuguese: dot = thousands, comma = decimal.
                filtered.replace('.', "").replacen(',', ".", 1)
            } else {
                // English: comma = thousands.
                filtered.replace(',', "")
            }
        }
        (Some(_), None) => {
            // Comma only: "1,234,567" (thousands) vs "1234,5" (decimal).
            let is_thousands = is_grouped(&filtered, ',');
            if is_thousands {
                filtered.replace(',', "")
            } else {
                filtered.replacen(',', ".", 1)
            }
        }
        (None, Some(_)) => filtered.clone(),
        (None, None) => filtered.clone(),
    };

    parse_euros_to_cents(&normalized)
}

/// Strict parser for the canonical form produced above: `[+-]?digits[.up-to-2-digits]`.
fn parse_euros_to_cents(s: &str) -> Option<i64> {
    let (sign, rest) = match s.strip_prefix('-') {
        Some(r) => (-1i64, r),
        None => (1i64, s.strip_prefix('+').unwrap_or(s)),
    };
    let (whole, frac) = match rest.split_once('.') {
        Some((w, f)) => (w, f),
        None => (rest, ""),
    };
    if whole.is_empty() && frac.is_empty() {
        return None;
    }
    if !whole.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    if !frac.bytes().all(|b| b.is_ascii_digit()) || frac.len() > 2 {
        return None;
    }
    let whole_cents = whole.parse::<i64>().ok()?.checked_mul(100)?;
    let frac_cents = match frac.len() {
        0 => 0,
        1 => i64::from(frac.as_bytes()[0] - b'0') * 10,
        2 => {
            let a = i64::from(frac.as_bytes()[0] - b'0');
            let b = i64::from(frac.as_bytes()[1] - b'0');
            a * 10 + b
        }
        _ => return None,
    };
    let cents = whole_cents.checked_add(frac_cents)?;
    // Negative amounts are never valid for user input; parsing keeps the sign
    // only for completeness — callers validate the domain range.
    Some(sign * cents)
}

/// `1,234,567` groups check (exactly 3 digits after each comma, 1-3 before first).
fn is_grouped(s: &str, sep: char) -> bool {
    let mut parts = s.split(sep);
    let first = parts.next().unwrap_or("");
    if first.is_empty() || first.len() > 3 || !first.bytes().all(|b| b.is_ascii_digit()) {
        return false;
    }
    let rest: Vec<&str> = parts.collect();
    !rest.is_empty() && rest.iter().all(|p| p.len() == 3 && p.bytes().all(|b| b.is_ascii_digit()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_both_locales() {
        assert_eq!(parse_amount_input("12.5"), Some(1250));
        assert_eq!(parse_amount_input("1,234.56"), Some(123_456));
        assert_eq!(parse_amount_input("1.234,56"), Some(123_456));
        assert_eq!(parse_amount_input("1,234,567"), Some(123_456_700));
        assert_eq!(parse_amount_input("€ 85,40"), Some(8540));
        assert_eq!(parse_amount_input("  9€ "), Some(900));
        assert_eq!(parse_amount_input("0.99"), Some(99));
    }

    #[test]
    fn parse_rejects_garbage_and_injection() {
        for bad in [
            "", "abc", "1.2.3.4", "12; DROP TABLE x", "1'23", "--", "1e9", "12,5,6,7",
        ] {
            assert_eq!(parse_amount_input(bad), None, "{bad:?} should not parse");
        }
    }

    #[test]
    fn format_both_locales() {
        assert_eq!(format_eur(123_456, true), "1.234,56 €");
        assert_eq!(format_eur(123_456, false), "€1,234.56");
        assert_eq!(format_eur(-500, true), "-5,00 €");
        assert_eq!(format_eur(5, false), "€0.05");
    }

    #[test]
    fn legacy_float_conversion_rounds_like_ts() {
        assert_eq!(euros_to_cents(800.0), 80_000);
        assert_eq!(euros_to_cents(19.99), 1_999);
        assert_eq!(euros_to_cents(0.1 + 0.2), 30); // 0.30000000000000004 → 30
        assert_eq!(euros_to_cents(f64::NAN), 0);
    }
}
