//! Ventana flotante de JARVIS: un input que aparece con un atajo global y muestra debajo lo que va haciendo.
//!
//! La UI y la API las sirve el server Node de JARVIS en loopback (`/launcher.html`). Si el server no está corriendo,
//! esta app lo arranca (y lo cierra al salir); si ya hay uno, lo reutiliza.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::File;
use std::net::{SocketAddr, TcpStream};
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{
    AppHandle, Manager, PhysicalPosition, RunEvent, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutEvent, ShortcutState};

const PORT: u16 = 3000;
const WIDTH: f64 = 640.0;
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const SERVER_BOOT_TIMEOUT: Duration = Duration::from_secs(90);

/// El server que arrancó esta app (si ya había uno corriendo, no es nuestro y no se toca).
struct OwnedServer(Mutex<Option<Child>>);

fn project_root() -> PathBuf {
    if let Ok(path) = std::env::var("JARVIS_ROOT") {
        return PathBuf::from(path);
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().expect("src-tauri tiene carpeta padre").to_path_buf()
}

fn port_open() -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], PORT));
    TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok()
}

fn start_server() -> Option<Child> {
    if port_open() {
        return None;
    }
    let log = File::create(std::env::temp_dir().join("jarvis-server.log")).ok();
    let (out, err) = match log.and_then(|f| f.try_clone().ok().map(|c| (f, c))) {
        Some((a, b)) => (Stdio::from(a), Stdio::from(b)),
        None => (Stdio::null(), Stdio::null()),
    };
    Command::new("node")
        .args(["node_modules/tsx/dist/cli.mjs", "server.tsx"])
        .current_dir(project_root())
        .env("NODE_ENV", "production")
        .stdin(Stdio::null())
        .stdout(out)
        .stderr(err)
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .ok()
}

/// Mata el server y sus procesos hijos (los servidores MCP).
fn stop_server(app: &AppHandle) {
    if let Some(mut child) = app.state::<OwnedServer>().0.lock().ok().and_then(|mut g| g.take()) {
        let _ = Command::new("taskkill")
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        let _ = child.wait();
    }
}

/// Centrada arriba, como un lanzador.
fn place(win: &WebviewWindow) {
    let (Ok(Some(monitor)), Ok(size)) = (win.primary_monitor(), win.outer_size()) else { return };
    let area = monitor.size();
    let origin = monitor.position();
    let x = origin.x + (area.width as i32 - size.width as i32) / 2;
    let y = origin.y + (area.height as f64 * 0.18) as i32;
    let _ = win.set_position(PhysicalPosition::new(x, y));
}

fn show_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        place(&win);
        let _ = win.show();
        let _ = win.set_focus();
    }
}

fn toggle_window(app: &AppHandle) {
    let Some(win) = app.get_webview_window("main") else { return };
    if win.is_visible().unwrap_or(false) && win.is_focused().unwrap_or(false) {
        let _ = win.hide();
    } else {
        show_window(app);
    }
}

fn build_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let url = format!("http://127.0.0.1:{PORT}/launcher.html");
    WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url.parse().expect("URL válida")))
        .title("Jarvis")
        .inner_size(WIDTH, 96.0)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .build()
}

fn on_shortcut(app: &AppHandle, _shortcut: &Shortcut, event: ShortcutEvent) {
    if event.state() == ShortcutState::Pressed {
        toggle_window(app);
    }
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_window(app)))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(OwnedServer(Mutex::new(None)))
        .setup(|app| {
            // Alt+Space; si otro programa ya lo usa, Ctrl+Alt+Space.
            let shortcuts = app.global_shortcut();
            let primary = Shortcut::new(Some(Modifiers::ALT), Code::Space);
            if shortcuts.on_shortcut(primary, on_shortcut).is_err() {
                let fallback = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::Space);
                let _ = shortcuts.on_shortcut(fallback, on_shortcut);
            }

            let show = MenuItem::with_id(app, "show", "Mostrar", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Salir", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let mut tray = TrayIconBuilder::new()
                .tooltip("Jarvis")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        toggle_window(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            // El server tarda unos segundos en abrir el puerto: se espera fuera del hilo principal.
            let handle = app.handle().clone();
            thread::spawn(move || {
                let child = start_server();
                if let Ok(mut owned) = handle.state::<OwnedServer>().0.lock() {
                    *owned = child;
                }
                let deadline = Instant::now() + SERVER_BOOT_TIMEOUT;
                while !port_open() && Instant::now() < deadline {
                    thread::sleep(Duration::from_millis(250));
                }
                if build_window(&handle).is_ok() {
                    show_window(&handle);
                }
            });
            Ok(())
        })
        // Como un lanzador: al perder el foco se oculta (la tarea sigue corriendo; el atajo la vuelve a mostrar).
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, WindowEvent::Focused(false)) {
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("no se pudo iniciar Jarvis");

    app.run(|app, event| match event {
        // Sin ventanas visibles la app sigue viva en la bandeja; solo "Salir" la cierra.
        RunEvent::ExitRequested { api, code, .. } if code.is_none() => api.prevent_exit(),
        RunEvent::Exit => stop_server(app),
        _ => {}
    });
}
