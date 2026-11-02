use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
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

/// Eventi per il widget di Trofeo LCD, scritti a ogni modifica (anche quelle arrivate dal telefono): Trofeo li legge
/// subito, senza aspettare la sua lettura da internet (che resta come riserva se l'app per PC e' chiusa).
#[tauri::command]
fn write_trofeo_events(json: String) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&json).map_err(|e| format!("dati non validi: {e}"))?;
    let dir = trofeo_dir()?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let p = dir.join("calendario_eventi.json");
    let tmp = dir.join("calendario_eventi.json.tmp");
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &p).map_err(|e| e.to_string())?;
    Ok(())
}

/// L'account del calendario puo' cambiare indirizzo (ora si accede con un nome utente): si aggiorna solo il campo «email»
/// del collegamento di Trofeo (la chiave resta la stessa), cosi' Trofeo continua a leggere subito gli eventi dall'app per PC.
#[tauri::command]
fn set_trofeo_link_email(email: String) -> Result<bool, String> {
    let dir = trofeo_dir()?;
    let p = dir.join("calendario.json");
    if !p.exists() {
        return Ok(false);
    }
    let txt = std::fs::read_to_string(&p).map_err(|e| e.to_string())?;
    let mut v: serde_json::Value = serde_json::from_str(&txt).map_err(|e| format!("collegamento non valido: {e}"))?;
    let obj = v.as_object_mut().ok_or("collegamento non valido")?;
    if obj.get("email").and_then(|x| x.as_str()) == Some(email.as_str()) {
        return Ok(false);
    }
    obj.insert("email".into(), serde_json::Value::String(email));
    let tmp = dir.join("calendario.json.tmp");
    std::fs::write(&tmp, serde_json::to_string(&v).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &p).map_err(|e| e.to_string())?;
    Ok(true)
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

/// Un solo file .exe, come Trofeo LCD: se con l'app aperta si apre un ALTRO Calendario.exe (per esempio la versione nuova
/// appena scaricata), questa si chiude e parte quello nuovo. Se e' lo stesso file, si mostra solo la finestra.
fn other_exe(args: &[String], cwd: &str) -> Option<PathBuf> {
    let first = args.first()?;
    let mut p = PathBuf::from(first);
    if p.is_relative() {
        p = PathBuf::from(cwd).join(p);
    }
    let other = std::fs::canonicalize(&p).ok()?;
    let me = std::fs::canonicalize(std::env::current_exe().ok()?).ok()?;
    if other != me && other.is_file() {
        Some(other)
    } else {
        None
    }
}

/// Percorso nella forma normale (C:\...): quella con \\?\ davanti, data da canonicalize, non piace al comando start di Windows.
fn plain(p: &PathBuf) -> String {
    let s = p.display().to_string();
    if let Some(r) = s.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{r}")
    } else if let Some(r) = s.strip_prefix(r"\\?\") {
        r.to_string()
    } else {
        s
    }
}

#[cfg(windows)]
fn start_later(exe: &PathBuf, hidden: bool) {
    use std::os::windows::process::CommandExt;
    // un paio di secondi di attesa: il tempo che questa copia si chiuda e liberi il posto (una sola istanza alla volta)
    let line = format!(
        "/C ping -n 3 127.0.0.1 >nul & start \"\" \"{}\"{}",
        plain(exe),
        if hidden { " --nascosto" } else { "" }
    );
    let _ = std::process::Command::new("cmd").raw_arg(line).creation_flags(0x0800_0000).spawn();
}
#[cfg(not(windows))]
fn start_later(exe: &PathBuf, hidden: bool) {
    let mut c = std::process::Command::new(plain(exe));
    if hidden {
        c.arg("--nascosto");
    }
    let _ = c.spawn();
}

// ---- aggiornamento automatico (come Trofeo LCD) ----------------------------------------------------------------
// L'app scarica da sola la versione nuova (controllata con l'impronta SHA-256 pubblicata), la mette al posto di questo
// file e si riavvia: subito se la finestra e' chiusa nell'area di notifica, altrimenti quando la si chiude (o con
// «Riavvia»). Il file vecchio resta accanto («.vecchio») finche' la versione nuova non parte bene: se non parte per due
// volte di fila si torna da soli alla precedente.

/// Percorso di questo .exe, preso all'avvio (prima di qualsiasi rinomina).
static EXE: OnceLock<PathBuf> = OnceLock::new();
/// Versione nuova gia' al suo posto: al prossimo riavvio parte quella.
static UPDATE_READY: AtomicBool = AtomicBool::new(false);

fn exe_path() -> Option<PathBuf> {
    EXE.get().cloned()
}
fn beside(ext: &str) -> Option<PathBuf> {
    let mut s = exe_path()?.into_os_string();
    s.push(ext);
    Some(PathBuf::from(s))
}

fn restart(app: &tauri::AppHandle, hidden: bool) {
    if let Some(me) = exe_path() {
        start_later(&me, hidden);
        app.exit(0);
    }
}

fn window_visible(app: &tauri::AppHandle) -> bool {
    app.get_webview_window("main").and_then(|w| w.is_visible().ok()).unwrap_or(false)
}

/// Riceve il file nuovo (gia' controllato dall'app con l'impronta SHA-256) e lo mette al posto di questo.
/// Ritorna true se la finestra e' aperta (l'app chiede «Riavvia»); se e' chiusa si riavvia da sola, in silenzio.
#[tauri::command]
fn install_update(app: tauri::AppHandle, request: tauri::ipc::Request<'_>) -> Result<bool, String> {
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
        return Err("dati mancanti".into());
    };
    if data.len() < 1_000_000 || data.len() > 200_000_000 || &data[..2] != b"MZ" {
        return Err("il file scaricato non e' un programma valido".into());
    }
    let me = exe_path().ok_or("percorso del programma sconosciuto")?;
    let (new, old, bad) = (beside(".nuovo").unwrap(), beside(".vecchio").unwrap(), beside(".guasto").unwrap());
    // la stessa versione che prima non partiva: non la si rimette
    if std::fs::metadata(&bad).map(|m| m.len() == data.len() as u64).unwrap_or(false) {
        return Err("questa versione non era partita: si aspetta la prossima".into());
    }
    std::fs::write(&new, data).map_err(|e| format!("scrittura non riuscita ({e}): cartella protetta?"))?;
    let _ = std::fs::remove_file(&old);
    // un programma in esecuzione su Windows non si puo' sovrascrivere, ma si puo' rinominare
    if let Err(e) = std::fs::rename(&me, &old) {
        let _ = std::fs::remove_file(&new);
        return Err(format!("sostituzione non riuscita: {e}"));
    }
    if let Err(e) = std::fs::rename(&new, &me) {
        let _ = std::fs::rename(&old, &me);
        let _ = std::fs::remove_file(&new);
        return Err(format!("sostituzione non riuscita: {e}"));
    }
    let _ = std::fs::remove_file(beside(".prova").unwrap());
    UPDATE_READY.store(true, Ordering::SeqCst);
    if window_visible(&app) {
        return Ok(true);
    }
    let h = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(400));
        restart(&h, true);
    });
    Ok(false)
}

/// «Riavvia» dall'app: parte la versione nuova (con la finestra aperta se lo era).
#[tauri::command]
fn restart_app(app: tauri::AppHandle) {
    let hidden = !window_visible(&app);
    restart(&app, hidden);
}

/// La versione nuova e' partita bene: il file vecchio non serve piu'.
#[tauri::command]
fn confirm_update() {
    if let Some(p) = beside(".prova") {
        let _ = std::fs::remove_file(p);
    }
    if let Some(p) = beside(".vecchio") {
        let _ = std::fs::remove_file(p);
    }
}

/// All'avvio: pulizia e, se la versione appena installata non ha mai confermato di funzionare per due volte di fila,
/// ritorno alla precedente. Ritorna true se e' stata rimessa la versione vecchia (e va avviata quella).
fn check_probation(hidden: bool) -> bool {
    let (Some(me), Some(new), Some(old), Some(prova), Some(bad)) =
        (exe_path(), beside(".nuovo"), beside(".vecchio"), beside(".prova"), beside(".guasto"))
    else {
        return false;
    };
    let _ = std::fs::remove_file(&new);
    if !old.exists() {
        let _ = std::fs::remove_file(&prova);
        return false;
    }
    let n = std::fs::read_to_string(&prova).ok().and_then(|s| s.trim().parse::<u32>().ok()).unwrap_or(0) + 1;
    if n >= 3 {
        let _ = std::fs::remove_file(&bad);
        if std::fs::rename(&me, &bad).is_ok() {
            if std::fs::rename(&old, &me).is_ok() {
                let _ = std::fs::remove_file(&prova);
                start_later(&me, hidden);
                return true;
            }
            let _ = std::fs::rename(&bad, &me);
        }
    }
    let _ = std::fs::write(&prova, n.to_string());
    false
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
    if let Ok(p) = std::env::current_exe() {
        let _ = EXE.set(p);
    }
    if check_probation(std::env::args().any(|a| a == "--nascosto")) {
        return;                                                  // riparte la versione precedente
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            if let Some(exe) = other_exe(&args, &cwd) {
                start_later(&exe, false);
                app.exit(0);
            } else {
                show_main(app);
            }
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--nascosto"]),
        ))
        .invoke_handler(tauri::generate_handler![
            write_trofeo_link,
            read_trofeo_link,
            set_trofeo_link_email,
            write_trofeo_events,
            install_update,
            restart_app,
            confirm_update
        ])
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
            // avvio con Windows gia' attivo: lo si riscrive col percorso di QUESTO file (se il file e' stato spostato o aggiornato)
            {
                use tauri_plugin_autostart::ManagerExt;
                if let Ok(true) = app.autolaunch().is_enabled() {
                    let _ = app.autolaunch().enable();
                }
            }
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
                // versione nuova gia' installata: si riavvia adesso, in silenzio (resta nell'area di notifica)
                if UPDATE_READY.load(Ordering::SeqCst) {
                    restart(window.app_handle(), true);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("errore all'avvio di Calendario");
}
