//! Global hotkey that toggles the popover.
//!
//! Conflict handling, so one combination never does two things:
//! 1. combinations the OS itself uses are refused (built-in list; on macOS also
//!    whatever is enabled in System Settings → Keyboard → Keyboard Shortcuts);
//! 2. if another application already holds the combination, registration with
//!    the OS fails and we report "taken" (reliable on Windows; macOS lets several
//!    apps register the same combination, so only step 1 applies there).

use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

#[derive(Default)]
pub struct HotkeyState(Mutex<Option<String>>);

#[cfg(target_os = "macos")]
const RESERVED: &[&str] = &[
    "Cmd+Space", "Cmd+Alt+Space", "Ctrl+Space", "Ctrl+Cmd+Space", "Cmd+Tab", "Cmd+Shift+Tab",
    "Cmd+Backquote", "Cmd+Q", "Cmd+W", "Cmd+H", "Cmd+Alt+H", "Cmd+M", "Cmd+Alt+Escape",
    "Cmd+Shift+Digit3", "Cmd+Shift+Digit4", "Cmd+Shift+Digit5", "Cmd+Alt+KeyD", "Ctrl+Cmd+Q",
    "Ctrl+Cmd+F", "Ctrl+ArrowUp", "Ctrl+ArrowDown", "Ctrl+ArrowLeft", "Ctrl+ArrowRight",
    "Cmd+C", "Cmd+V", "Cmd+X", "Cmd+Z", "Cmd+Shift+Z", "Cmd+A", "Cmd+S", "Cmd+N", "Cmd+T",
    "Cmd+F", "Cmd+P", "Cmd+O", "Cmd+Comma",
];

#[cfg(not(target_os = "macos"))]
const RESERVED: &[&str] = &[
    "Alt+Tab", "Alt+Shift+Tab", "Alt+F4", "Alt+Space", "Alt+Escape", "Ctrl+Escape",
    "Ctrl+Alt+Delete", "Ctrl+Shift+Escape", "Ctrl+C", "Ctrl+V", "Ctrl+X", "Ctrl+Z", "Ctrl+Y",
    "Ctrl+A", "Ctrl+S", "Ctrl+N", "Ctrl+T", "Ctrl+F", "Ctrl+P", "Ctrl+O", "Ctrl+W",
];

fn reserved_by_system(sc: &Shortcut) -> bool {
    // Win+… belongs to Windows itself.
    if cfg!(target_os = "windows") && sc.mods.contains(Modifiers::SUPER) {
        return true;
    }
    if RESERVED.iter().filter_map(|s| s.parse::<Shortcut>().ok()).any(|r| r.id() == sc.id()) {
        return true;
    }
    #[cfg(target_os = "macos")]
    if macos::user_system_shortcuts().iter().any(|r| r.id() == sc.id()) {
        return true;
    }
    false
}

fn register(app: &AppHandle, sc: Shortcut) -> Result<(), String> {
    app.global_shortcut()
        .on_shortcut(sc, |app, _sc, event| {
            if event.state == ShortcutState::Pressed {
                crate::toggle_popover(app);
            }
        })
        .map_err(|_| "taken".to_string())
}

/// Errors: "invalid", "no_modifier", "reserved", "taken".
#[tauri::command]
pub fn set_hotkey(app: AppHandle, accelerator: Option<String>) -> Result<(), String> {
    let state = app.state::<HotkeyState>();
    let mut current = state.0.lock().unwrap();

    let Some(acc) = accelerator.filter(|a| !a.trim().is_empty()) else {
        let _ = app.global_shortcut().unregister_all();
        *current = None;
        return Ok(());
    };
    if current.as_deref() == Some(acc.as_str()) {
        return Ok(());
    }

    let sc: Shortcut = acc.parse().map_err(|_| "invalid".to_string())?;
    let is_fkey = matches!(
        sc.key,
        Code::F1 | Code::F2 | Code::F3 | Code::F4 | Code::F5 | Code::F6 | Code::F7 | Code::F8
            | Code::F9 | Code::F10 | Code::F11 | Code::F12
    );
    let strong = Modifiers::CONTROL | Modifiers::ALT | Modifiers::SUPER;
    if !sc.mods.intersects(strong) && !is_fkey {
        return Err("no_modifier".into());
    }
    if reserved_by_system(&sc) {
        return Err("reserved".into());
    }

    let _ = app.global_shortcut().unregister_all();
    match register(&app, sc) {
        Ok(()) => {
            *current = Some(acc);
            Ok(())
        }
        Err(e) => {
            // keep the previous hotkey working
            if let Some(prev) = current.as_deref().and_then(|p| p.parse::<Shortcut>().ok()) {
                let _ = register(&app, prev);
            }
            Err(e)
        }
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use super::{Code, Modifiers, Shortcut};

    /// Shortcuts enabled in System Settings (Spotlight, Mission Control, input
    /// sources, screenshots…), read from the user's symbolic hotkeys preferences.
    pub fn user_system_shortcuts() -> Vec<Shortcut> {
        let Some(home) = std::env::var_os("HOME") else { return vec![] };
        let path = std::path::Path::new(&home)
            .join("Library/Preferences/com.apple.symbolichotkeys.plist");
        let Ok(root) = plist::Value::from_file(path) else { return vec![] };
        let Some(keys) = root
            .as_dictionary()
            .and_then(|d| d.get("AppleSymbolicHotKeys"))
            .and_then(|v| v.as_dictionary())
        else {
            return vec![];
        };

        let mut out = vec![];
        for entry in keys.values() {
            let Some(e) = entry.as_dictionary() else { continue };
            let enabled = e.get("enabled").is_some_and(|v| {
                v.as_boolean().unwrap_or_else(|| v.as_signed_integer().unwrap_or(0) != 0)
            });
            if !enabled {
                continue;
            }
            // parameters = [ascii, virtual keycode, modifier mask]
            let Some(p) = e
                .get("value")
                .and_then(|v| v.as_dictionary())
                .and_then(|v| v.get("parameters"))
                .and_then(|v| v.as_array())
            else {
                continue;
            };
            let (Some(keycode), Some(mask)) = (
                p.get(1).and_then(|v| v.as_signed_integer()),
                p.get(2).and_then(|v| v.as_signed_integer()),
            ) else {
                continue;
            };
            let Some(code) = keycode_to_code(keycode) else { continue };
            let mut mods = Modifiers::empty();
            if mask & 0x0002_0000 != 0 { mods |= Modifiers::SHIFT; }
            if mask & 0x0004_0000 != 0 { mods |= Modifiers::CONTROL; }
            if mask & 0x0008_0000 != 0 { mods |= Modifiers::ALT; }
            if mask & 0x0010_0000 != 0 { mods |= Modifiers::SUPER; }
            out.push(Shortcut::new(Some(mods), code));
        }
        out
    }

    /// macOS virtual keycodes (ANSI layout) → key codes.
    fn keycode_to_code(k: i64) -> Option<Code> {
        Some(match k {
            0 => Code::KeyA, 1 => Code::KeyS, 2 => Code::KeyD, 3 => Code::KeyF, 4 => Code::KeyH,
            5 => Code::KeyG, 6 => Code::KeyZ, 7 => Code::KeyX, 8 => Code::KeyC, 9 => Code::KeyV,
            11 => Code::KeyB, 12 => Code::KeyQ, 13 => Code::KeyW, 14 => Code::KeyE, 15 => Code::KeyR,
            16 => Code::KeyY, 17 => Code::KeyT, 18 => Code::Digit1, 19 => Code::Digit2,
            20 => Code::Digit3, 21 => Code::Digit4, 22 => Code::Digit6, 23 => Code::Digit5,
            24 => Code::Equal, 25 => Code::Digit9, 26 => Code::Digit7, 27 => Code::Minus,
            28 => Code::Digit8, 29 => Code::Digit0, 30 => Code::BracketRight, 31 => Code::KeyO,
            32 => Code::KeyU, 33 => Code::BracketLeft, 34 => Code::KeyI, 35 => Code::KeyP,
            36 => Code::Enter, 37 => Code::KeyL, 38 => Code::KeyJ, 39 => Code::Quote,
            40 => Code::KeyK, 41 => Code::Semicolon, 42 => Code::Backslash, 43 => Code::Comma,
            44 => Code::Slash, 45 => Code::KeyN, 46 => Code::KeyM, 47 => Code::Period,
            48 => Code::Tab, 49 => Code::Space, 50 => Code::Backquote, 51 => Code::Backspace,
            53 => Code::Escape,
            122 => Code::F1, 120 => Code::F2, 99 => Code::F3, 118 => Code::F4, 96 => Code::F5,
            97 => Code::F6, 98 => Code::F7, 100 => Code::F8, 101 => Code::F9, 109 => Code::F10,
            103 => Code::F11, 111 => Code::F12,
            123 => Code::ArrowLeft, 124 => Code::ArrowRight, 125 => Code::ArrowDown,
            126 => Code::ArrowUp,
            _ => return None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reserved_list_parses() {
        for s in RESERVED {
            assert!(s.parse::<Shortcut>().is_ok(), "bad reserved shortcut: {s}");
        }
    }

    #[test]
    fn detects_reserved() {
        let copy: Shortcut = if cfg!(target_os = "macos") { "Cmd+KeyC" } else { "Ctrl+KeyC" }.parse().unwrap();
        assert!(reserved_by_system(&copy));
        let free: Shortcut = "Ctrl+Alt+KeyK".parse().unwrap();
        assert!(!reserved_by_system(&free));
    }
}
