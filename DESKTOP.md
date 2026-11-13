# Household Finances desktop app

The desktop app is the easiest way to use Household Finances on one computer. It opens as a normal Windows, macOS, or Linux application and stores everything locally in SQLite. There is no account, cloud sync, Node server, or internet connection required after the app is built.

This page is the quick-start guide. The deeper technical notes and test commands are in [docs/DESKTOP.md](./docs/DESKTOP.md).

## Choose the version you want

| Version | Best for | How it runs | Where data lives |
| --- | --- | --- | --- |
| Web | Development or browser use | A local Next.js server at http://localhost:3000 | db/custom.db |
| Desktop | Everyday offline use | A native Tauri window | The operating system app-data folder |

The desktop and web databases are separate. Import your web data once if you want the desktop app to start with the same records.

## Windows: first launch in development

### 1. Install the prerequisites once

- [Rust](https://rustup.rs/) using the default Windows/MSVC option. If the installer offers Visual Studio C++ Build Tools, install the Desktop development with C++ workload.
- [Bun](https://bun.sh/), which runs the UI and Tauri commands.
- WebView2, normally already included with Windows 10 and Windows 11.

Node.js 18+ is also recommended because some project helper scripts call Node directly.

After installing Rust or Bun, close and reopen PowerShell. Check that the tools are visible:

~~~powershell
rustc --version
cargo --version
bun --version
~~~

If rustc or cargo is installed but not found, add Rust to the current PowerShell session:

~~~powershell
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
~~~

If Bun was installed with its standard installer but is not found, restart PowerShell first; its usual folder is %USERPROFILE%\.bun\bin.

### 2. Install the project dependencies

Open PowerShell in the project folder:

~~~powershell
cd "C:\Users\User\Desktop\Financial App\household-finances"
bun install
~~~

You only need to repeat bun install after dependency changes or a fresh checkout.

### 3. Start the app

~~~powershell
bunx @tauri-apps/cli dev
~~~

Tauri starts the Next.js development server on port 3000, compiles the Rust shell, and opens a native Household Finances window. The first Rust build can take 5–15 minutes; later launches are much faster.

Stop the app with Ctrl+C in the terminal. If you previously started bun run dev separately, stop that server before starting Tauri so port 3000 is free.

## How to use the app

1. **Complete the first-run setup.** Enter the two household names when prompted. This is stored locally in the app.
2. **Select a month.** The month selector keeps income, expenses, totals, charts, and upcoming bills in the same period.
3. **Enter income.** Add each person's salary and meal-card amount in their person card. Income can be updated whenever it changes.
4. **Add bills and other expenses.** Create an expense with its name, amount, category, due date, person responsible, paid status, and optional notes.
5. **Record credits.** Use a credit for money coming in that is not salary, such as a refund, bonus, or meal-card top-up. Credits increase the available balance.
6. **Split shared bills.** Use the shared option with the percentage split, or enter the exact amount each person paid. The app keeps the two shares aligned with the bill total.
7. **Keep payment status current.** Mark an item paid or unpaid from the expense list. Unpaid bills remain part of the committed household balance.
8. **Review the dashboard.** Use the filters, charts, person cards, and upcoming-bills section to see where the money went and what still needs attention.

The native menu is currently Portuguese:

- **Ficheiro**: create a backup, restore a backup, export CSV, import data from the web version, or quit.
- **Definições**: switch between Portuguese and English and toggle light/dark mode.
- **Ver**: zoom in, zoom out, reset zoom, or enter fullscreen.

## Protect and move your data

### Create a backup

Use **Ficheiro → Novo backup…** and save the JSON backup somewhere outside the project folder, such as an external drive or cloud storage you trust. Make a backup before moving computers or installing a large update.

### Restore a backup

Use **Ficheiro → Restaurar backup…** and choose a backup file. The app validates the file and creates a safety copy of the current database before replacing its data. Restore replaces the current desktop data, so choose the file carefully.

### Export CSV

Use **Ficheiro → Exportar CSV…** when you need a spreadsheet-friendly copy. The export uses UTF-8 and protects against spreadsheet formula injection.

### Import data from the web version

The web app and desktop app use different database files. To bring the web records into a new desktop database:

1. Close anything that is actively writing to the web database.
2. Make a copy of the web database at db/custom.db. Keep the original untouched.
3. Start the desktop app once so it creates its empty database.
4. Choose **Ficheiro → Importar dados da versão web…**.
5. Select the copy of custom.db and review the import report.

The importer preserves IDs and timestamps, converts euro amounts to integer cents, repairs only values that need a minimal correction, and reports what it imported or skipped. Import into an empty desktop database on the first run.

## Where the desktop database is stored

| Operating system | Database path |
| --- | --- |
| Windows | %APPDATA%\com.joaosaraiva.household-finances\data.sqlite |
| macOS | ~/Library/Application Support/com.joaosaraiva.household-finances/data.sqlite |
| Linux | $XDG_DATA_HOME/com.joaosaraiva.household-finances/data.sqlite or ~/.local/share/com.joaosaraiva.household-finances/data.sqlite |

Do not edit data.sqlite by hand. Use the app's backup, restore, CSV, and import actions instead.

## Build a standalone Windows executable

To build the native executable without creating installers:

~~~powershell
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:USERPROFILE\.bun\bin;$env:Path"
bunx @tauri-apps/cli build --no-bundle
~~~

The executable is created at:

~~~text
target\release\household-finances.exe
~~~

To create installers as well:

~~~powershell
bunx @tauri-apps/cli build
~~~

Windows installers are written under target\release\bundle\msi\ and target\release\bundle\nsis\. A previously installed copy or Start-menu shortcut will not update automatically; install the new MSI/NSIS package or launch the freshly built executable directly.

## Common problems

### bun or bunx is not recognized

Close and reopen PowerShell after installing Bun. Verify with bun --version. bunx is included with Bun; it is not a separate package.

### cargo metadata: program not found

Rust is either not installed or %USERPROFILE%\.cargo\bin is not in the current terminal's PATH:

~~~powershell
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
cargo --version
~~~

### EADDRINUSE on port 3000

Stop the separate web server with Ctrl+C. Tauri starts its own Next.js server.

### Access denied while replacing household-finances.exe

Close the running desktop app and any old household-finances.exe process, then run the build again.

### The old icon is still visible

Make sure you are launching target\release\household-finances.exe or installing the newest package. An old installed copy, shortcut, or Windows icon cache can continue to show the previous icon.

### WebView2 says the resource is in use

Close any existing Household Finances window and retry. If the old window is no longer visible, end only the related app process in Task Manager; restarting Windows clears a stuck WebView2 session.
