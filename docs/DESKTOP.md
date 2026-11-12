# Desktop app (Rust / Tauri 2 / SQLite)

Fully offline desktop version of the household finances app. One React
frontend, two backends:

* **Web** — Next.js server + Prisma + `db/custom.db` (unchanged).
* **Desktop** — Tauri 2 serves the same UI from a static export and all data
  goes through Rust commands (`src-tauri/src/lib.rs`) into `finances-core`
  (rusqlite, integer cents). No Node, no network, no accounts.

The database lives in the OS application-data directory:

| OS | Path |
| --- | --- |
| Windows | `%APPDATA%\com.joaosaraiva.household-finances\data.sqlite` |
| macOS | `~/Library/Application Support/com.joaosaraiva.household-finances/data.sqlite` |
| Linux | `$XDG_DATA_HOME/com.joaosaraiva.household-finances/data.sqlite` (default `~/.local/share/…`) |

## Prerequisites

* [Rust](https://rustup.rs) (stable) — `rustc 1.77+`
* [Bun](https://bun.sh) (runs the UI build)
* Platform packages (only what Tauri needs to compile the shell):
  * **Windows**: WebView2 (pre-installed on Windows 10/11) + MSVC Build Tools
  * **macOS**: Xcode Command Line Tools (`xcode-select --install`)
  * **Debian/Ubuntu**: `libwebkit2gtk-4.1-dev build-essential libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev`

## Run in development

```bash
bun install
bunx @tauri-apps/cli dev          # builds the UI (bun run build:desktop is NOT used in dev —
                                  # tauri.conf.json points devUrl at the Next dev server)
```

`tauri.conf.json` runs `bun run dev` (Next on port 3000) and opens a native
window against it. Data still goes through the Rust commands (the UI detects
the Tauri environment through `src/lib/transport.ts`).

## Production build

```bash
bun install
bunx @tauri-apps/cli build
```

This runs `bun run build:desktop` (static export into `out/`, with the
web-only API routes safely set aside), compiles the Rust shell in release
mode and produces installers for the current OS in `src-tauri/target/release/bundle/`:

| OS | Bundles |
| --- | --- |
| Windows | MSI (`msi/`), NSIS installer (`nsis/`) |
| macOS | `.app` + `.dmg` (`dmg/`) |
| Linux | `.deb` (`deb/`), `.rpm` (`rpm/`), AppImage (`appimage/`) |

## Bringing your web data across (first run)

1. Build and start the desktop app once (creates the empty database).
2. In the app (or via a small script using the same command), invoke
   `migrate_legacy_cmd` with the path of a **copy** of the web database
   (`db/custom.db`). The migration:
   * backs up the target file first (`.pre-migration-*.bak`),
   * converts every float euro amount to integer cents,
   * preserves ids and timestamps,
   * never drops a row — odd values are repaired minimally and reported,
   * refuses to run on a non-empty database without `force`.
3. Everything else is regular app usage: **File → Backup** writes a
   checksummed JSON export; **File → Restore** verifies and atomically
   replaces all data; CSV export writes RFC 4180 with formula-injection
   protection and a UTF-8 BOM.

## Test suite (desktop side)

```bash
cargo test -p finances-core                    # 53 tests: validation, SQLi payloads,
                                               # summary parity, backup/restore, migration
cargo test -p finances-core --test rehearsal -- --ignored   # real-DB rehearsal (see file docs)
cargo check -p household-finances              # Tauri shell type-check
cargo clippy --workspace --all-targets         # zero warnings expected
```

The IPC layer is pinned to the web API contract by golden tests
(`crates/finances-core/src/view.rs`) and the cross-version parity suite
(`bun test tests/parity/parity.test.ts` runs both sides and compares).
