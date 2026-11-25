import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Settings as Gear } from "lucide-react";
import { cardUrl, connectionInfo, disconnect, inTauri, type KaitenCard } from "./lib/kaiten";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from "./lib/settings";
import { autostart, copyText, hidePopover, onAppEvent, openUrl, setHotkey } from "./lib/platform";
import { useCards } from "./lib/useCards";
import { agoRu } from "./lib/time";
import { Horizon } from "./components/Horizon";
import { CardList, IconButton } from "./components/CardList";
import { CardDetail } from "./components/CardDetail";
import { Onboarding } from "./components/Onboarding";
import { SettingsView } from "./components/SettingsView";

type View = { name: "list" } | { name: "detail"; card: KaitenCard } | { name: "settings" };

export default function App() {
  const qc = useQueryClient();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [domain, setDomain] = useState<string | null | undefined>(undefined);
  const [view, setView] = useState<View>({ name: "list" });
  const [selectedId, setSelectedId] = useState<number>();
  const [toast, setToast] = useState<string | null>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    loadSettings().then(async (s) => {
      // Turn on launch-at-login once, on first run; afterwards the user's choice wins.
      if (!s.autostartInitialized) {
        await autostart.set(true).catch(() => {});
        s = { ...s, autostartInitialized: true };
        await saveSettings(s);
      }
      setSettings(s);
      // If the combination is not free (system or another app), start without it:
      // Settings then shows «Не назначено» and explains why on the next attempt.
      setHotkey(s.hotkey).catch(() => updateSettings({ hotkey: "" }));
    });
    connectionInfo().then((c) => setDomain(c?.domain ?? null));
  }, []);

  const connected = !!domain;
  const { user, cards, groups } = useCards(settings ?? DEFAULT_SETTINGS, connected && !!settings);

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["cards"] });
  }, [qc]);

  useEffect(() => {
    const offs = [
      onAppEvent("refresh-requested", refresh),
      onAppEvent("open-settings", () => setView({ name: "settings" })),
      // relative labels ("через 2 ч") go stale while hidden
      onAppEvent("popover-shown", () => tick((n) => n + 1)),
    ];
    const t = setInterval(() => tick((n) => n + 1), 60_000);
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setView((v) => {
        if (v.name !== "list") return { name: "list" };
        hidePopover();
        return v;
      });
    };
    window.addEventListener("keydown", esc);
    return () => {
      offs.forEach((off) => off());
      clearInterval(t);
      window.removeEventListener("keydown", esc);
    };
  }, [refresh]);

  const updateSettings = (patch: Partial<Settings>) => {
    setSettings((s) => {
      const next = { ...(s ?? DEFAULT_SETTINGS), ...patch };
      saveSettings(next);
      return next;
    });
  };

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1600);
  };

  const linkOf = (c: KaitenCard) => cardUrl(c, domain ?? "", settings?.cardUrlTemplate);
  const openInKaiten = (c: KaitenCard) => {
    openUrl(linkOf(c));
    hidePopover();
  };
  const copyLink = async (c: KaitenCard) => {
    await copyText(linkOf(c));
    flash("Ссылка скопирована");
  };

  const allCards = groups.flatMap((g) => g.cards);

  let body: React.ReactNode;
  if (domain === undefined || !settings) {
    body = null;
  } else if (!connected) {
    body = (
      <Onboarding
        onConnected={async () => {
          qc.clear();
          const c = await connectionInfo();
          setDomain(c?.domain ?? null);
        }}
      />
    );
  } else if (view.name === "settings") {
    body = (
      <SettingsView
        settings={settings}
        domain={domain}
        userName={user.data?.full_name}
        onChange={updateSettings}
        onBack={() => setView({ name: "list" })}
        onDisconnect={async () => {
          await disconnect();
          qc.clear();
          setView({ name: "list" });
          setDomain(null);
        }}
      />
    );
  } else if (view.name === "detail") {
    body = (
      <CardDetail
        card={view.card}
        onBack={() => setView({ name: "list" })}
        onOpenInKaiten={openInKaiten}
        onCopyLink={copyLink}
        onChanged={refresh}
        flash={flash}
      />
    );
  } else {
    const err = (user.error ?? cards.error) as Error | null;
    body = (
      <>
        <header className="flex items-center gap-1 pl-4 pr-2 pt-2.5">
          <span className="text-[13px] font-semibold">Мои сроки</span>
          <span className="ml-auto text-[11.5px] text-faint tabular" aria-live="polite">
            {cards.isFetching ? "обновляю…" : cards.dataUpdatedAt ? `обновлено ${agoRu(cards.dataUpdatedAt)}` : ""}
          </span>
          <IconButton label="Обновить" onClick={refresh}>
            <RefreshCw className={`size-3.5 ${cards.isFetching ? "animate-spin" : ""}`} />
          </IconButton>
          <IconButton label="Настройки" onClick={() => setView({ name: "settings" })}>
            <Gear className="size-3.5" />
          </IconButton>
        </header>

        {err ? (
          <div className="m-4 p-3 rounded-lg bg-paper text-[12.5px]">
            <p className="text-overdue">{err.message}</p>
            <button onClick={refresh} className="mt-2 text-accent hover:underline">Повторить</button>
          </div>
        ) : cards.isLoading || user.isLoading ? (
          <p className="px-4 py-6 text-faint">Загружаю карточки…</p>
        ) : (
          <>
            <Horizon cards={allCards} selectedId={selectedId} onSelect={(c) => setSelectedId(c.id)} />
            <div className="h-px bg-line mx-4" />
            {groups.length ? (
              <CardList
                groups={groups}
                selectedId={selectedId}
                onOpenDetail={(c) => setView({ name: "detail", card: c })}
                onOpenInKaiten={openInKaiten}
                onCopyLink={copyLink}
              />
            ) : (
              <div className="px-4 py-8 text-[13px] text-muted">
                <p>Карточек со сроком нет.</p>
                <button onClick={() => setView({ name: "settings" })} className="mt-1 text-accent hover:underline">
                  Изменить, какие карточки показывать
                </button>
              </div>
            )}
          </>
        )}
      </>
    );
  }

  return (
    <main
      className={`relative flex flex-col bg-surface text-ink overflow-hidden ${
        inTauri ? "h-full rounded-xl border border-line" : "w-[384px] h-[600px] rounded-xl shadow-2xl"
      }`}
    >
      {body}
      {toast && (
        <div role="status" className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-lg bg-ink text-surface text-[12px]">
          {toast}
        </div>
      )}
    </main>
  );
}
