import { useRef, useState } from "react";
import { ArrowLeft, CalendarClock, Check, Copy, ExternalLink } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addComment,
  getBoardColumns,
  getCard,
  getComments,
  moveCard,
  setChecklistItem,
  setDueDate,
  type KaitenCard,
} from "../lib/kaiten";
import { bucketOf, dueAt, fullDue, isDateOnly, relativeDue } from "../lib/time";
import { BUCKET_COLOR } from "./Horizon";
import { IconButton } from "./CardList";

const pad = (n: number) => String(n).padStart(2, "0");
const toDateInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toTimeInput = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const commentDate = (d: Date, withTime: boolean) =>
  new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(d);
const commentTime = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function CardDetail({
  card,
  onBack,
  onOpenInKaiten,
  onCopyLink,
  onChanged,
  flash,
}: {
  card: KaitenCard;
  onBack: () => void;
  onOpenInKaiten: (c: KaitenCard) => void;
  onCopyLink: (c: KaitenCard) => void;
  /** Card changed in Kaiten: refresh the list. */
  onChanged: () => void;
  flash: (msg: string) => void;
}) {
  const qc = useQueryClient();
  const full = useQuery({ queryKey: ["card", card.id], queryFn: () => getCard(card.id) });
  const columns = useQuery({
    queryKey: ["columns", card.board_id],
    queryFn: () => getBoardColumns(card.board_id),
    staleTime: 10 * 60_000,
  });
  const comments = useQuery({ queryKey: ["comments", card.id], queryFn: () => getComments(card.id) });

  const c: KaitenCard = { ...card, ...(full.data ?? {}) };
  const b = bucketOf(c);
  const responsible = c.members?.filter((m) => m.type === 2) ?? [];
  const members = c.members?.filter((m) => m.type !== 2) ?? [];

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dueOpen, setDueOpen] = useState(false);

  const reload = () => {
    qc.invalidateQueries({ queryKey: ["card", card.id] });
    onChanged();
  };

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const markDone = () =>
    run(async () => {
      const cols = columns.data ?? (await getBoardColumns(c.board_id));
      const done = cols.find((col) => col.type === 3);
      if (!done) throw new Error("На этой доске нет колонки «Готово». Перенесите карточку вручную.");
      await moveCard(c.id, done.id);
      onChanged();
      flash(`Перенесено в «${done.title}»`);
      onBack();
    });

  const moveTo = (columnId: number) =>
    run(async () => {
      const col = columns.data?.find((x) => x.id === columnId);
      await moveCard(c.id, columnId);
      reload();
      flash(`Перенесено в «${col?.title ?? "колонку"}»`);
      if (col?.type === 3) onBack();
    });

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 px-2 pt-2">
        <IconButton label="Назад к списку" onClick={onBack}>
          <ArrowLeft className="size-4" />
        </IconButton>
        <span className="flex-1 text-[12px] text-muted truncate">{c.board?.title}</span>
        <IconButton label="Скопировать ссылку" onClick={() => onCopyLink(c)}>
          <Copy className="size-3.5" />
        </IconButton>
        <IconButton label="Открыть в Kaiten" onClick={() => onOpenInKaiten(c)}>
          <ExternalLink className="size-3.5" />
        </IconButton>
      </div>

      <div className="flex-1 overflow-y-auto scroll-quiet px-4 pb-4">
        <h1 className="mt-2 text-[17px] font-semibold leading-snug text-ink select-text">{c.title}</h1>

        <dl className="mt-3 grid grid-cols-[112px_1fr] gap-y-1.5 items-baseline text-[12.5px]">
          <dt className="text-muted">Срок</dt>
          <dd>
            <span className="first-letter:uppercase inline-block">{fullDue(c)}</span>
            {c.due_date && (
              <span className="block" style={{ color: BUCKET_COLOR[b] }}>
                {relativeDue(c)}
              </span>
            )}
          </dd>
          <dt className="text-muted">Колонка</dt>
          <dd>
            <select
              aria-label="Перенести в колонку"
              disabled={busy || !columns.data}
              value={c.column_id}
              onChange={(e) => moveTo(Number(e.target.value))}
              className="max-w-full h-7 -ml-1.5 px-1.5 rounded-md bg-transparent border border-transparent hover:border-line focus:border-accent outline-none text-[12.5px]"
            >
              {!columns.data?.some((col) => col.id === c.column_id) && (
                <option value={c.column_id}>{c.column?.title ?? "…"}</option>
              )}
              {columns.data?.map((col) => (
                <option key={col.id} value={col.id}>
                  {col.title}
                </option>
              ))}
            </select>
          </dd>
          {responsible.length > 0 && (
            <>
              <dt className="text-muted">Ответственный</dt>
              <dd>{responsible.map((m) => m.full_name).join(", ")}</dd>
            </>
          )}
          {members.length > 0 && (
            <>
              <dt className="text-muted">Участники</dt>
              <dd>{members.map((m) => m.full_name).join(", ")}</dd>
            </>
          )}
          {(c.asap || c.blocked) && (
            <>
              <dt className="text-muted">Статус</dt>
              <dd className="text-overdue">{[c.asap && "срочно", c.blocked && "заблокирована"].filter(Boolean).join(", ")}</dd>
            </>
          )}
        </dl>

        <div className="mt-3 flex gap-2">
          <button
            onClick={markDone}
            disabled={busy}
            className="flex-1 flex items-center justify-center gap-1.5 h-8 rounded-lg bg-accent text-white text-[12.5px] font-medium hover:brightness-110 disabled:opacity-50"
          >
            <Check className="size-4" /> Отметить готовой
          </button>
          <button
            onClick={() => setDueOpen((v) => !v)}
            aria-expanded={dueOpen}
            className={`flex-1 flex items-center justify-center gap-1.5 h-8 rounded-lg border border-line text-[12.5px] hover:bg-hover ${dueOpen ? "bg-hover" : ""}`}
          >
            <CalendarClock className="size-4" /> {c.due_date ? "Перенести срок" : "Назначить срок"}
          </button>
        </div>

        {error && <p role="alert" className="mt-2 text-[12.5px] text-overdue">{error}</p>}

        {dueOpen && (
          <DueForm
            card={c}
            onSaved={(msg) => {
              setDueOpen(false);
              reload();
              qc.invalidateQueries({ queryKey: ["comments", card.id] });
              flash(msg);
            }}
          />
        )}

        {c.checklists?.map((cl) => (
          <section key={cl.id} className="mt-4">
            <h2 className="flex justify-between text-[12px] font-medium text-muted">
              <span>{cl.name}</span>
              <span className="tabular text-faint">
                {cl.items?.filter((i) => i.checked).length ?? 0} из {cl.items?.length ?? 0}
              </span>
            </h2>
            <ul className="mt-1 -mx-1">
              {cl.items?.map((item) => (
                <ChecklistRow key={item.id} cardId={c.id} checklistId={cl.id} item={item} onError={setError} onSaved={() => qc.invalidateQueries({ queryKey: ["card", card.id] })} />
              ))}
            </ul>
          </section>
        ))}

        {c.description ? (
          <section className="mt-4">
            <h2 className="text-[12px] font-medium text-muted">Описание</h2>
            <p className="mt-1 text-[13px] leading-relaxed whitespace-pre-wrap text-ink/90 select-text max-w-[60ch]">{c.description}</p>
          </section>
        ) : null}

        <section className="mt-4">
          <h2 className="text-[12px] font-medium text-muted">Комментарии</h2>
          {comments.error && <p className="mt-1 text-[12px] text-overdue">{(comments.error as Error).message}</p>}
          <ul className="mt-1 space-y-2">
            {comments.data
              ?.filter((cm) => !cm.deleted)
              .slice(-5)
              .map((cm) => (
                <li key={cm.id} className="text-[12.5px]">
                  <span className="text-muted text-[11.5px]">
                    {cm.author?.full_name ?? "Комментарий"}, <span className="tabular">{commentTime.format(new Date(cm.created))}</span>
                  </span>
                  <p className="whitespace-pre-wrap select-text">{cm.text}</p>
                </li>
              ))}
          </ul>
          <CommentForm
            cardId={c.id}
            onSent={() => {
              qc.invalidateQueries({ queryKey: ["comments", card.id] });
              flash("Комментарий добавлен");
            }}
          />
        </section>
      </div>
    </div>
  );
}

function ChecklistRow({
  cardId,
  checklistId,
  item,
  onError,
  onSaved,
}: {
  cardId: number;
  checklistId: number;
  item: { id: number; text: string; checked: boolean };
  onError: (msg: string | null) => void;
  onSaved: () => void;
}) {
  // optimistic: show the new state immediately, roll back on failure
  const [pending, setPending] = useState<boolean | null>(null);
  const checked = pending ?? item.checked;
  return (
    <li>
      <label className="flex items-start gap-2 px-1 py-1 rounded-md hover:bg-hover text-[12.5px]">
        <input
          type="checkbox"
          className="mt-0.5 accent-[var(--accent)]"
          checked={checked}
          disabled={pending !== null}
          onChange={async (e) => {
            const next = e.target.checked;
            setPending(next);
            onError(null);
            try {
              await setChecklistItem(cardId, checklistId, item.id, next);
              item.checked = next;
              onSaved();
            } catch (err) {
              onError(`Пункт не сохранён: ${(err as Error).message}`);
            } finally {
              setPending(null);
            }
          }}
        />
        <span className={checked ? "text-muted line-through" : ""}>{item.text}</span>
      </label>
    </li>
  );
}

function CommentForm({ cardId, onSent }: { cardId: number; onSent: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await addComment(cardId, text.trim());
      setText("");
      onSent();
    } catch (e) {
      setError(`Комментарий не отправлен: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-2">
      <textarea
        aria-label="Новый комментарий"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
        }}
        rows={2}
        maxLength={4096}
        placeholder="Написать комментарий"
        className="w-full px-2.5 py-1.5 rounded-lg bg-paper border border-line outline-none focus:border-accent text-[12.5px] resize-none"
      />
      {error && <p role="alert" className="text-[12px] text-overdue">{error}</p>}
      <button
        onClick={send}
        disabled={!text.trim() || busy}
        className="mt-1 h-7 px-3 rounded-lg border border-line text-[12.5px] hover:bg-hover disabled:opacity-40"
      >
        {busy ? "Отправляю…" : "Добавить комментарий"}
      </button>
    </div>
  );
}

/** Reschedule: the reason is required and is written to the card as a comment. */
function DueForm({ card, onSaved }: { card: KaitenCard; onSaved: (msg: string) => void }) {
  const old = dueAt(card);
  const oldTimed = !!card.due_date && !isDateOnly(card);
  const [date, setDate] = useState(old ? toDateInput(old) : "");
  const [time, setTime] = useState(old && oldTimed ? toTimeInput(old) : "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // If the date was saved but the comment failed, a retry must only resend the comment.
  const dueSaved = useRef(false);

  const reasonRequired = !!old;
  const next = date ? new Date(`${date}T${time || "00:00"}`) : null;
  const unchanged = !!old && !!next && date === toDateInput(old) && (time || "") === (oldTimed ? toTimeInput(old) : "");
  const canSave = !!next && !unchanged && (!reasonRequired || reason.trim().length >= 3) && !busy;

  const preset = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    setDate(toDateInput(d));
  };

  const save = async () => {
    if (!next) return;
    setBusy(true);
    setError(null);
    try {
      if (!dueSaved.current) {
        await setDueDate(card.id, next, !!time);
        dueSaved.current = true;
      }
      const to = commentDate(next, !!time);
      const text = old
        ? `Срок перенесён: ${commentDate(old, oldTimed)} → ${to}.\nПричина: ${reason.trim()}`
        : reason.trim()
          ? `Срок назначен: ${to}.\n${reason.trim()}`
          : "";
      if (text) {
        try {
          await addComment(card.id, text);
        } catch (e) {
          throw new Error(`Срок изменён, но комментарий не записан (${(e as Error).message}). Нажмите «Сохранить» ещё раз.`);
        }
      }
      onSaved(old ? "Срок перенесён" : "Срок назначен");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const field = "h-8 px-2 rounded-lg bg-surface border border-line outline-none focus:border-accent text-[12.5px] tabular";
  return (
    <div className="mt-2 p-3 rounded-lg bg-paper space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {([[1, "Завтра"], [3, "Через 3 дня"], [7, "Через неделю"]] as const).map(([d, label]) => (
          <button key={d} onClick={() => preset(d)} disabled={dueSaved.current} className="h-7 px-2.5 rounded-full border border-line bg-surface text-[12px] hover:bg-hover">
            {label}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <input aria-label="Новая дата" type="date" value={date} disabled={dueSaved.current} onChange={(e) => setDate(e.target.value)} className={`${field} flex-1`} />
        <input aria-label="Время, необязательно" type="time" value={time} disabled={dueSaved.current} onChange={(e) => setTime(e.target.value)} className={field} />
      </div>
      <label className="block">
        <span className="text-[12px] text-muted">
          {reasonRequired ? "Почему переносится срок — запишется комментарием в карточку" : "Комментарий, необязательно"}
        </span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          maxLength={3800}
          className="mt-1 w-full px-2.5 py-1.5 rounded-lg bg-surface border border-line outline-none focus:border-accent text-[12.5px] resize-none"
        />
      </label>
      {error && <p role="alert" className="text-[12px] text-overdue">{error}</p>}
      <button onClick={save} disabled={!canSave} className="w-full h-8 rounded-lg bg-accent text-white text-[12.5px] font-medium disabled:opacity-40">
        {busy ? "Сохраняю…" : "Сохранить"}
      </button>
      {reasonRequired && !unchanged && next && reason.trim().length < 3 && (
        <p className="text-[11.5px] text-faint">Чтобы сохранить, укажите причину переноса.</p>
      )}
    </div>
  );
}
