import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl as tauriOpenUrl } from "@tauri-apps/plugin-opener";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { inTauri } from "./kaiten";

export async function openUrl(url: string) {
  if (inTauri) await tauriOpenUrl(url);
  else window.open(url, "_blank", "noopener");
}

export async function copyText(text: string) {
  await navigator.clipboard.writeText(text);
}

export async function setTrayStatus(title: string | null, tooltip: string) {
  if (inTauri) await invoke("set_tray_status", { title, tooltip });
}

export async function hidePopover() {
  if (inTauri) await invoke("hide_popover");
}

export async function quitApp() {
  if (inTauri) await invoke("quit_app");
}

export const autostart = {
  isEnabled: async () => (inTauri ? isEnabled() : false),
  set: async (on: boolean) => {
    if (!inTauri) return;
    if (on) await enable();
    else await disable();
  },
};

export async function notify(title: string, body: string) {
  if (!inTauri) return;
  let granted = await isPermissionGranted();
  if (!granted) granted = (await requestPermission()) === "granted";
  if (granted) sendNotification({ title, body });
}

export function onAppEvent(name: "refresh-requested" | "open-settings" | "popover-shown", cb: () => void) {
  if (!inTauri) return () => {};
  const p = listen(name, cb);
  return () => {
    p.then((un) => un());
  };
}

export type HotkeyError = "invalid" | "no_modifier" | "reserved" | "taken";

/** Registers the global hotkey with the OS. Rejects with a HotkeyError string. */
export async function setHotkey(accelerator: string) {
  if (inTauri) await invoke("set_hotkey", { accelerator: accelerator || null });
}
