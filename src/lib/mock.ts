/**
 * Browser-preview data in the shape of Kaiten API responses, used only when the
 * UI runs outside Tauri (`npm run dev` in a normal browser).
 */
const now = Date.now();
const H = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const dateOnly = (daysFromToday: number) => {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T00:00:00.000Z`;
};

const me = { id: 7, full_name: "Иван Петров", username: "ipetrov", email: "demo@example.com" };

const board = (id: number, title: string, space: number) => ({ id, title, spaces: [{ id: space }] });
const column = (id: number, title: string, type = 2) => ({ id, title, type });
const resp = { ...me, type: 2 };

let id = 4100;
const card = (title: string, due: string | null, timed: boolean, b: ReturnType<typeof board>, c: ReturnType<typeof column>, extra = {}) => ({
  id: ++id,
  title,
  due_date: due,
  due_date_time_present: timed,
  state: c.type === 1 ? 1 : 2,
  condition: 1,
  board_id: b.id,
  column_id: c.id,
  board: b,
  column: c,
  path_data: { space: { id: b.spaces[0].id } },
  members: [resp, { id: 9, full_name: "Мария Ким", type: 1 }],
  comments_total: Math.floor(Math.random() * 6),
  description: "Проверить коллизии между разделами АР и ОВ на отметке +12.600, собрать замечания в один лист и согласовать с ГИПом.",
  ...extra,
});

const bArch = board(11, "Проект ЖК «Северный»", 1);
const bBim = board(12, "BIM-координация", 1);
const bOps = board(13, "Внутренние задачи", 2);

const cards = [
  card("Сдать раздел АР на экспертизу", dateOnly(-2), false, bArch, column(101, "В работе"), { asap: true }),
  card("Ответить на замечания заказчика по фасадам", iso(now - 5 * H), true, bArch, column(102, "На согласовании")),
  card("Сверка моделей АР и ОВ, отметка +12.600", iso(now + 2.25 * H), true, bBim, column(201, "В работе")),
  card("Созвон с подрядчиком по узлам кровли", iso(now + 5 * H), true, bArch, column(101, "В работе")),
  card("Обновить семейства окон в шаблоне Revit", dateOnly(0), false, bBim, column(202, "Очередь", 1)),
  card("Выгрузить IFC для смежников", dateOnly(1), false, bBim, column(201, "В работе"), { blocked: true }),
  card("Подготовить спецификацию дверей", dateOnly(3), false, bArch, column(101, "В работе")),
  card("Ревью стандарта именования видов", dateOnly(5), false, bOps, column(301, "Очередь", 1)),
  card("Квартальный отчёт по трудозатратам", dateOnly(16), false, bOps, column(302, "В работе")),
  card("Разобрать библиотеку узлов", null, false, bOps, column(301, "Очередь", 1)),
];

const columnsByBoard: Record<number, ReturnType<typeof column>[]> = {
  11: [column(100, "Очередь", 1), column(101, "В работе"), column(102, "На согласовании"), column(103, "Готово", 3)],
  12: [column(202, "Очередь", 1), column(201, "В работе"), column(203, "Готово", 3)],
  13: [column(301, "Очередь", 1), column(302, "В работе"), column(303, "Готово", 3)],
};
const checklists = [
  {
    id: 1,
    name: "Перед отправкой",
    items: [
      { id: 1, text: "Собрать замечания в один лист", checked: true },
      { id: 2, text: "Согласовать с ГИПом", checked: false },
      { id: 3, text: "Выгрузить отчёт о коллизиях", checked: false },
    ],
  },
];
const comments: Record<number, { id: number; text: string; created: string; author: { id: number; full_name: string } }[]> = {};
let commentId = 1;

export async function mockRequest(method: string, path: string, _q?: [string, string][], body?: unknown): Promise<unknown> {
  await new Promise((r) => setTimeout(r, 250));
  if (path === "/users/current") return me;
  if (path === "/spaces") return [{ id: 1, title: "Проектирование" }, { id: 2, title: "Отдел BIM" }];
  if (path === "/cards") {
    const offset = Number(_q?.find(([k]) => k === "offset")?.[1] ?? 0);
    return offset ? [] : cards.filter((c) => c.state !== 3);
  }
  let m = path.match(/^\/boards\/(\d+)\/columns$/);
  if (m) return columnsByBoard[Number(m[1])] ?? [];
  m = path.match(/^\/cards\/(\d+)$/);
  if (m) {
    const c = cards.find((c) => c.id === Number(m![1])) as Record<string, unknown> | undefined;
    if (!c) throw "http_404: not found";
    if (method === "PATCH") {
      const patch = body as Record<string, unknown>;
      Object.assign(c, patch);
      if (patch.column_id) {
        const col = columnsByBoard[c.board_id as number]?.find((x) => x.id === patch.column_id);
        if (col) Object.assign(c, { column: col, state: col.type });
      }
    }
    return { ...c, checklists };
  }
  m = path.match(/^\/cards\/(\d+)\/comments$/);
  if (m) {
    const list = (comments[Number(m[1])] ??= []);
    if (method === "POST") {
      const c = { id: commentId++, text: (body as { text: string }).text, created: new Date().toISOString(), author: me };
      list.push(c);
      return c;
    }
    return list;
  }
  m = path.match(/^\/cards\/\d+\/checklists\/\d+\/items\/(\d+)$/);
  if (m && method === "PATCH") {
    const item = checklists[0].items.find((i) => i.id === Number(m![1]))!;
    item.checked = (body as { checked: boolean }).checked;
    return item;
  }
  throw "http_404: not found";
}
