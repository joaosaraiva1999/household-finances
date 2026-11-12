//! Collision-resistant, time-sortable ids (cuid-like), matching the shape
//! the Prisma/web app used (`c` + lowercase alphanumerics).

use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use rand::Rng;

static COUNTER: AtomicU32 = AtomicU32::new(0);

const ALPHABET: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";

pub fn new_id() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let millis = now.as_millis() as u64;
    let counter = COUNTER.fetch_add(1, Ordering::Relaxed);
    let mut rng = rand::thread_rng();

    let mut id = String::with_capacity(25);
    id.push('c');
    id.push_str(&format!("{:x}", millis));
    id.push_str(&format!("{:04x}", counter & 0xffff));
    for _ in 0..8 {
        id.push(ALPHABET[rng.gen_range(0..ALPHABET.len())] as char);
    }
    id
}

/// RFC3339 UTC timestamp string (e.g. "2026-11-12T09:30:00.123456+00:00").
pub fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Micros, false)
}

/// "YYYY-MM" of the current local month (matches `currentMonthKey()`).
pub fn current_month_key() -> String {
    chrono::Local::now().format("%Y-%m").to_string()
}

/// "YYYY-MM" of the current UTC month (matches `toMonthKey(new Date())`,
/// which the web API uses for `meta.today`).
pub fn current_utc_month_key() -> String {
    chrono::Utc::now().format("%Y-%m").to_string()
}

pub fn is_valid_month(month: &str) -> bool {
    let b = month.as_bytes();
    if b.len() != 7 {
        return false;
    }
    let (y, rest) = b.split_at(4);
    let ok_year = y.iter().all(|c| c.is_ascii_digit());
    let sep = rest[0] == b'-';
    let (mm, tail) = rest[1..].split_at(2);
    let m: u32 = std::str::from_utf8(mm)
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    let ok_month = (1..=12).contains(&m);
    let ok_tail = tail.is_empty();
    ok_year && sep && ok_month && ok_tail
}
