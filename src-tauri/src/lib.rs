//! Finanças da Casa — Tauri 2 desktop application (fully offline).
//!
//! Rust owns the SQLite database (integer cents), all financial
//! calculations, validation, backups and native dialogs. The frontend is
//! the original web UI, bundled locally and bridged through `invoke()`.

pub mod commands;
pub mod db;
pub mod ids;
pub mod menu;
pub mod models;
pub mod summary;
pub mod validate;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Database in the OS application-data directory, e.g.
            // Linux: ~/.local/share/app.financas.casa/financas.db
            let data_dir = app.path().app_data_dir()?;
            let db_path = data_dir.join("financas.db");
            let database = db::open(&db_path).map_err(std::io::Error::other)?;
            app.manage(database);

            menu::install(app.handle())?;
            Ok(())
        })
        .on_menu_event(|app, event| menu::handle(app, event))
        .invoke_handler(tauri::generate_handler![
            commands::finance::finance_get,
            commands::finance::db_stats,
            commands::expenses::expense_create,
            commands::expenses::expense_update,
            commands::expenses::expense_delete,
            commands::income::income_set,
            commands::backup::backup_export,
            commands::backup::backup_import,
            commands::backup::csv_export,
            commands::backup::import_legacy_db,
            commands::backup::import_legacy_dialog,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Finanças da Casa");
}
