//! Native application menu (Ficheiro / Editar / Ver / Definições / Ajuda).
//! Menu items either perform Rust-side work (dialogs, zoom) or emit events
//! the frontend listens for (language, theme).

use std::sync::Arc;

use tauri::{
    menu::{IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    AppHandle, Emitter, Manager, Wry,
};
use tauri_plugin_dialog::DialogExt;

type BoxedItem = Box<dyn IsMenuItem<Wry>>;

fn item(app: &AppHandle, id: &str, text: &str, accelerator: Option<&str>) -> tauri::Result<BoxedItem> {
    Ok(Box::new(MenuItem::with_id(app, id, text, true, accelerator)?))
}

fn sep(app: &AppHandle) -> tauri::Result<BoxedItem> {
    Ok(Box::new(PredefinedMenuItem::separator(app)?))
}

pub fn install(app: &AppHandle) -> tauri::Result<()> {
    let file: Vec<BoxedItem> = vec![
        item(app, "backup-export", "Novo backup…", Some("CmdOrCtrl+B"))?,
        item(app, "backup-import", "Restaurar backup…", Some("CmdOrCtrl+R"))?,
        sep(app)?,
        item(app, "csv-export", "Exportar CSV…", Some("CmdOrCtrl+E"))?,
        item(app, "import-legacy", "Importar dados da versão web…", None)?,
        sep(app)?,
        item(app, "quit", "Sair", Some("CmdOrCtrl+Q"))?,
    ];
    let file_refs: Vec<&dyn IsMenuItem<Wry>> = file.iter().map(|b| b.as_ref()).collect();
    let file = Submenu::with_items(app, "Ficheiro", true, &file_refs)?;

    let edit: Vec<BoxedItem> = vec![
        Box::new(PredefinedMenuItem::undo(app, Some("Desfazer"))?),
        Box::new(PredefinedMenuItem::redo(app, Some("Refazer"))?),
        sep(app)?,
        Box::new(PredefinedMenuItem::cut(app, Some("Cortar"))?),
        Box::new(PredefinedMenuItem::copy(app, Some("Copiar"))?),
        Box::new(PredefinedMenuItem::paste(app, Some("Colar"))?),
        Box::new(PredefinedMenuItem::select_all(app, Some("Selecionar tudo"))?),
    ];
    let edit_refs: Vec<&dyn IsMenuItem<Wry>> = edit.iter().map(|b| b.as_ref()).collect();
    let edit = Submenu::with_items(app, "Editar", true, &edit_refs)?;

    let view: Vec<BoxedItem> = vec![
        item(app, "zoom-in", "Ampliar", Some("CmdOrCtrl+="))?,
        item(app, "zoom-out", "Reduzir", Some("CmdOrCtrl+-"))?,
        item(app, "zoom-reset", "Tamanho real", Some("CmdOrCtrl+0"))?,
        sep(app)?,
        Box::new(PredefinedMenuItem::fullscreen(app, Some("Ecrã inteiro"))?),
    ];
    let view_refs: Vec<&dyn IsMenuItem<Wry>> = view.iter().map(|b| b.as_ref()).collect();
    let view = Submenu::with_items(app, "Ver", true, &view_refs)?;

    let settings: Vec<BoxedItem> = vec![
        item(app, "lang-pt", "Idioma: Português", None)?,
        item(app, "lang-en", "Idioma: English", None)?,
        sep(app)?,
        item(app, "toggle-theme", "Alternar tema claro/escuro", None)?,
    ];
    let settings_refs: Vec<&dyn IsMenuItem<Wry>> = settings.iter().map(|b| b.as_ref()).collect();
    let settings = Submenu::with_items(app, "Definições", true, &settings_refs)?;

    let help: Vec<BoxedItem> = vec![item(
        app,
        "about",
        "Acerca de Finanças da Casa",
        None,
    )?];
    let help_refs: Vec<&dyn IsMenuItem<Wry>> = help.iter().map(|b| b.as_ref()).collect();
    let help = Submenu::with_items(app, "Ajuda", true, &help_refs)?;

    let menu = Menu::with_items(app, &[&file, &edit, &view, &settings, &help])?;
    app.set_menu(menu)?;
    Ok(())
}

pub fn handle(app: &AppHandle, event: tauri::menu::MenuEvent) {
    let id = event.id().as_ref();
    match id {
        "quit" => app.exit(0),
        "backup-export" => spawn_db_job(app, DbJob::BackupExport),
        "backup-import" => spawn_db_job(app, DbJob::BackupImport),
        "csv-export" => spawn_db_job(app, DbJob::CsvExport),
        "import-legacy" => spawn_db_job(app, DbJob::ImportLegacyDialog),
        "about" => show_about(app),
        "zoom-in" => zoom(app, 0.1),
        "zoom-out" => zoom(app, -0.1),
        "zoom-reset" => set_zoom(app, 1.0),
        "lang-pt" => {
            let _ = app.emit("menu://language", "pt");
        }
        "lang-en" => {
            let _ = app.emit("menu://language", "en");
        }
        "toggle-theme" => {
            let _ = app.emit("menu://toggle-theme", ());
        }
        _ => {}
    }
}

enum DbJob {
    BackupExport,
    BackupImport,
    CsvExport,
    ImportLegacyDialog,
}

/// Menu events run on the main thread — heavy work and dialogs must be
/// spawned onto a background thread.
fn spawn_db_job(app: &AppHandle, job: DbJob) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let state = app.state::<crate::db::Db>();
        let conn = Arc::clone(&state.conn);
        let path = state.path.clone();
        drop(state);

        let to_value = |v: serde_json::Value| v;
        let result: Result<serde_json::Value, String> = match job {
            DbJob::BackupExport => super::commands::backup::run_backup_export(app.clone(), conn)
                .await
                .map(|v| to_value(serde_json::to_value(v).unwrap_or(serde_json::Value::Null))),
            DbJob::BackupImport => super::commands::backup::run_backup_import(app.clone(), conn, path)
                .await
                .map(|v| serde_json::to_value(v).unwrap_or(serde_json::Value::Null)),
            DbJob::CsvExport => super::commands::backup::run_csv_export(app.clone(), conn)
                .await
                .map(|v| serde_json::to_value(v).unwrap_or(serde_json::Value::Null)),
            DbJob::ImportLegacyDialog => {
                super::commands::backup::run_import_legacy_dialog(app.clone(), conn, path)
                    .await
                    .map(|v| serde_json::to_value(v).unwrap_or(serde_json::Value::Null))
            }
        };

        // Report the outcome to the UI (toasts + data refresh).
        let payload = match result {
            Ok(v) => serde_json::json!({ "ok": true, "result": v }),
            Err(e) => serde_json::json!({ "ok": false, "error": e }),
        };
        let _ = app.emit("menu://job-done", payload);
    });
}

fn show_about(app: &AppHandle) {
    let version = app.package_info().version.to_string();
    let text = format!(
        "Finanças da Casa v{version}\n\nPainel de finanças domésticas partilhadas para duas pessoas.\nTodos os dados ficam guardados neste computador — a aplicação funciona 100% offline.\n\n© 2026 João Saraiva"
    );
    app.dialog()
        .message(text)
        .title("Acerca de Finanças da Casa")
        .blocking_show();
}

fn zoom(app: &AppHandle, delta: f64) {
    use std::sync::atomic::{AtomicI32, Ordering};
    static ZOOM_PCT: AtomicI32 = AtomicI32::new(100);
    if let Some(w) = app.get_webview_window("main") {
        let current = ZOOM_PCT.load(Ordering::Relaxed) as f64 / 100.0;
        let next = (current + delta).clamp(0.5, 2.0);
        let _ = w.set_zoom(next);
        ZOOM_PCT.store((next * 100.0).round() as i32, Ordering::Relaxed);
    }
}

fn set_zoom(app: &AppHandle, level: f64) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_zoom(level);
    }
}
