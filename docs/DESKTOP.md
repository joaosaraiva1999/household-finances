# Desktop app: technical reference

The [desktop quick-start guide](../DESKTOP.md) explains installation and everyday use. This page keeps the implementation details useful to contributors and anyone packaging the app.

## What the desktop app is

The desktop version uses the same React interface as the web app, but replaces the web backend with a Rust/Tauri 2 shell and the finances-core SQLite library:

- The web version uses Next.js, Prisma, and db/custom.db.
- The desktop version uses Tauri commands, rusqlite, and integer cents in the OS app-data directory.
- The desktop frontend detects Tauri through src/lib/transport.ts and sends reads/writes through Rust IPC.
- There is no account, cloud sync, analytics, telemetry, or required network connection at runtime.

The desktop and web databases are intentionally separate. See the quick-start guide for the supported import workflow.

## Prerequisites

### Windows

- Stable [Rust](https://rustup.rs/) with the default MSVC toolchain.
- Visual Studio C++ Build Tools, including the Desktop development with C++ workload.
- [Bun](https://bun.sh/).
- WebView2, normally included with Windows 10/11.

### macOS

- Stable Rust and Bun.
- Xcode Command Line Tools: xcode-select --install.

### Debian/Ubuntu

- Stable Rust and Bun.
- Tauri platform packages:

~~~bash
sudo apt install libwebkit2gtk-4.1-dev build-essential libssl-dev \
  libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
~~~

## Development workflow

From the repository root:

~~~bash
bun install
bunx @tauri-apps/cli dev
~~~

The beforeDevCommand in src-tauri/tauri.conf.json runs bun run dev. Tauri connects the native window to http://localhost:3000; it does not use the static desktop export during development. The Rust backend is still active, so development data follows the desktop database rules.

Stop the process with Ctrl+C. Do not leave a separate bun run dev process listening on port 3000 when starting Tauri.

## Production artifacts

The beforeBuildCommand runs bun run build:desktop, which creates the static frontend in out/ while temporarily setting aside the web-only API routes. Tauri then compiles the Rust shell.

Build the standalone executable:

~~~bash
bunx @tauri-apps/cli build --no-bundle
~~~

Build the executable and platform installers:

~~~bash
bunx @tauri-apps/cli build
~~~

On Windows, the Cargo workspace writes output under the repository-level target/ directory:

~~~text
target/release/household-finances.exe
target/release/bundle/msi/
target/release/bundle/nsis/
~~~

Other platforms produce their normal Tauri bundles under target/release/bundle/:

| Platform | Typical bundles |
| --- | --- |
| Windows | .exe, MSI, NSIS installer |
| macOS | .app, .dmg |
| Linux | .deb, .rpm, AppImage |

The editable icon source is desktop/icon-source.svg; the generated platform icons live in src-tauri/icons/. Run bun run desktop:icon after changing the source icon.

## Database and data safety

The desktop database is created on first launch:

| OS | Path |
| --- | --- |
| Windows | %APPDATA%\com.joaosaraiva.household-finances\data.sqlite |
| macOS | ~/Library/Application Support/com.joaosaraiva.household-finances/data.sqlite |
| Linux | $XDG_DATA_HOME/com.joaosaraiva.household-finances/data.sqlite (normally ~/.local/share/...) |

The app's supported data operations are exposed through the native **Ficheiro** menu:

- **Novo backup…** writes a checksummed JSON backup.
- **Restaurar backup…** validates the selected backup, creates an automatic pre-restore backup, and transactionally replaces the current rows.
- **Exportar CSV…** writes RFC 4180-compatible CSV with a UTF-8 BOM and formula-injection protection.
- **Importar dados da versão web…** reads a copy of the web SQLite database, converts floating euro values to integer cents, preserves IDs/timestamps where possible, and reports imported/skipped rows.

For migration, always select a copy of db/custom.db. Do not point the importer at the only copy of the web database.

## Testing and checks

Desktop core tests:

~~~bash
cargo test -p finances-core
cargo test -p finances-core --test rehearsal -- --ignored
~~~

Tauri shell type-check and lint:

~~~bash
cargo check -p household-finances
cargo clippy --workspace --all-targets
~~~

The IPC layer is pinned to the web contract by golden tests in crates/finances-core/src/view.rs and the cross-version parity suite:

~~~bash
bun test tests/parity/parity.test.ts
~~~

## Troubleshooting build failures

- **cargo metadata: program not found**: add %USERPROFILE%\.cargo\bin to the current terminal's PATH, then verify cargo --version.
- **bun/bunx not recognized**: reopen the terminal after installing Bun; verify bun --version.
- **EADDRINUSE on port 3000**: stop the separate Next.js server before running tauri dev.
- **Executable locked or access denied**: close the running app before rebuilding.
- **WebView2 resource in use**: close old app/WebView2 sessions or restart Windows, then retry.
- **MSI ICE/Windows Installer errors**: build --no-bundle still produces the updated standalone executable; MSI packaging requires a working Windows Installer service.
