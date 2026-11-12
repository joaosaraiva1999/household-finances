//! # finances-core
//!
//! Security-first storage and business core for the Household Finances
//! desktop application (Tauri 2 / Rust / SQLite). The web application keeps
//! an equivalent implementation in TypeScript (`src/lib/*`) — see
//! `SECURITY.md` for the parity matrix.
//!
//! ## Security invariants (enforced here, verified by tests)
//!
//! 1. **SQL injection is impossible by construction.** Every SQL statement
//!    in this crate is a compile-time `const`/literal. User-supplied data
//!    reaches SQLite **only** through bound parameters (`params![]`,
//!    `query_map`, …). There is no `format!`-built SQL anywhere. The
//!    integration tests in `tests/` feed classic injection payloads into
//!    every string field and assert they are stored verbatim and harmless.
//! 2. **Defense in depth at the database level.** The schema carries
//!    `CHECK` constraints (enum domains, amount ranges, month/date shapes,
//!    text lengths), so even a bug elsewhere cannot persist nonsense.
//! 3. **Money is integer cents.** No floating-point arithmetic touches
//!    balances; parsing/formatting happens only at the edges.
//! 4. **All input is validated** through [`validation`]: closed enums,
//!    real calendar dates, control characters stripped, lengths capped —
//!    mirroring the web zod schemas 1:1.
//! 5. **XML output must go through [`xml::escape_text`] /
//!    [`xml::escape_attr`]**; CSV through [`csv`] (RFC 4180 + formula
//!    injection neutralization). These are the only sanctioned encoders.

pub mod backup;
pub mod csv;
pub mod db;
pub mod error;
pub mod migrate;
pub mod model;
pub mod money;
pub mod repo;
pub mod validation;
pub mod view;
pub mod xml;

pub use db::Store;
pub use error::{AppError, Result};
pub use model::{Expense, Income, NewExpense};
