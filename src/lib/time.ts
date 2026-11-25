import type { KaitenCard } from "./kaiten";

export type Bucket = "overdue" | "today" | "tomorrow" | "week" | "later" | "none";

export const BUCKET_LABEL: Record<Bucket, string> = {
  overdue: "Просрочено",
  today: "Сегодня",
  tomorrow: "Завтра",
  week: "Ближайшие 7 дней",
  later: "Позже",
  none: "Без срока",
};

export const BUCKET_ORDER: Bucket[] = ["overdue", "today", "tomorrow", "week", "later", "none"];

const DAY = 86_400_000;

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Kaiten stores date-only deadlines as midnight UTC. Treat those as the end of
 * that calendar day in local time; timed deadlines are taken as-is.
 */
export function dueAt(c: KaitenCard): Date | null {
  if (!c.due_date) return null;
  if (c.due_date_time_present) return new Date(c.due_date);
  const [y, m, d] = c.due_date.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59);
}

export function isDateOnly(c: KaitenCard) {
  return !!c.due_date && !c.due_date_time_present;
}

export function bucketOf(c: KaitenCard, now = new Date()): Bucket {
  const due = dueAt(c);
  if (!due) return "none";
  if (due.getTime() < now.getTime()) return "overdue";
  const days = Math.round((startOfDay(due).getTime() - startOfDay(now).getTime()) / DAY);
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  if (days <= 7) return "week";
  return "later";
}

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};

export function durationRu(ms: number): string {
  const min = Math.max(1, Math.round(Math.abs(ms) / 60_000));
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  if (h < 24) {
    const rest = min % 60;
    return rest && h < 6 ? `${h} ч ${rest} мин` : `${h} ч`;
  }
  const d = Math.round(h / 24);
  return `${d} ${plural(d, "день", "дня", "дней")}`;
}

const timeFmt = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" });
const weekdayFmt = new Intl.DateTimeFormat("ru-RU", { weekday: "short" });

/** Short label on the right side of a row. */
export function dueLabel(c: KaitenCard, now = new Date()): string {
  const due = dueAt(c);
  if (!due) return "";
  const b = bucketOf(c, now);
  if (b === "overdue") {
    if (!isDateOnly(c)) return `${durationRu(now.getTime() - due.getTime())} назад`;
    // date-only deadlines count in calendar days
    const days = Math.round((startOfDay(now).getTime() - startOfDay(due).getTime()) / DAY);
    return days <= 1 ? "вчера" : `${days} ${plural(days, "день", "дня", "дней")} назад`;
  }
  if (b === "today") return isDateOnly(c) ? "до конца дня" : timeFmt.format(due);
  if (b === "tomorrow") return isDateOnly(c) ? "завтра" : `завтра ${timeFmt.format(due)}`;
  if (b === "week") return weekdayFmt.format(due) + ", " + dayFmt.format(due).replace(".", "");
  return dayFmt.format(due).replace(".", "");
}

export function fullDue(c: KaitenCard): string {
  const due = dueAt(c);
  if (!due) return "Срок не задан";
  const date = new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long" }).format(due);
  return isDateOnly(c) ? date : `${date}, ${timeFmt.format(due)}`;
}

export function sortByDue(a: KaitenCard, b: KaitenCard) {
  const da = dueAt(a)?.getTime() ?? Infinity;
  const db = dueAt(b)?.getTime() ?? Infinity;
  if (da !== db) return da - db;
  return Number(!!b.asap) - Number(!!a.asap);
}

export function agoRu(t: number, now = Date.now()): string {
  const s = Math.round((now - t) / 1000);
  if (s < 45) return "только что";
  return `${durationRu(now - t)} назад`;
}

/** "через 2 ч" / "просрочено на 5 ч" for the card sheet. */
export function relativeDue(c: KaitenCard, now = new Date()): string {
  const due = dueAt(c);
  if (!due) return "";
  const diff = due.getTime() - now.getTime();
  if (diff < 0) return isDateOnly(c) ? `просрочено, ${dueLabel(c, now)}` : `просрочено на ${durationRu(-diff)}`;
  return `через ${durationRu(diff)}`;
}
