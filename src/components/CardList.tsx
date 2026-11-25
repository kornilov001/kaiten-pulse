import { useEffect, useRef } from "react";
import { Ban, Copy, ExternalLink, Zap } from "lucide-react";
import type { KaitenCard } from "../lib/kaiten";
import type { Grouped } from "../lib/useCards";
import { BUCKET_LABEL, bucketOf, dueLabel } from "../lib/time";
import { BUCKET_COLOR } from "./Horizon";

export function CardList({
  groups,
  selectedId,
  onOpenDetail,
  onOpenInKaiten,
  onCopyLink,
}: {
  groups: Grouped[];
  selectedId?: number;
  onOpenDetail: (c: KaitenCard) => void;
  onOpenInKaiten: (c: KaitenCard) => void;
  onCopyLink: (c: KaitenCard) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectedId) return;
    listRef.current
      ?.querySelector(`[data-card="${selectedId}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedId]);

  return (
    <div ref={listRef} className="flex-1 overflow-y-auto scroll-quiet pb-2">
      {groups.map(({ bucket, cards }) => (
        <section key={bucket} aria-label={BUCKET_LABEL[bucket]}>
          <h2 className="sticky top-0 z-10 flex items-baseline justify-between bg-surface/95 backdrop-blur px-4 pt-3 pb-1 text-[12px] font-medium text-muted">
            <span style={bucket === "overdue" ? { color: "var(--overdue)" } : undefined}>{BUCKET_LABEL[bucket]}</span>
            <span className="tabular text-faint">{cards.length}</span>
          </h2>
          <ul>
            {cards.map((c) => (
              <CardRow
                key={c.id}
                card={c}
                selected={c.id === selectedId}
                onOpenDetail={onOpenDetail}
                onOpenInKaiten={onOpenInKaiten}
                onCopyLink={onCopyLink}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function CardRow({
  card: c,
  selected,
  onOpenDetail,
  onOpenInKaiten,
  onCopyLink,
}: {
  card: KaitenCard;
  selected: boolean;
  onOpenDetail: (c: KaitenCard) => void;
  onOpenInKaiten: (c: KaitenCard) => void;
  onCopyLink: (c: KaitenCard) => void;
}) {
  const b = bucketOf(c);
  const urgent = b === "overdue" || b === "today";
  return (
    <li
      data-card={c.id}
      className={`group relative mx-2 rounded-lg ${selected ? "bg-hover" : "hover:bg-hover"}`}
    >
      {urgent && (
        <span
          aria-hidden
          className="absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-full"
          style={{ background: BUCKET_COLOR[b] }}
        />
      )}
      <button
        className="w-full text-left pl-3.5 pr-3 py-2 flex gap-3 items-start"
        onClick={() => onOpenDetail(c)}
        onDoubleClick={() => onOpenInKaiten(c)}
      >
        <span className="flex-1 min-w-0">
          <span className="block text-[13px] font-medium leading-snug line-clamp-2 text-ink">
            {c.asap && <Zap aria-label="Срочно" className="inline -mt-0.5 mr-1 size-3.5 text-overdue" />}
            {c.title}
          </span>
          <span className="mt-0.5 flex items-center gap-1 text-[11.5px] text-muted truncate">
            {c.blocked && <Ban aria-label="Заблокирована" className="size-3 text-overdue shrink-0" />}
            <span className="truncate">{c.board?.title}</span>
            {c.column?.title && (
              <>
                <span className="text-faint">/</span>
                <span className="truncate shrink-0">{c.column.title}</span>
              </>
            )}
          </span>
        </span>
        <span
          className="tabular text-[12px] whitespace-nowrap pt-px group-hover:invisible group-focus-within:invisible"
          style={{ color: urgent ? BUCKET_COLOR[b] : "var(--muted)" }}
        >
          {dueLabel(c)}
        </span>
      </button>
      <span className="absolute right-2 top-1.5 hidden group-hover:flex group-focus-within:flex gap-0.5">
        <IconButton label="Открыть в Kaiten" onClick={() => onOpenInKaiten(c)}>
          <ExternalLink className="size-3.5" />
        </IconButton>
        <IconButton label="Скопировать ссылку" onClick={() => onCopyLink(c)}>
          <Copy className="size-3.5" />
        </IconButton>
      </span>
    </li>
  );
}

export function IconButton({
  label,
  onClick,
  children,
  className = "",
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`grid place-items-center size-7 rounded-md text-muted hover:text-ink hover:bg-line/60 ${className}`}
    >
      {children}
    </button>
  );
}
