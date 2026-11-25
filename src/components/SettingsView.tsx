import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { getSpaces, type Role } from "../lib/kaiten";
import type { Settings } from "../lib/settings";
import { autostart, quitApp } from "../lib/platform";
import { IconButton } from "./CardList";
import { HotkeyField } from "./HotkeyField";

const ROLES: { value: Role; label: string }[] = [
  { value: "responsible", label: "Я ответственный" },
  { value: "member", label: "Я участник" },
];

export function SettingsView({
  settings,
  domain,
  userName,
  onChange,
  onBack,
  onDisconnect,
}: {
  settings: Settings;
  domain?: string;
  userName?: string;
  onChange: (patch: Partial<Settings>) => void;
  onBack: () => void;
  onDisconnect: () => void;
}) {
  const spaces = useQuery({ queryKey: ["spaces"], queryFn: getSpaces, staleTime: 10 * 60_000 });
  const [autoOn, setAutoOn] = useState<boolean | null>(null);
  useEffect(() => {
    autostart.isEnabled().then(setAutoOn);
  }, []);

  const toggleSpace = (id: number) => {
    const has = settings.spaceIds.includes(id);
    onChange({ spaceIds: has ? settings.spaceIds.filter((s) => s !== id) : [...settings.spaceIds, id] });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 px-2 pt-2">
        <IconButton label="Назад к списку" onClick={onBack}>
          <ArrowLeft className="size-4" />
        </IconButton>
        <h1 className="text-[14px] font-semibold">Настройки</h1>
      </div>

      <div className="flex-1 overflow-y-auto scroll-quiet px-4 pb-4 text-[13px]">
        <Group title="Какие карточки показывать">
          <div className="grid grid-cols-2 p-0.5 rounded-lg bg-paper border border-line">
            {ROLES.map((r) => (
              <button
                key={r.value}
                onClick={() => onChange({ role: r.value })}
                aria-pressed={settings.role === r.value}
                className={`h-7 rounded-md text-[12.5px] ${settings.role === r.value ? "bg-surface shadow-sm font-medium" : "text-muted"}`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <p className="text-[11.5px] text-faint">«Я участник» включает и карточки, где вы ответственный.</p>
          <Toggle label="Карточки в очереди (ещё не начатые)" checked={settings.includeInQueue} onChange={(v) => onChange({ includeInQueue: v })} />
          <Toggle label="Карточки без срока" checked={settings.showNoDue} onChange={(v) => onChange({ showNoDue: v })} />
        </Group>

        <Group title="Пространства">
          {spaces.isLoading && <p className="text-faint">Загружаю…</p>}
          {spaces.error && <p className="text-overdue">{(spaces.error as Error).message}</p>}
          {spaces.data && (
            <>
              <p className="text-[11.5px] text-faint">
                {settings.spaceIds.length ? "Показываю только отмеченные." : "Ничего не отмечено — показываю все."}
              </p>
              <ul className="max-h-36 overflow-y-auto scroll-quiet -mx-1">
                {spaces.data.map((s) => (
                  <li key={s.id}>
                    <label className="flex items-center gap-2 px-1 py-1 rounded-md hover:bg-hover">
                      <input type="checkbox" checked={settings.spaceIds.includes(s.id)} onChange={() => toggleSpace(s.id)} className="accent-[var(--accent)]" />
                      <span className="truncate">{s.title}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Group>

        <Group title="Напоминания">
          <Toggle label="Уведомлять о сроках" checked={settings.notify} onChange={(v) => onChange({ notify: v })} />
          <Row label="Заранее за">
            <Select
              value={settings.notifyLeadMinutes}
              onChange={(v) => onChange({ notifyLeadMinutes: v })}
              options={[[15, "15 мин"], [30, "30 мин"], [60, "1 час"], [180, "3 часа"], [1440, "1 день"]]}
            />
          </Row>
          <Row label="Обновлять каждые">
            <Select
              value={settings.pollMinutes}
              onChange={(v) => onChange({ pollMinutes: v })}
              options={[[1, "1 мин"], [5, "5 мин"], [15, "15 мин"], [30, "30 мин"]]}
            />
          </Row>
        </Group>

        <Group title="Система">
          <Toggle
            label="Запускать при входе в систему"
            checked={!!autoOn}
            disabled={autoOn === null}
            onChange={async (v) => {
              await autostart.set(v);
              setAutoOn(await autostart.isEnabled());
            }}
          />
          <HotkeyField value={settings.hotkey} onChange={(hotkey) => onChange({ hotkey })} />
          <label className="block">
            <span className="text-[12px] text-muted">Шаблон ссылки на карточку</span>
            <input
              value={settings.cardUrlTemplate}
              onChange={(e) => onChange({ cardUrlTemplate: e.target.value })}
              placeholder="https://{domain}/space/{space}/card/{id}"
              className="mt-1 w-full h-8 px-2.5 rounded-lg bg-paper border border-line outline-none focus:border-accent text-[12px]"
            />
          </label>
        </Group>

        <Group title="Аккаунт">
          <p>
            {userName ?? "—"}
            <span className="block text-[12px] text-muted">{domain}</span>
          </p>
          <div className="flex gap-2">
            <button onClick={onDisconnect} className="h-8 px-3 rounded-lg border border-line hover:bg-hover">
              Отключить Kaiten
            </button>
            <button onClick={quitApp} className="h-8 px-3 rounded-lg border border-line hover:bg-hover">
              Выйти из приложения
            </button>
          </div>
        </Group>
      </div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-4 first:mt-2 space-y-2">
      <h2 className="text-[12px] font-medium text-muted">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span>{label}</span>
      {children}
    </div>
  );
}

function Toggle({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`flex items-center justify-between gap-3 ${disabled ? "opacity-50" : ""}`}>
      <span>{label}</span>
      <button
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative shrink-0 w-8 h-[18px] rounded-full transition-colors ${checked ? "bg-accent" : "bg-line"}`}
      >
        <span className={`absolute top-[2px] size-[14px] rounded-full bg-white shadow transition-[left] ${checked ? "left-[16px]" : "left-[2px]"}`} />
      </button>
    </label>
  );
}

function Select({ value, onChange, options }: { value: number; onChange: (v: number) => void; options: [number, string][] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="h-7 px-2 rounded-md bg-paper border border-line text-[12.5px] outline-none focus:border-accent"
    >
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}
