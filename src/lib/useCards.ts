import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { getCurrentUser, getMyCards, type KaitenCard } from "./kaiten";
import { bucketOf, dueAt, durationRu, sortByDue, type Bucket, BUCKET_ORDER } from "./time";
import { loadNotified, saveNotified, type Settings } from "./settings";
import { notify, setTrayStatus } from "./platform";

export interface Grouped {
  bucket: Bucket;
  cards: KaitenCard[];
}

export function useCards(settings: Settings, connected: boolean) {
  const user = useQuery({
    queryKey: ["user"],
    queryFn: getCurrentUser,
    enabled: connected,
    staleTime: Infinity,
  });

  const cards = useQuery({
    queryKey: ["cards", user.data?.id, settings.role, settings.spaceIds, settings.includeInQueue],
    queryFn: () =>
      getMyCards({
        userId: user.data!.id,
        role: settings.role,
        spaceIds: settings.spaceIds,
        includeInQueue: settings.includeInQueue,
      }),
    enabled: connected && !!user.data,
    refetchInterval: settings.pollMinutes * 60_000,
    refetchIntervalInBackground: true,
  });

  const groups = useMemo<Grouped[]>(() => {
    const now = new Date();
    const by = new Map<Bucket, KaitenCard[]>();
    for (const c of [...(cards.data ?? [])].sort(sortByDue)) {
      const b = bucketOf(c, now);
      if (b === "none" && !settings.showNoDue) continue;
      by.set(b, [...(by.get(b) ?? []), c]);
    }
    return BUCKET_ORDER.filter((b) => by.has(b)).map((b) => ({ bucket: b, cards: by.get(b)! }));
    // cards.dataUpdatedAt re-buckets on each refresh even if data is equal
  }, [cards.data, cards.dataUpdatedAt, settings.showNoDue]);

  useTrayStatus(groups, connected);
  useDeadlineNotifications(cards.data, settings);

  return { user, cards, groups };
}

function useTrayStatus(groups: Grouped[], connected: boolean) {
  useEffect(() => {
    const count = (b: Bucket) => groups.find((g) => g.bucket === b)?.cards.length ?? 0;
    const overdue = count("overdue");
    const today = count("today");
    if (!connected) {
      setTrayStatus(null, "Kaiten Pulse — не подключено");
      return;
    }
    const parts = [overdue && `просрочено: ${overdue}`, today && `сегодня: ${today}`].filter(Boolean);
    setTrayStatus(
      overdue + today > 0 ? String(overdue + today) : null,
      parts.length ? `Kaiten Pulse — ${parts.join(", ")}` : "Kaiten Pulse — срочного нет",
    );
  }, [groups, connected]);
}

/** One notification per card per deadline: when it enters the lead window, and when it becomes overdue. */
function useDeadlineNotifications(cards: KaitenCard[] | undefined, settings: Settings) {
  const busy = useRef(false);
  useEffect(() => {
    if (!cards || !settings.notify || busy.current) return;
    busy.current = true;
    (async () => {
      const seen = await loadNotified();
      const firstRun = Object.keys(seen).length === 0;
      const now = Date.now();
      const fresh: { key: string; title: string; body: string }[] = [];

      for (const c of cards) {
        const due = dueAt(c)?.getTime();
        if (!due) continue;
        const left = due - now;
        if (left < 0) {
          const key = `over:${c.id}:${c.due_date}`;
          if (!seen[key]) fresh.push({ key, title: "Срок прошёл", body: c.title });
        } else if (left <= settings.notifyLeadMinutes * 60_000) {
          const key = `soon:${c.id}:${c.due_date}`;
          if (!seen[key]) fresh.push({ key, title: `Через ${durationRu(left)}`, body: c.title });
        }
      }

      // Don't flood on the very first launch with old overdue cards.
      const toShow = firstRun ? fresh.filter((f) => f.key.startsWith("soon:")) : fresh;
      toShow.slice(0, 3).forEach((f) => notify(f.title, f.body));
      if (toShow.length > 3) notify("Kaiten Pulse", `И ещё ${toShow.length - 3} карточки со сроком`);

      // Keep the map small: forget entries older than 30 days.
      const next: Record<string, number> = {};
      for (const [k, t] of Object.entries(seen)) if (now - t < 30 * 86_400_000) next[k] = t;
      for (const f of fresh) next[f.key] = now;
      await saveNotified(next);
    })().finally(() => {
      busy.current = false;
    });
  }, [cards, settings.notify, settings.notifyLeadMinutes]);
}
