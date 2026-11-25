import { invoke } from "@tauri-apps/api/core";
import { mockRequest } from "./mock";

/** Subset of the Kaiten card object we rely on (GET /cards). */
export interface KaitenCard {
  id: number;
  title: string;
  due_date: string | null;
  due_date_time_present?: boolean;
  state: 1 | 2 | 3; // 1 queued, 2 in progress, 3 done
  condition: 1 | 2; // 1 on board, 2 archived
  asap?: boolean;
  blocked?: boolean;
  board_id: number;
  column_id: number;
  board?: { id: number; title: string; spaces?: { id: number }[] };
  column?: { id: number; title: string; type?: number };
  lane?: { id: number; title: string };
  type?: { id: number; name?: string; letter?: string; color?: number };
  path_data?: { space?: { id: number; title?: string } };
  space_id?: number;
  members?: KaitenMember[];
  comments_total?: number;
  description?: string | null;
  updated?: string;
  checklists?: KaitenChecklist[];
}

export interface KaitenChecklistItem {
  id: number;
  text: string;
  checked: boolean;
  sort_order?: number;
}

export interface KaitenChecklist {
  id: number;
  name: string;
  items?: KaitenChecklistItem[] | null;
}

export interface KaitenComment {
  id: number;
  text: string;
  created: string;
  author?: { id: number; full_name: string };
  author_id?: number;
  deleted?: boolean;
}

export interface KaitenColumn {
  id: number;
  title: string;
  type: 1 | 2 | 3; // 1 queue, 2 in progress, 3 done
  sort_order?: number;
  subcolumns?: KaitenColumn[];
}

export interface KaitenMember {
  id: number;
  full_name: string;
  username?: string;
  avatar_url?: string | null;
  type?: 1 | 2; // 1 member, 2 responsible
}

export interface KaitenUser {
  id: number;
  full_name: string;
  username: string;
  email: string;
}

export interface KaitenSpace {
  id: number;
  title: string;
  archived?: boolean;
}

export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type Query = Record<string, string | number | boolean | undefined>;

export class KaitenError extends Error {
  constructor(
    public kind: "not_configured" | "auth" | "forbidden" | "not_found" | "rate_limit" | "network" | "other",
    message: string,
  ) {
    super(message);
  }
}

function toKaitenError(raw: unknown): KaitenError {
  const s = String(raw);
  if (s.startsWith("not_configured")) return new KaitenError("not_configured", "Kaiten не подключён");
  if (s.startsWith("http_401")) return new KaitenError("auth", "Токен не подходит. Создайте новый в профиле Kaiten → API-ключ.");
  if (s.startsWith("http_403")) return new KaitenError("forbidden", "Нет доступа к этим данным в Kaiten.");
  if (s.startsWith("http_404")) return new KaitenError("not_found", "Не найдено в Kaiten.");
  if (s.startsWith("http_429")) return new KaitenError("rate_limit", "Kaiten просит подождать: слишком много запросов.");
  if (s.startsWith("network")) return new KaitenError("network", "Нет связи с Kaiten. Проверьте интернет или адрес домена.");
  if (s.startsWith("bad_request: domain")) return new KaitenError("other", "Адрес выглядит неверно. Пример: company.kaiten.ru");
  return new KaitenError("other", s.replace(/^http_\d+: /, ""));
}

export async function request<T>(method: string, path: string, query?: Query, body?: unknown): Promise<T> {
  const q = query
    ? Object.entries(query)
        .filter(([, v]) => v !== undefined && v !== "")
        .map(([k, v]) => [k, String(v)] as [string, string])
    : undefined;
  try {
    if (!inTauri) return (await mockRequest(method, path, q, body)) as T;
    return await invoke<T>("kaiten_request", { method, path, query: q, body: body ?? null });
  } catch (e) {
    throw e instanceof KaitenError ? e : toKaitenError(e);
  }
}

export async function connect(domain: string, token: string): Promise<KaitenUser> {
  try {
    if (!inTauri) return (await mockRequest("GET", "/users/current")) as KaitenUser;
    return await invoke<KaitenUser>("connect", { domain, token });
  } catch (e) {
    throw toKaitenError(e);
  }
}

export async function disconnect(): Promise<void> {
  if (inTauri) await invoke("disconnect");
}

export async function connectionInfo(): Promise<{ domain: string } | null> {
  if (!inTauri) return { domain: "demo.kaiten.ru" };
  return invoke("connection_info");
}

export const getCurrentUser = () => request<KaitenUser>("GET", "/users/current");

export async function getSpaces(): Promise<KaitenSpace[]> {
  const out: KaitenSpace[] = [];
  for (let offset = 0; offset < 1000; offset += 100) {
    const page = await request<KaitenSpace[]>("GET", "/spaces", { limit: 100, offset });
    out.push(...page);
    if (page.length < 100) break;
  }
  return out.filter((s) => !s.archived);
}

export type Role = "responsible" | "member" | "any";

export interface CardQuery {
  userId: number;
  role: Role;
  spaceIds: number[]; // empty = all
  includeInQueue: boolean;
}

/** Live (not archived, not done) cards for the user, all pages. */
export async function getMyCards(q: CardQuery): Promise<KaitenCard[]> {
  const base: Query = {
    condition: 1,
    states: q.includeInQueue ? "1,2" : "2",
  };
  if (q.role === "responsible") base.responsible_ids = q.userId;
  else base.member_ids = q.userId; // member_ids covers responsible too

  const spaces = q.spaceIds.length ? q.spaceIds : [undefined];
  const seen = new Map<number, KaitenCard>();
  for (const space_id of spaces) {
    for (let offset = 0; offset < 1000; offset += 100) {
      const page = await request<KaitenCard[]>("GET", "/cards", { ...base, space_id, limit: 100, offset });
      for (const c of page) seen.set(c.id, c);
      if (page.length < 100) break;
    }
  }
  return [...seen.values()].filter((c) => c.state !== 3 && c.condition !== 2);
}

export const getCard = (id: number) =>
  request<KaitenCard>("GET", `/cards/${id}`);

// ---- actions ----

/** Board columns flattened: a column with subcolumns is replaced by them ("Parent / Sub"). */
export async function getBoardColumns(boardId: number): Promise<KaitenColumn[]> {
  const cols = await request<KaitenColumn[]>("GET", `/boards/${boardId}/columns`);
  const bySort = (a: KaitenColumn, b: KaitenColumn) => (a.sort_order ?? 0) - (b.sort_order ?? 0);
  return [...cols].sort(bySort).flatMap((c) =>
    c.subcolumns?.length
      ? [...c.subcolumns].sort(bySort).map((s) => ({ ...s, title: `${c.title} / ${s.title}` }))
      : [c],
  );
}

export const moveCard = (id: number, columnId: number) =>
  request<KaitenCard>("PATCH", `/cards/${id}`, undefined, { column_id: columnId });

/** `date` is local. Without time, Kaiten expects midnight UTC of that calendar day. */
export function setDueDate(id: number, date: Date, withTime: boolean) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const due_date = withTime
    ? date.toISOString()
    : `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T00:00:00.000Z`;
  return request<KaitenCard>("PATCH", `/cards/${id}`, undefined, { due_date, due_date_time_present: withTime });
}

export const getComments = (cardId: number) =>
  request<KaitenComment[]>("GET", `/cards/${cardId}/comments`);

export const addComment = (cardId: number, text: string) =>
  request<KaitenComment>("POST", `/cards/${cardId}/comments`, undefined, { text });

export const setChecklistItem = (cardId: number, checklistId: number, itemId: number, checked: boolean) =>
  request<KaitenChecklistItem>("PATCH", `/cards/${cardId}/checklists/${checklistId}/items/${itemId}`, undefined, { checked });

export function cardSpaceId(c: KaitenCard): number | undefined {
  return c.path_data?.space?.id ?? c.space_id ?? c.board?.spaces?.[0]?.id;
}

/** Browser link to a card. Template placeholders: {domain} {id} {space}. */
export function cardUrl(c: KaitenCard, domain: string, template?: string): string {
  const space = cardSpaceId(c);
  const tpl = template?.trim() || (space ? "https://{domain}/space/{space}/card/{id}" : "https://{domain}/{id}");
  return tpl
    .replaceAll("{domain}", domain)
    .replaceAll("{id}", String(c.id))
    .replaceAll("{space}", String(space ?? ""));
}
