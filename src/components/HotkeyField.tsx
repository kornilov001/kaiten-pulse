import { useEffect, useState } from "react";
import { setHotkey, type HotkeyError } from "../lib/platform";
import { isMac } from "../lib/settings";

const ERRORS: Record<HotkeyError, string> = {
  invalid: "Эту клавишу нельзя назначить. Попробуйте букву, цифру или F-клавишу.",
  no_modifier: `Добавьте ${isMac ? "⌘, ⌥ или ⌃" : "Ctrl или Alt"}: одиночная клавиша мешала бы печатать.`,
  reserved: "Это сочетание занято системой. Выберите другое.",
  taken: "Это сочетание уже занято другим приложением. Выберите другое.",
};

const MOD_LABEL: Record<string, string> = isMac
  ? { Ctrl: "⌃", Alt: "⌥", Shift: "⇧", Super: "⌘" }
  : { Ctrl: "Ctrl", Alt: "Alt", Shift: "Shift", Super: "Win" };

export function hotkeyLabel(acc: string): string {
  if (!acc) return "Не назначено";
  const parts = acc.split("+").map((p) => MOD_LABEL[p] ?? p.replace(/^Key|^Digit/, "").replace(/^Arrow/, ""));
  return parts.join(isMac ? "" : " + ");
}

const MODIFIER_CODES = /^(Control|Alt|Shift|Meta|OS)(Left|Right)?$/;

/** Click, press a combination; it is checked against the system before being saved. */
export function HotkeyField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!recording) return;
    const onKey = async (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") return setRecording(false);
      if (MODIFIER_CODES.test(e.code)) return; // wait for the main key
      const acc = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Super", e.code]
        .filter(Boolean)
        .join("+");
      setRecording(false);
      try {
        await setHotkey(acc);
        setError(null);
        onChange(acc);
      } catch (err) {
        setError(ERRORS[String(err) as HotkeyError] ?? String(err));
      }
    };
    // capture phase: beat the app-level Escape handler
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, onChange]);

  const clear = async () => {
    await setHotkey("").catch(() => {});
    setError(null);
    onChange("");
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span>Открывать панель клавишами</span>
        <span className="flex items-center gap-1.5">
          <button
            onClick={() => setRecording((r) => !r)}
            className={`h-7 px-2.5 rounded-md border text-[12.5px] tabular ${recording ? "border-accent text-accent" : "border-line bg-paper hover:bg-hover"}`}
          >
            {recording ? "Нажмите сочетание…" : hotkeyLabel(value)}
          </button>
          {value && !recording && (
            <button onClick={clear} className="text-[12px] text-muted hover:text-ink">
              Убрать
            </button>
          )}
        </span>
      </div>
      {error && <p role="alert" className="mt-1 text-[12px] text-overdue">{error}</p>}
    </div>
  );
}
