import { LazyStore } from "@tauri-apps/plugin-store";
import { inTauri, type Role } from "./kaiten";

export const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

export interface Settings {
  role: Role;
  spaceIds: number[];
  includeInQueue: boolean;
  showNoDue: boolean;
  pollMinutes: number;
  notify: boolean;
  notifyLeadMinutes: number;
  autostartInitialized: boolean;
  cardUrlTemplate: string;
  /** Global hotkey, e.g. "Ctrl+Alt+KeyK"; empty = none. */
  hotkey: string;
}

export const DEFAULT_SETTINGS: Settings = {
  role: "responsible",
  spaceIds: [],
  includeInQueue: true,
  showNoDue: false,
  pollMinutes: 5,
  notify: true,
  notifyLeadMinutes: 60,
  autostartInitialized: false,
  cardUrlTemplate: "",
  hotkey: isMac ? "Alt+Super+KeyK" : "Ctrl+Alt+KeyK",
};

const store = inTauri ? new LazyStore("settings.json") : null;
const KEY = "settings";

export async function loadSettings(): Promise<Settings> {
  try {
    const raw = store ? await store.get<Partial<Settings>>(KEY) : JSON.parse(localStorage.getItem(KEY) ?? "null");
    return { ...DEFAULT_SETTINGS, ...(raw ?? {}) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(s: Settings): Promise<void> {
  if (store) {
    await store.set(KEY, s);
    await store.save();
  } else {
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      /* preview only */
    }
  }
}

/** Ids of cards already announced, so each deadline notifies once. */
export async function loadNotified(): Promise<Record<string, number>> {
  if (!store) return {};
  return (await store.get<Record<string, number>>("notified")) ?? {};
}

export async function saveNotified(map: Record<string, number>): Promise<void> {
  if (!store) return;
  await store.set("notified", map);
  await store.save();
}
