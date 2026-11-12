# Security Policy & Hardening Notes

This project is a **private, local-first household finance application** for
two people (João & Anna). This document describes the threat model and every
concrete protection implemented — in **both** codebases:

| Codebase | Path | Data layer |
| --- | --- | --- |
| Web app | Next.js 16 + TypeScript (`src/`) | Prisma → SQLite (`db/custom.db`) |
| Desktop app (Rust) | Tauri 2 + Rust (`crates/finances-core`, `src-tauri/`) | `rusqlite` (bundled SQLite), integer cents |

---

## 1. Threat model (honest scope)

This is a two-user family tool, not a multi-tenant SaaS. The realistic
threats are:

1. **Injection** — hostile strings typed into names/notes/amounts (or a
   tampered backup file) reaching SQL, XML, CSS, CSV or the shell.
2. **Cross-site attacks** — a malicious website making the browser fire
   requests at the app (CSRF), or framing it (clickjacking).
3. **Data exfiltration** — personal financial data leaving the machine, or
   being committed to git by accident.
4. **Supply-chain / runtime surprises** — remote code, version disclosure,
   half-written files after a crash.

What is **explicitly out of scope** (by design, and stated in the README):
there is no login system. The web app is meant to run for the household —
if you expose it beyond localhost, put it behind an authenticating reverse
proxy. The desktop app has no server at all and no network I/O.

---

## 2. SQL injection — defended at three layers

### Layer 1 — web: Prisma parameterization (verified)
* All queries go through Prisma Client (`src/lib/db.ts`), which binds
  every value as a parameter. **No `$queryRaw` / `$executeRaw` /
  `$queryRawUnsafe` / `$executeRawUnsafe` exists anywhere in `src/`**
  (grep-verified; keep it that way — this document is the contract).
* Route handlers only ever pass **validated, typed fields** (see §4) to
  Prisma — never raw request objects.

### Layer 2 — Rust: parameterized-only SQL (by construction)
* Every SQL statement in `crates/finances-core` is a **compile-time
  literal**. User data reaches SQLite **only** through bound parameters
  (`params![…]`). There is no `format!`-built SQL from data anywhere.
* The invariant is stated in the crate docs and guarded by the integration
  test-suite `crates/finances-core/tests/sql_injection.rs`, which pushes 8
  classic payloads (`Robert'); DROP TABLE expenses;--`, `' OR '1'='1`,
  `UNION SELECT`, `xp_cmdshell`, …) through **every** string-bearing input
  (name, notes, ids, month filters, income person/month, patches) and
  asserts: stored verbatim, other rows untouched, schema intact, no data
  leak through filters.

### Layer 3 — database CHECK constraints (both apps)
The desktop schema (`crates/finances-core/src/db.rs`) carries `CHECK`s on
enum domains (`kind IN ('expense','credit')`, `responsible IN (…)`,
`person IN (…)`, `paid IN (0,1)`), month/date shape (`length(month)=7` and
`substr(month,5,1)='-'`), amount ranges, text lengths and
paid-amount ≤ amount. Even a bug in application code cannot persist
nonsense. (The web app gets the equivalent guarantees from its Prisma
schema plus the zod layer below.)

**Test it yourself:** `cargo test -p finances-core` and `bun test`.

---

## 3. XML / markup injection

The applications emit **no XML at runtime** today. To keep it that way
safely, escaping is centralized and mandatory for any future XML/SVG
output:

* **Web:** `src/lib/sanitize.ts` — `escapeXml`, `escapeXmlAttribute`
  (escapes `& < > " '` + control characters; attribute values can never
  break out of quotes). Unit-tested against `<script>` and
  `" onmouseover="` payloads.
* **Rust:** `crates/finances-core/src/xml.rs` — `escape_text`,
  `escape_attr` (same rules, XML 1.0 control-character policy).
  Unit-tested against element injection, attribute breakouts and control
  characters.

**Policy:** any future code that emits XML (reports, RSS, Office formats,
SVG exports) MUST encode through these modules — no ad-hoc string building.

### Related output contexts (also centralized)

* **CSV / spreadsheets** — `sanitizeCsvCell` / `encodeCsvRow` (TS) and
  `csv::sanitize_cell` / `csv::encode_document` (Rust) implement the OWASP
  CSV-injection mitigation: cells starting with `=`, `+`, `-`, `@`, TAB are
  prefixed with `'`, so opening an export in Excel/LibreOffice cannot
  execute formulas. RFC 4180 quoting, CRLF, UTF-8 BOM.
* **CSS custom properties** — the shadcn chart theming injects a
  `<style>` blob; keys/colors are now passed through
  `sanitizeCssCustomPropKey` / `sanitizeCssColor` (strict allow-lists), so a
  hostile key or color can never close the rule block or inject
  declarations.

---

## 4. Input validation — one source of truth per codebase, mirrored 1:1

| Rule | Web (`src/lib/validation.ts`) | Rust (`validation.rs`) |
| --- | --- | --- |
| Name | cleaned, required, ≤ 120 chars | `clean_bounded(…, 120)` |
| Notes | cleaned, empty → null, truncated to 500 | `clean_notes` |
| Amount | finite number, (0, 10 000 000], rounded to cent | cents in (0, 1 000 000 000] |
| Income fields | finite, [0, 100 000 000] | cents in [0, 10 000 000 000] |
| Month | `^\d{4}-(0[1-9]\|1[0-2])$` | `parse_month` |
| Due date | regex **+ real calendar date** (rejects `2026-02-31`, `2026-99-99`) | `parse_due_date` (days-in-month, leap years) |
| Responsible / kind / person / category | closed zod enums / allow-list | closed enums, category fallback `"Other"` |
| Split % | finite, 0–100, rounded to 0.1 | `validate_share` |
| DB ids | charset `[A-Za-z0-9_-]`, ≤ 64 chars | `parse_id` |
| Control characters | stripped everywhere (`stripControlChars`) | `clean_text` |
| Unknown fields | stripped by zod (no mass assignment) | not mapped |

Behaviour fixed during hardening:

* `paid: "false"` (string) no longer becomes `true` (the old
  `Boolean(body.paid)` coercion bug) — booleans only.
* `"2026-99-99"` due dates are rejected instead of silently stored.
* Ids in URL params are validated before any database access.
* Amounts must be true JSON numbers — no `Number("…")` coercion of
  attacker-controlled strings.

---

## 5. Web hardening (`src/middleware.ts`, `next.config.ts`)

Applied to every request unless it is a static asset:

| Protection | Setting |
| --- | --- |
| CSP (pages, production) | `default-src 'self'; script-src 'self' 'nonce-…' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'` |
| CSP (API) | `default-src 'none'; frame-ancestors 'none'` — JSON never hosts active content |
| Clickjacking | `X-Frame-Options: DENY` + `frame-ancestors 'none'` |
| MIME sniffing | `X-Content-Type-Options: nosniff` |
| Referrer leakage | `Referrer-Policy: strict-origin-when-cross-origin` |
| Powerful APIs | `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()` |
| Version disclosure | `poweredByHeader: false` (no `X-Powered-By`) |
| TLS | HSTS (`max-age=63072000; includeSubDomains`) in production; ignored over plain HTTP |
| Cross-origin mutations | POST/PUT/PATCH/DELETE to `/api/*` with a foreign `Origin` → **403** (CSRF defense-in-depth) |
| Body size | `Content-Length > 64 KiB` on API mutations → **413** |
| Rate limiting | sliding window per client IP: 120 req/10 s on `/api`, 30 mutations/10 s → **429** (per-instance; the app deploys as a single instance) |

Notes:
* The nonce-based CSP follows the Next.js official pattern — Next injects
  the nonce into its bootstrap scripts automatically. Dev mode uses a
  relaxed CSP (HMR needs eval + websockets).
* `fetch` from the app itself is same-origin and unaffected by the origin
  check. Non-browser clients (curl, tests) send no `Origin` and are
  allowed.

---

## 6. Desktop hardening (Tauri)

* **CSP** (`src-tauri/tauri.conf.json`): `default-src 'self'`, no remote
  origins, `connect-src` limited to `self` + Tauri IPC, `object-src 'none'`,
  `frame-ancestors 'none'`. Known trade-off: `script-src` currently allows
  `'unsafe-inline'` because Next.js static export inlines flight-data
  scripts; the frontend-wiring phase should replace this with per-build
  hashes. No `unsafe-eval` anywhere.
* **Capabilities** (`src-tauri/capabilities/default.json`): least privilege —
  only `core:default` and `dialog:default` (native open/save dialogs for
  backup/CSV). No filesystem scope, no shell, no HTTP plugin.
* **No network**: the app performs zero network I/O. The database lives in
  the OS application-data dir; the file is opened with
  `SQLITE_OPEN_NOFOLLOW` (a pre-planted symlink cannot redirect writes) and
  hardened pragmas (`foreign_keys=ON`, WAL, `busy_timeout`).
* **Atomic writes**: backups and CSVs are written to a temp file and
  atomically renamed; restores and migrations run in a single transaction —
  a crash can never leave a half-replaced database.
* **IPC errors** are `{ code, message }` objects — no raw error strings,
  stack traces or SQL internals cross the boundary.

## 7. Backup / restore integrity

* Export = JSON **v1** envelope + **SHA-256 checksum** over the data
  payload.
* Import refuses: unknown `app`, unsupported version, checksum mismatch,
  or any record failing full re-validation.
* Restore is **gated behind an explicit `confirmed` flag** — the UI must
  show the destructive-action warning first (spec requirement), takes a
  `.pre-restore-*.bak` file copy, then replaces everything in one
  transaction.
* Legacy migration (web `db/custom.db` → desktop): pre-migration file
  backup, one transaction, ids/timestamps preserved, floats → integer
  cents, **rows are never dropped** — odd values are repaired minimally and
  reported in `MigrationReport.warnings`.

## 8. Privacy & data locality

* **No telemetry, no analytics, no error reporting, no accounts.**
* All data stays on the machine: web → `db/custom.db` (git-ignored),
  desktop → OS app-data dir. No CDN fonts, no CDN JS, no external requests
  (favicon and fonts are self-hosted).
* `.gitignore` blocks `db/`, `*.db`, `*.sqlite*`, `.env*`, `*.bak`,
  Rust build artifacts and local toolchains from ever being committed.
* Never commit a real database or a `.env` — CI and humans should treat
  any file matching those patterns as private.

## 9. Secrets hygiene

* GitHub tokens/PATs pasted in chats are **revoked after use** — treat any
  token that appeared in a conversation as burned.
* The publish pipeline needs no secrets in the repo; `.env` only ever holds
  `DATABASE_URL` locally.

## 10. Verification commands

```bash
# Web
bun install
bun test src/lib/__tests__/security.test.ts   # 37 security unit tests
bun run lint
bun run build                                  # production build must pass

# Rust (desktop core — includes the injection suites)
cargo test -p finances-core                    # 48 tests, all green
```

## 11. Reporting

This is a private repository for a household app. If you find a weakness,
fix it locally or contact the maintainer — please do not open public
issues containing real financial data.
