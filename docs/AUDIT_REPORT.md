# Full Application Audit Report

**Scope:** web application (Next.js 16 / TypeScript / Prisma / SQLite) and desktop
application (Rust / Tauri 2 / `finances-core` / rusqlite).
**Method:** full source review, unit + integration + cross-version parity tests,
browser E2E on the production build, dependency audits, legacy-data migration
rehearsal against a copy of the real database.

---

## A. Architecture overview

| | Web | Desktop |
| --- | --- | --- |
| UI | React 19 (Next.js App Router, `src/components/finance/*`) | **Same React code**, statically exported (`bun run build:desktop` → `out/`), served by Tauri 2's WebView |
| Data layer | `src/hooks/use-finance.ts` → `src/lib/transport.ts` → `/api/*` route handlers → Prisma → `db/custom.db` | same hooks → `transport.ts` → Tauri IPC (`invoke`) → `src-tauri/src/lib.rs` → `finances-core` → rusqlite (integer cents) |
| Validation | `src/lib/validation.ts` (zod) + `src/lib/sanitize.ts` | `crates/finances-core/src/validation.rs` (mirrored 1:1) |
| Money math | `src/lib/finance.ts` (euros; percentage splits rounded in integer cents) | `crates/finances-core/src/{money,repo}.rs` (integer cents everywhere) |
| Summary math | `computeSummary` (TS) | `repo::compute_summary` (Rust) — **proven equivalent by the parity suite** |
| Backup/restore/CSV | — | `finances-core::backup` (SHA-256 checksum, atomic replace, confirmation gate) |
| Security envelope | `src/middleware.ts` (CSP, CSRF origin check, body cap, rate limit) | Tauri CSP + least-privilege capabilities (`core:default`, `dialog:default` only) |

Both implementations implement the same externally observable contract: month
data (expenses + incomes + available months + summary + `meta.today`), expense
CRUD with the shared-bill paid-split reconciliation, income upserts, and the
"unpaid bills still occupy the balance" rule. The Rust IPC layer
(`crates/finances-core/src/view.rs`) serializes exactly the web API's JSON
shapes, pinned by golden tests; `tests/parity/` proves both implementations
produce identical summaries and display ordering for identical inputs.

---

## B. Test coverage created / extended

| File | What it covers |
| --- | --- |
| `src/lib/__tests__/finance.test.ts` *(new)* | 33 unit tests: month helpers (UTC safety, year boundaries), `parseAmountInput` EN/PT conventions + strict rejection, `round2`, `personShare` (exact paid split, percentage, credits), `normalizePaidSplit` (clamping), `sharePercentFromPaid`, `daysUntil`, full `computeSummary` rules (unpaid occupy balance, credits → income, committedPct cap, empty month, upcoming/overdue ordering) |
| `src/lib/__tests__/transport.test.ts` *(new)* | 10 tests pinning the dual-transport contract: fetch path (JSON shape, error extraction, non-JSON fallback) and Tauri path (command + args mapping, `{code,message}` → `Error` normalization, never touches fetch) |
| `tests/api/web-api.test.ts` *(new)* | 31 integration tests against the REAL route handlers + a throwaway SQLite DB: full validation matrix (13 invalid-create cases), lifecycle create→read→patch→delete (incl. split rescale), 404s, empty-patch 400, income upsert field preservation, balance rules over the API, SQLi/NoSQLi payloads stored inert, control-char stripping, duplicate submissions, 10 concurrent creates, equal-due-date ordering regression, malformed JSON |
| `tests/api/middleware.test.ts` *(new)* | 10 tests: security headers, locked-down API CSP, cross-origin mutation 403 (incl. malformed Origin), body-size 413, mutation rate-limit 429 + `Retry-After` |
| `tests/parity/scenarios.json` + `tests/parity/parity.test.ts` + `crates/finances-core/tests/parity_export.rs` *(new)* | **Cross-version parity suite**: 5 shared scenarios (percentage splits, exact paid split, credits, rounding edges, display ordering) replayed through the real web API and the Rust core; compares every summary field (½-cent tolerance) and the displayed expense order |
| `crates/finances-core/tests/rehearsal.rs` *(new)* | `#[ignore]`-gated rehearsal: migrates a copy of the real `db/custom.db` and verifies row counts, ids, months, warnings and summary sanity |
| `src/lib/__tests__/security.test.ts` *(existing, kept green)* | 37 tests: XML escaping, CSV formula injection, CSS custom-property safety, control chars, zod schema matrix |
| `crates/finances-core/tests/*` *(existing, extended)* | `sql_injection.rs` (8 payload families; updated for due-date parity), `summary_parity.rs` (8), `backup_restore.rs` (5), `migration.rs` (4) + 27 unit tests incl. new `view.rs` golden JSON tests |

---

## C. Problems discovered

### Confirmed bugs (fixed — see §D)

| # | Severity | Version | Problem |
| --- | --- | --- | --- |
| C1 | **Critical** | Web (production builds) | Production pages were **completely inert**: the middleware's nonce-based `'strict-dynamic'` CSP can never work on statically prerendered pages — no script carries the per-request nonce, every script is blocked, React never hydrates, nothing is clickable. Dev mode skips the page CSP, which is why the app worked during development. Found by the browser E2E test (submit event never fired; zero React fiber keys in the DOM). |
| C2 | High | Both | `parseAmountInput` used bare `parseFloat`: `"12;5"` → 12, `"1e9"` → 1e9, `"1.2.3.4"` → 1.2 — an amount the user never typed could be stored; the Rust port already rejected these (parity divergence). |
| C3 | Medium | Both | One-cent float drift in percentage splits: web computed `round2(45.90 × 25%)` in floats (`11.4749…` → 11.47) while the cent-exact value 1147.5 must round half-up to 11.48. Diverged from the Rust integer-cents result; caught by the parity suite. |
| C4 | Medium | Web | Broken sort comparator contract: equal due dates returned `1` for both `(a,b)` and `(b,a)` — list order was engine/insertion dependent; did not match the Rust `ORDER BY due_date, name COLLATE NOCASE`. |
| C5 | Medium | Desktop (Rust) | `tauri.conf.json` window field `contextMenu` does not exist in Tauri 2 — `tauri build` fails with "unknown configuration field". |
| C6 | Medium | Desktop (Rust) | `Menu::default(app)` type error (needs `&AppHandle`) — the GUI shell did not compile. |
| C7 | Medium | Desktop (Rust) | `get_month_data` was missing the current month in `availableMonths` when the DB is empty (web always offers it) and `meta.today` was absent — the shared frontend's contract was incomplete; each table was also queried twice. |
| C8 | Low | Desktop (Rust) | Rust rejected a due date outside the expense's month on CREATE while the web API accepts any real calendar date (and Rust's own PATCH path didn't check it) — cross-version and intra-version inconsistency. |
| C9 | Low | Web | `src/app/api/route.ts` exposed a pointless `{"message":"Hello, world!"}` endpoint. |
| C10 | Low | Web | Prisma client logged every query (`log: ['query']`) in production — household financial values written to `server.log` (privacy + I/O). |
| C11 | Low | Web | `meta.today` carried a month key (`"2026-11"`) despite its name; desktop carried a full date. No consumer existed; standardized to a real UTC date. |
| C12 | Low | Web | `next.config.ts` had `typescript.ignoreBuildErrors: true`; the tsconfig pulled scaffold directories into type-checking and lacked `bun-types`. |
| C13 | Medium | Both (supply chain) | `next@16.1.3` carried 5 critical + several high advisories (RCE in image optimization, SSRF, DoS); `next-auth` (critical advisory) and 12 other runtime dependencies were completely unused; `sharp` had libvips CVEs; `lodash` (runtime via recharts) was vulnerable. |
| C14 | Low | Web | `use-mobile.ts` / `carousel.tsx` used setState-synchronously-in-effect (flagged by the updated React hooks lint; one frame of wrong state). |

### Security review (no action needed — verified)

* SQL injection: Prisma parameterization only (grep-verified — no `$queryRaw*` anywhere); Rust uses exclusively bound parameters, guarded by the payload test-suite; DB-level CHECK constraints as the last line of defense.
* XSS: React auto-escaping everywhere; **no** `dangerouslySetInnerHTML`, `eval`, `new Function`, `innerHTML` assignments in `src/` (grep-verified).
* XML: the apps emit no XML at runtime; mandatory escaping helpers exist and are unit-tested against classic payloads in both codebases.
* CSRF: same-origin enforcement on all mutations (tested); CSP `frame-ancestors 'none'` + `X-Frame-Options: DENY` (tested).
* CSV/formula injection: OWASP mitigation implemented and tested on both sides.
* Rust: no `unsafe` code anywhere in `finances-core` or the Tauri shell; `cargo audit` → **0 vulnerabilities** (2 informational notes: unmaintained `proc-macro-error`, unsound `glib 0.18` — both transitive).
* Secrets: none committed; `.gitignore` blocks `*.db`, `*.sqlite*`, `.env*`, `*.bak`; `db/custom.db` was snapshotted locally and never touched by tests.

### Remaining (accepted, documented)

* `bun audit` reports 30 advisories (21 high / 8 moderate / 1 low) — **all in dev-toolchain transitive dependencies** (eslint/babel/browserslist chains, prisma CLI's config chain). Zero advisories remain on the app's runtime path after the Next/sharp/lodash updates; direct runtime deps are clean.
* Household percentage splits can differ from the bill total by one cent when both shares round the same way (e.g. 25%/75% of 45.90 → 11.48 + 34.43 = 45.91). Inherent to independent per-person rounding; the exact-paid-split feature exists precisely for users who care. Both implementations behave identically (proven by parity tests).
* `currentMonthKey()` (web, default month) uses local time while the desktop uses UTC — the two can differ for about an hour around month boundaries in non-UTC timezones. Left as-is to avoid changing live web behavior; documented.
* GUI-level tests for the desktop app (launching the Tauri window) are impossible in this sandbox (no display, no system webkit); the shell is covered by `cargo check`/`clippy` + the fully tested core, and by the fact that the frontend is byte-identical to the E2E-tested web app.

---

## D. Fixes applied

| # | Fix | Files |
| --- | --- | --- |
| C1 | Page CSP changed to the static-render-compatible policy (`script-src 'self' 'unsafe-inline'` + all structural directives: no framing/objects/base-hijack/cross-origin forms); nonce machinery removed with a written rationale. **Verified interactive again by E2E on the production build.** | `src/middleware.ts` |
| C2 | Strict decimal parsing (mirrors the Rust parser; regression-tested) | `src/lib/finance.ts` |
| C3 | Percentage splits now round in integer cents, exactly like Rust | `src/lib/finance.ts` (`personShare`) |
| C4 | Total-order comparator shared by the API and the summary (`compareExpenseOrder`: due date, then case-insensitive name) | `src/lib/finance.ts`, `src/app/api/finance/route.ts` |
| C5/C6 | Removed invalid `contextMenu` window field; `Menu::default(app.handle())` | `src-tauri/tauri.conf.json`, `src-tauri/src/lib.rs` |
| C7 | IPC payload now mirrors the web contract exactly (`view.rs`: euros, camelCase, `meta.today`, availableMonths always includes the current month); queries fetched once | `crates/finances-core/src/view.rs` *(new)*, `src-tauri/src/lib.rs` |
| C8 | Removed the in-month due-date restriction from Rust create (web parity), pinned by test | `crates/finances-core/src/repo.rs`, `tests/sql_injection.rs` |
| C9 | Endpoint removed | `src/app/api/route.ts` *(deleted)* |
| C10 | Query logging disabled in production | `src/lib/db.ts` |
| C11 | `meta.today` = full UTC date on both sides | `src/app/api/finance/route.ts`, `view.rs` |
| C12 | Scaffold dirs excluded from type-checking; `bun-types` wired; type-check is now a clean gate | `tsconfig.json` |
| C13 | `next` 16.1.3 → 16.4.6, `sharp` → 0.35, removed 14 unused runtime deps (`next-auth`, `next-intl`, `@mdxeditor/editor`, `react-markdown`, `react-syntax-highlighter`, `@dnd-kit/*`, `uuid`, `zustand`, `@tanstack/react-table`, `@hookform/resolvers`, `date-fns`, `@reactuses/core`), `overrides` pin `lodash`/`defu`/`js-yaml`/`picomatch` to fixed versions. Audit: 106 findings (5 critical) → 30 findings (0 critical, 0 on the runtime path) | `package.json`, `bun.lock` |
| C14 | `useSyncExternalStore` for `useIsMobile`; deferred initial carousel state sync | `src/hooks/use-mobile.ts`, `src/components/ui/carousel.tsx` |
| — | Desktop build pipeline: static export previously failed on the API routes; `scripts/desktop-build.mjs` now sets `src/app/api` aside for the duration and always restores it (self-recovering after a crash) | `scripts/desktop-build.mjs` *(new)*, `package.json` |
| — | Desktop frontend wiring completed: `transport.ts` dual-transport (fetch / Tauri IPC) + hooks use it — the same React code now runs on both backends | `src/lib/transport.ts` *(new)*, `src/hooks/use-finance.ts` |
| — | Clippy warnings cleared (7), `cargo fmt` normalized, eslint clean under the stricter Next 16.4 config | various |

---

## E. Test execution results (final run)

| Test category | Total | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: | ---: |
| Web unit tests (finance, transport, security/sanitize, validation) | 80 | 80 | 0 | 0 |
| Web API integration tests (real handlers + SQLite) | 31 | 31 | 0 | 0 |
| Web middleware tests | 10 | 10 | 0 | 0 |
| Web E2E (browser, production build, scripted) | 6 flows | 6 | 0 | 0 |
| Rust unit tests (`finances-core` lib) | 27 | 27 | 0 | 0 |
| Rust integration tests (injection, parity, backup, migration) | 25 | 25 | 0 | 0 |
| Rust migration rehearsal (real DB copy) | 1 | 1 | 0 | 0 |
| Cross-version parity scenarios | 5 | 5 | 0 | 0 |
| **Total** | **185** | **185** | **0** | **0** |

Tool gates (all executed, all green):

| Check | Result |
| --- | --- |
| `bunx tsc --noEmit` | clean (was failing on scaffold dirs + missing bun-types) |
| `bun run lint` (eslint, Next 16.4 config) | clean (2 new strict-rule violations fixed) |
| `bun run build` (production) | success |
| `bun run build:desktop` (static export) | success, API routes restored |
| `cargo test -p finances-core` | 53/53 |
| `cargo check -p household-finances` (Tauri shell) | compiles clean (after C5/C6 fixes) |
| `cargo clippy` (workspace, all targets) | 0 warnings |
| `cargo fmt --check` | clean |
| `cargo audit` | 0 vulnerabilities |
| `bun audit` | 30 findings, all dev-toolchain transitive; runtime path clean |

E2E scenario executed on the **production** server build (headless Chromium):
onboarding → names persisted → salary set (€2,000) → expense added with
Portuguese decimal typing ("85,40" → €85.40) → 50/50 balance math verified in
the UI (€1,957.30 / −€42.70) → paid toggle persisted → delete via confirmation
dialog → balance restored. Zero console errors, zero CSP violations.

---

## F. Remaining problems / unverified areas

1. **Desktop GUI launch test** — cannot run the Tauri window in this headless
   sandbox (no display, no system webkit2gtk). Verified instead: `cargo check`
   + `clippy` on the shell, 53 tests on the core, and the E2E-proven identical
   frontend. First launch on a real machine should follow
   `docs/DESKTOP.md` (build/run/install instructions).
2. **Cross-platform bundles** (MSI/NSIS/DMG/AppImage/DEB/RPM) — packaging
   configs are in place (`tauri.conf.json`, icons), but building installers
   requires the target OSes; not verifiable from this Linux sandbox.
3. **Dev-toolchain advisories** — the 30 remaining `bun audit` findings live in
   build/lint tooling transitive deps; no fixed versions exist for some
   (e.g. older `js-yaml` majors pinned by eslint chains). No runtime exposure.
4. **Local-time vs UTC month boundary** (web default month) — documented in §C,
   intentionally unchanged.

---

## G. Modified files

**Created**
* `src/lib/transport.ts` — dual-transport (fetch ↔ Tauri IPC)
* `src/lib/__tests__/finance.test.ts`, `src/lib/__tests__/transport.test.ts`
* `tests/api/web-api.test.ts`, `tests/api/middleware.test.ts`
* `tests/api/helpers/env.ts`, `tests/api/helpers/test-db.ts`
* `tests/parity/scenarios.json`, `tests/parity/parity.test.ts`
* `crates/finances-core/src/view.rs` (web-shaped IPC serialization + golden tests)
* `crates/finances-core/tests/parity_export.rs`, `crates/finances-core/tests/rehearsal.rs`
* `scripts/desktop-build.mjs` (static-export pipeline with API-route stash/restore)
* `docs/AUDIT_REPORT.md` (this file)

**Modified**
* `src/middleware.ts` (CSP fix C1), `src/app/api/finance/route.ts` (C4, C11)
* `src/lib/finance.ts` (C2, C3, C4), `src/lib/db.ts` (C10)
* `src/hooks/use-finance.ts` (transport), `src/hooks/use-mobile.ts` (C14),
  `src/components/ui/carousel.tsx` (C14)
* `src-tauri/src/lib.rs` (C6, C7), `src-tauri/tauri.conf.json` (C5)
* `crates/finances-core/src/repo.rs` (C8), `crates/finances-core/tests/sql_injection.rs` (C8 pin),
  `crates/finances-core/tests/summary_parity.rs` (clippy allow)
* `package.json` (C13, build:desktop), `bun.lock` (C13), `tsconfig.json` (C12)
* `SECURITY.md` (CSP rationale, parity rows, verification commands), `README.md` (testing & desktop sections)

**Deleted**
* `src/app/api/route.ts` (C9 — unused hello-world endpoint)

**Explicitly untouched**
* `.gitignore` (per requirement — zero diff verified)
* `db/custom.db` (only a read-only copy was used for the migration rehearsal)
* The z.ai publish scaffolding (`.zscripts/`, `Caddyfile`, `mini-services/`, `tests/*.sh`, `examples/`)

---

## H. Final assessment

* **Correctness:** both implementations now produce provably identical results
  for the same inputs (5 parity scenarios, field-by-field), all balance rules
  are unit-, API- and UI-tested, and the real dataset migrates to the desktop
  core losslessly (18/18 + 4/4 rows, ids and timestamps preserved).
* **Security:** injection defenses are layered and test-pinned on both sides;
  the one real production weakness (inert-page CSP) is fixed and now E2E-
  verified on the exact artifact users run; runtime dependencies are free of
  known advisories.
* **Reliability:** production builds of both targets succeed; the desktop
  build pipeline is self-healing; backups/restores/migrations are atomic and
  checksum-verified.
* **Performance:** duplicate queries removed, query logging removed from
  production, integer-cents math, indexed month lookups on both sides. No
  measurable hotspots remain at this data scale.
* **Maintainability:** 185 automated tests, clean type-check/lint/fmt/clippy
  gates, a documented parity contract (`SECURITY.md`), and one shared frontend
  for both platforms.
