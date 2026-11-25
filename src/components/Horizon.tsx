import { useMemo } from "react";
import type { KaitenCard } from "../lib/kaiten";
import { bucketOf, dueAt, durationRu, type Bucket } from "../lib/time";

/**
 * The 14-day deadline horizon: overdue cards gather in a band left of "now",
 * upcoming ones sit at their real position in time. Click a dot to jump to it.
 */
const DAYS = 14;
const W = 352;
const OVERDUE_W = 34; // band left of "now"
const H = 64;
const AXIS_Y = 34;

export const BUCKET_COLOR: Record<Bucket, string> = {
  overdue: "var(--overdue)",
  today: "var(--today)",
  tomorrow: "var(--soon)",
  week: "var(--soon)",
  later: "var(--later)",
  none: "var(--faint)",
};

const weekday = new Intl.DateTimeFormat("ru-RU", { weekday: "narrow" });

export function Horizon({
  cards,
  selectedId,
  onSelect,
}: {
  cards: KaitenCard[];
  selectedId?: number;
  onSelect: (c: KaitenCard) => void;
}) {
  const now = new Date();
  const start = now.getTime();
  const span = DAYS * 86_400_000;
  const x0 = OVERDUE_W + 6;
  const scale = (W - x0 - 6) / span;

  const dots = useMemo(() => {
    const placed: { c: KaitenCard; x: number; y: number; b: Bucket }[] = [];
    const overdue = cards.filter((c) => bucketOf(c, now) === "overdue");
    overdue.forEach((c, i) => {
      const col = i % 3, row = Math.floor(i / 3);
      placed.push({ c, x: 9 + col * 9, y: AXIS_Y - row * 9, b: "overdue" });
    });
    for (const c of cards) {
      const due = dueAt(c);
      if (!due || due.getTime() < start || due.getTime() > start + span) continue;
      const x = x0 + (due.getTime() - start) * scale;
      // stack dots that would overlap
      let y = AXIS_Y;
      while (placed.some((p) => Math.abs(p.x - x) < 8 && Math.abs(p.y - y) < 8)) y -= 9;
      placed.push({ c, x, y, b: bucketOf(c, now) });
    }
    return placed;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards]);

  const days = Array.from({ length: DAYS + 1 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    return { d, x: x0 + (d.getTime() - start) * scale };
  }).filter((t) => t.x >= x0 - 0.5);

  const next = cards
    .map((c) => ({ c, t: dueAt(c)?.getTime() }))
    .filter((v): v is { c: KaitenCard; t: number } => !!v.t && v.t >= start)
    .sort((a, b) => a.t - b.t)[0];
  const overdueCount = dots.filter((d) => d.b === "overdue").length;

  return (
    <section aria-label="Сроки на ближайшие две недели" className="px-4 pt-3 pb-2">
      <p className="text-[15px] leading-snug text-ink">
        {next ? (
          <>
            <span className="tabular font-semibold">Через {durationRu(next.t - start)}</span>{" "}
            <button className="text-muted hover:text-ink text-left" onClick={() => onSelect(next.c)}>
              {next.c.title}
            </button>
          </>
        ) : (
          <span className="text-muted">В ближайшие две недели сроков нет</span>
        )}
      </p>
      {overdueCount > 0 && (
        <p className="text-[12px] text-overdue mt-0.5 tabular">
          Просрочено: {overdueCount}
        </p>
      )}

      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="mt-1 block overflow-visible" role="img">
        {/* overdue band */}
        {overdueCount > 0 && <rect x={0} y={AXIS_Y - 3} width={OVERDUE_W} height={6} rx={3} fill="var(--overdue)" opacity={0.18} />}
        {/* axis */}
        <line x1={x0} x2={W} y1={AXIS_Y} y2={AXIS_Y} stroke="var(--line)" strokeWidth={2} strokeLinecap="round" />
        {days.map(({ d, x }, i) => {
          const weekend = d.getDay() === 0 || d.getDay() === 6;
          return (
            <g key={i}>
              <line x1={x} x2={x} y1={AXIS_Y + 4} y2={AXIS_Y + (i % 7 === 0 ? 10 : 7)} stroke="var(--line)" strokeWidth={1} />
              {i < DAYS && (
                <text
                  x={x + (scale * 86_400_000) / 2}
                  y={H - 6}
                  textAnchor="middle"
                  fontSize={9.5}
                  fill={weekend ? "var(--faint)" : "var(--muted)"}
                  opacity={weekend ? 0.7 : 1}
                >
                  {weekday.format(d)}
                </text>
              )}
            </g>
          );
        })}
        {/* now */}
        <line x1={x0} x2={x0} y1={6} y2={AXIS_Y + 12} stroke="var(--ink)" strokeWidth={2} strokeLinecap="round" />
        {dots.map(({ c, x, y, b }) => (
          <circle
            key={c.id}
            cx={x}
            cy={y}
            r={c.id === selectedId ? 5.5 : 4}
            fill={BUCKET_COLOR[b]}
            stroke="var(--surface)"
            strokeWidth={1.5}
            className="cursor-pointer transition-[r] duration-150"
            onClick={() => onSelect(c)}
          >
            <title>{c.title}</title>
          </circle>
        ))}
      </svg>
    </section>
  );
}
