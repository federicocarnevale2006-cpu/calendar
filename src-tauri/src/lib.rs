use std::path::PathBuf;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

/// Cartella dove Trofeo LCD cerca il collegamento al calendario: %LOCALAPPDATA%\TrofeoLCD
fn trofeo_dir() -> Result<PathBuf, String> {
    let base = std::env::var("LOCALAPPDATA").map_err(|_| "cartella LOCALAPPDATA non trovata".to_string())?;
    Ok(PathBuf::from(base).join("TrofeoLCD"))
}

#[tauri::command]
fn write_trofeo_link(json: String) -> Result<String, String> {
    serde_json::from_str::<serde_json::Value>(&json).map_err(|e| format!("dati non validi: {e}"))?;
    let dir = trofeo_dir()?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let p = dir.join("calendario.json");
    let tmp = dir.join("calendario.json.tmp");
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &p).map_err(|e| e.to_string())?;
    Ok(p.to_string_lossy().to_string())
}

#[tauri::command]
fn read_trofeo_link() -> Option<String> {
    let p = trofeo_dir().ok()?.join("calendario.json");
    if p.exists() {
        Some(p.to_string_lossy().to_string())
    } else {
        None
    }
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--nascosto"]),
        ))
        .invoke_handler(tauri::generate_handler![write_trofeo_link, read_trofeo_link])
        .setup(|app| {
            let open = MenuItem::with_id(app, "apri", "Apri Calendario", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "esci", "Esci", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;
            let mut tray = TrayIconBuilder::with_id("tray")
                .tooltip("Calendario")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, ev| match ev.id.as_ref() {
                    "apri" => show_main(app),
                    "esci" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, ev| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = ev {
                        show_main(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            // avviato con Windows: resta nell'area di notifica (per i promemoria) senza aprire la finestra
            let hidden = std::env::args().any(|a| a == "--nascosto");
            if let Some(w) = app.get_webview_window("main") {
                if !hidden {
                    let _ = w.show();
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // chiudere la finestra la nasconde: l'app resta attiva per i promemoria (per uscire: menu dell'icona)
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("errore all'avvio di Calendario");
}
