mod hotkey;
mod kaiten;

use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WindowEvent,
};
use tauri_plugin_autostart::MacosLauncher;

const MAIN: &str = "main";
const TRAY_ID: &str = "kaiten-tray";

/// When the popover loses focus because the user clicked the tray icon,
/// the blur (hide) arrives just before the click (show). Remember the hide
/// moment so that click doesn't immediately reopen it.
struct LastHidden(Mutex<Option<Instant>>);

/// Place the popover under the menu-bar icon (macOS) or above the tray icon
/// (Windows), kept inside the screen. Falls back to the top-right corner.
fn position_popover(app: &AppHandle, w: &tauri::WebviewWindow) {
    let Ok(size) = w.outer_size() else { return };
    let (ww, wh) = (size.width as f64, size.height as f64);
    let gap = 8.0;

    let tray_rect = app.tray_by_id(TRAY_ID).and_then(|t| t.rect().ok().flatten());
    let anchor = tray_rect.map(|r| {
        let scale = w.scale_factor().unwrap_or(1.0);
        let p = r.position.to_physical::<f64>(scale);
        let s = r.size.to_physical::<f64>(scale);
        (p.x, p.y, s.width, s.height)
    });

    let monitor = anchor
        .and_then(|(x, y, ..)| app.monitor_from_point(x, y).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());
    let Some(m) = monitor else { return };
    let (mx, my) = (m.position().x as f64, m.position().y as f64);
    let (mw, mh) = (m.size().width as f64, m.size().height as f64);

    let (mut x, mut y) = match anchor {
        Some((tx, ty, tw, th)) => {
            let x = tx + tw / 2.0 - ww / 2.0;
            // tray in the top half of the screen -> open below it, otherwise above
            let y = if ty - my < mh / 2.0 { ty + th + gap } else { ty - wh - gap };
            (x, y)
        }
        None => (mx + mw - ww - gap, my + 32.0),
    };
    x = x.clamp(mx + gap, (mx + mw - ww - gap).max(mx + gap));
    y = y.clamp(my + gap, (my + mh - wh - gap).max(my + gap));
    let _ = w.set_position(tauri::PhysicalPosition::new(x, y));
}

fn show_popover(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(MAIN) {
        position_popover(app, &w);
        let _ = w.show();
        let _ = w.set_focus();
        let _ = app.emit("popover-shown", ());
    }
}

pub(crate) fn toggle_popover(app: &AppHandle) {
    let Some(w) = app.get_webview_window(MAIN) else { return };
    if w.is_visible().unwrap_or(false) {
        let _ = w.hide();
        return;
    }
    let recently_hidden = app
        .state::<LastHidden>()
        .0
        .lock()
        .unwrap()
        .is_some_and(|t| t.elapsed() < Duration::from_millis(250));
    if !recently_hidden {
        show_popover(app);
    }
}

/// Count shown next to the tray icon (macOS menu bar title) and in the tooltip.
#[tauri::command]
fn set_tray_status(app: AppHandle, title: Option<String>, tooltip: String) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        #[cfg(target_os = "macos")]
        let _ = tray.set_title(title.as_deref());
        #[cfg(not(target_os = "macos"))]
        let _ = &title;
        let _ = tray.set_tooltip(Some(tooltip));
    }
}

#[tauri::command]
fn hide_popover(app: AppHandle) {
    if let Some(w) = app.get_webview_window(MAIN) {
        let _ = w.hide();
    }
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let refresh = MenuItem::with_id(app, "refresh", "Обновить", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Настройки…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Выйти из Kaiten Pulse", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&refresh, &settings, &sep, &quit])?;

    // macOS: monochrome template glyph that adapts to light/dark menu bar.
    // Windows/Linux: the colored app icon (a black glyph vanishes on a dark taskbar).
    let icon = if cfg!(target_os = "macos") {
        tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?
    } else {
        app.default_window_icon().cloned().expect("bundle icon")
    };

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .icon_as_template(cfg!(target_os = "macos"))
        .tooltip("Kaiten Pulse")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "refresh" => {
                let _ = app.emit("refresh-requested", ());
            }
            "settings" => {
                show_popover(app);
                let _ = app.emit("open-settings", ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_popover(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_popover(app)))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .manage(kaiten::KaitenState::default())
        .manage(LastHidden(Mutex::new(None)))
        .manage(hotkey::HotkeyState::default())
        .setup(|app| {
            // Menu-bar-only app on macOS: no Dock icon, no app switcher entry.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            build_tray(app.handle())?;

            // First manual launch: show the popover so the user sees where the app lives.
            let autostarted = std::env::args().any(|a| a == "--autostart");
            if !autostarted {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(400));
                    show_popover(&handle);
                });
            }
            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::Focused(false) if window.label() == MAIN => {
                *window.app_handle().state::<LastHidden>().0.lock().unwrap() = Some(Instant::now());
                let _ = window.hide();
            }
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window.hide();
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            set_tray_status,
            hide_popover,
            quit_app,
            hotkey::set_hotkey,
            kaiten::connection_info,
            kaiten::connect,
            kaiten::disconnect,
            kaiten::kaiten_request,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Kaiten Pulse");
}
