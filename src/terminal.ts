// Терминал — финальная карта сюжета 1.0. Здесь вся логика вкладки «Терминал» без React:
// разбор данных tarkov.dev (пропуска, рецепты, переход с Берега), личные шаги и готовность команды.
//
// Отметки игрока лежат в общем прогрессе (progress.ts) под ключами с префиксом «t:»:
//   t:ch:<slug>  — пройдена глава сюжета (список глав — STORY_CHAPTERS в guides.ts);
//   t:pass       — пропуск на Терминал есть;
//   t:route:<id> — выбранный путь (концовка), не больше одного.
// Уровни убежища — общие ключи «h:<id уровня>», как на странице «Убежище».
import { STORY_CHAPTERS } from './guides';
import { datasetRaw, load, loadItems } from './api';
import type { Item } from './api';

export const TERMINAL_MAP_ID = '65cc8f81a9aac3e77d0cfd3e';
export const SHORELINE_MAP_ID = '5704e554d2720bac5b8b456e';
export const INTEL_STATION_ID = '5d484fdf654e7600691aadf8';

type Dict = Record<string, string>;
/** Отметки игрока: объект из useProgress или Set из useTeam */
export type Marks = Record<string, boolean | undefined> | Set<string>;
const has = (m: Marks, k: string) => (m instanceof Set ? m.has(k) : !!m[k]);

// ---------- данные ----------
export type TItem = {
  id: string; name: string; shortName: string; icon?: string; wiki?: string;
  /** Где купить (по данным tarkov.dev): торговец и цена */
  buy: { vendor: string; price: number }[];
  /** Сюжетный предмет (не продаётся, в общем справочнике предметов его нет) */
  quest?: boolean;
};
export type TCraft = {
  id: string; product: string; stationId: string; stationName: string; level: number; duration: number;
  items: { id: string; count: number; tool: boolean }[];
};
/** Станция убежища: levelIds[0] — id уровня 1 и т. д. */
export type TStation = { normalizedName: string; id: string; name: string; levelIds: string[] };
export type TTransit = { mapId: string; mapName: string; normalizedName: string; label: string; x: number; z: number; outline: [number, number][] };
export type TerminalData = {
  mapName: string;
  /** Переходы на Терминал с других карт (сейчас один — с Берега) */
  transits: TTransit[];
  /** id предметов-пропусков (accessKeys карты), только те, что есть в справочнике */
  passes: string[];
  crafts: TCraft[];
  items: Record<string, TItem>;
  stations: Record<string, TStation>;
};

export type TerminalInput = {
  maps: any; mapsRu: Dict;
  crafts: any;
  hideout: any; hideoutRu: Dict;
  items: Pick<Item, 'id' | 'name' | 'shortName' | 'iconLink' | 'wikiLink' | 'buyFor'>[];
  /** tasks.questItems и перевод — для сюжетных предметов в рецептах */
  questItems?: Record<string, any>; tasksRu?: Dict;
};

const tr = (ru: Dict, key?: string | null) => (key == null ? '' : ru[key] ?? key);
const list = (x: any): any[] => (Array.isArray(x) ? x : Object.values(x || {}));

/** Станции убежища, которые нужны на пути к Терминалу */
export const STATION_NAMES = ['intelligence-center', 'solar-power', 'workbench'] as const;

const findTerminal = (maps: any[]) => maps.find((m) => m.id === TERMINAL_MAP_ID) || maps.find((m) => m.normalizedName === 'terminal');

/** Переходы на Терминал с других карт — только из набора maps */
export function buildTransits(mapsData: any, mapsRu: Dict): TTransit[] {
  const maps = list(mapsData?.maps);
  const termId = findTerminal(maps)?.id || TERMINAL_MAP_ID;
  const transits: TTransit[] = [];
  for (const m of maps) {
    for (const t of m.transits || []) {
      if (t.map !== termId || !t.position) continue;
      transits.push({
        mapId: m.id, mapName: tr(mapsRu, m.name), normalizedName: m.normalizedName,
        label: tr(mapsRu, t.description) || 'Переход на Терминал',
        x: t.position.x, z: t.position.z,
        outline: (t.outline || []).map((p: any) => [p.x, p.z] as [number, number]),
      });
    }
  }
  return transits;
}

export function buildTerminalData(inp: TerminalInput): TerminalData {
  const maps = list(inp.maps?.maps);
  const term = findTerminal(maps);
  const transits = buildTransits(inp.maps, inp.mapsRu);

  const byId: Record<string, TerminalInput['items'][number]> = {};
  for (const it of inp.items) byId[it.id] = it;
  const items: Record<string, TItem> = {};
  const addItem = (id: string, allowQuest = true) => {
    if (items[id]) return true;
    const it = byId[id];
    if (it) {
      items[id] = {
        id, name: it.name, shortName: it.shortName, icon: it.iconLink, wiki: it.wikiLink,
        buy: (it.buyFor || []).filter((o) => o.priceRUB > 0).map((o) => ({ vendor: o.vendor.name, price: o.priceRUB })),
      };
      return true;
    }
    const q = allowQuest ? inp.questItems?.[id] : null;
    if (q) {
      items[id] = { id, name: tr(inp.tasksRu || {}, q.name), shortName: tr(inp.tasksRu || {}, q.shortName), icon: q.iconLink, buy: [], quest: true };
      return true;
    }
    return false;
  };

  // Пропуска — из данных карты; id, которых нет в справочнике предметов, пропускаем.
  // Сюжетные предметы тоже: среди accessKeys есть контейнер «Альфа-1» с уликами — это спойлер пути «Спасителя».
  const passes = ((term?.accessKeys || []) as string[]).filter((id) => addItem(id, false));

  const hideout = list(inp.hideout);
  const stationName = (id: string) => tr(inp.hideoutRu, hideout.find((s) => s.id === id)?.name) || '?';
  const crafts: TCraft[] = list(inp.crafts)
    .filter((c) => c.productItem && passes.includes(c.productItem.item))
    .map((c) => ({
      id: c.id, product: c.productItem.item, stationId: c.station, stationName: stationName(c.station),
      level: c.level || 1, duration: c.duration || 0,
      items: [
        ...(c.requiredItems || []).map((r: any) => ({ id: r.item, count: r.count || 1, tool: !!r.attributes?.tool })),
        ...(c.requiredQuestItems || []).map((r: any) => ({ id: r.item, count: 1, tool: true })),
      ].map((r) => {
        // Ингредиент не нашёлся ни в предметах, ни в сюжетных — показываем как неизвестный, а не выбрасываем
        if (!addItem(r.id)) items[r.id] = { id: r.id, name: `Неизвестный предмет (${r.id})`, shortName: '?', buy: [] };
        return r;
      }),
    }));

  const stations: Record<string, TStation> = {};
  for (const s of hideout) {
    if (!(STATION_NAMES as readonly string[]).includes(s.normalizedName)) continue;
    const levels = [...(s.levels || [])].sort((a: any, b: any) => a.level - b.level);
    stations[s.normalizedName] = { normalizedName: s.normalizedName, id: s.id, name: tr(inp.hideoutRu, s.name), levelIds: levels.map((l: any) => l.id) };
  }

  return { mapName: tr(inp.mapsRu, term?.name) || 'Терминал', transits, passes, crafts, items, stations };
}

/**
 * Загрузка для страницы «Терминал». Готовый компактный результат кэшируется через load() (api.ts) на его срок;
 * когда кэш устарел, сырые наборы maps (~9 МБ), tasks (~2 МБ), crafts, hideout и items загружаются заново.
 */
export const loadTerminal = () => load<TerminalData>('terminal', async () => {
  const [maps, crafts, hideout, tasks, items] = await Promise.all([
    datasetRaw('maps'), datasetRaw('crafts'), datasetRaw('hideout'),
    datasetRaw('tasks').catch(() => null), loadItems(),
  ]);
  return buildTerminalData({
    maps: maps.data, mapsRu: maps.ru, crafts: crafts.data, hideout: hideout.data, hideoutRu: hideout.ru,
    items: items.items, questItems: tasks?.data?.questItems, tasksRu: tasks?.ru,
  });
});

/** Лёгкая загрузка для «Карт»: только переходы, из maps и maps_ru (без crafts, hideout, tasks, items). Свой ключ кэша. */
export const loadTerminalTransits = () => load<TTransit[]>('terminalTransits', async () => {
  const maps = await datasetRaw('maps');
  return buildTransits(maps.data, maps.ru);
});

// ---------- убежище ----------
/** Запасные id станций — для главной, где данные убежища не загружаются. id уровня в tarkov.dev: «<id станции>-<уровень>». */
const FALLBACK_STATION_IDS: Record<string, string> = {
  'intelligence-center': INTEL_STATION_ID, 'solar-power': '5d494a385b56502f18c98a0c', workbench: '5d484fda654e7600681d9315',
};
const FALLBACK_NAMES: Record<string, string> = { 'intelligence-center': 'Разведцентр', 'solar-power': 'Солнечная батарея', workbench: 'Верстак' };

export function stationOrFallback(stations: Record<string, TStation> | undefined, name: string): TStation {
  const s = stations?.[name];
  if (s) return s;
  const id = FALLBACK_STATION_IDS[name] || name;
  return { normalizedName: name, id, name: FALLBACK_NAMES[name] || name, levelIds: [1, 2, 3].map((n) => `${id}-${n}`) };
}

/** Построенный уровень — как на странице «Убежище»: сколько уровней отмечено подряд с первого */
export function builtLevel(s: TStation, done: Marks): number {
  let n = 0;
  for (let i = 0; i < s.levelIds.length; i++) { if (has(done, 'h:' + s.levelIds[i])) n = i + 1; else break; }
  return n;
}

export type RouteId = 'savior' | 'debtor' | 'fallen' | 'survivor';
export const ROUTES: { id: RouteId; name: string }[] = [
  { id: 'savior', name: 'Спаситель' }, { id: 'debtor', name: 'Должник' }, { id: 'fallen', name: 'Павший' }, { id: 'survivor', name: 'Выживший' },
];

export type HideoutReq = {
  key: string; station: (typeof STATION_NAMES)[number]; level: number;
  /** Зачем — без спойлеров и со спойлерами */
  why: string; whySpoiler: string;
  /** Нужен только на этих путях; не задано — всем */
  routes?: RouteId[];
  /** Не подтверждено данными игры */
  unverified?: boolean;
};
export const HIDEOUT_REQS: HideoutReq[] = [
  { key: 'intel1', station: 'intelligence-center', level: 1, why: 'крафт пропуска и карты Круглова', whySpoiler: 'крафт пропуска и карты Круглова; старт главы The Ticket' },
  { key: 'intel3', station: 'intelligence-center', level: 3, why: 'нужен для одной из концовок', whySpoiler: 'путь «Спасителя»', routes: ['savior'], unverified: true },
  { key: 'solar1', station: 'solar-power', level: 1, why: 'нужна для некоторых концовок', whySpoiler: 'пути «Спасителя» и «Павшего»', routes: ['savior', 'fallen'], unverified: true },
  { key: 'bench1', station: 'workbench', level: 1, why: 'экспериментальный глушитель сигнала (крафт 25 ч, нужно электричество)', whySpoiler: 'экспериментальный глушитель сигнала (крафт 25 ч, нужно электричество)', unverified: true },
];

// ---------- личные шаги ----------
export const PASS_KEY = 't:pass';
export const chapterKey = (slug: string) => 't:ch:' + slug;
export const routeKey = (id: RouteId) => 't:route:' + id;

export function routeOf(done: Marks): RouteId | null {
  return ROUTES.find((r) => has(done, routeKey(r.id)))?.id || null;
}
/** Изменения отметок для выбора пути: выбранный включается, остальные снимаются. Повторный выбор того же — снять. */
export function routeChanges(done: Marks, id: RouteId | null): Record<string, boolean> {
  const cur = routeOf(done);
  const next = id && id !== cur ? id : null;
  const ch: Record<string, boolean> = {};
  for (const r of ROUTES) ch[routeKey(r.id)] = r.id === next;
  return ch;
}
export const chaptersDone = (done: Marks) => STORY_CHAPTERS.filter((c) => has(done, chapterKey(c.slug))).length;

// ---------- «Где я сейчас» ----------
// Главы игра не пишет ни в логи, ни в tarkov.dev — игрок отмечает их сам.
// Сюжет: линейная часть (Tour → Falling Skies → The Ticket), после неё главы идут параллельно.
// Текущая глава — первая неотмеченная.

/** Значение «весь сюжет пройден» в выборе текущей главы */
export const ALL_CHAPTERS_DONE = 'all';
/** Последняя глава линейной части; после неё главы идут параллельно */
export const LAST_LINEAR_CHAPTER = 'the-ticket';

/** Сколько глав в начале STORY_CHAPTERS идут строго по порядку (до The Ticket включительно) */
export function linearChapterCount(): number {
  const i = STORY_CHAPTERS.findIndex((c) => c.slug === LAST_LINEAR_CHAPTER);
  return i < 0 ? CHAPTERS_BEFORE.length : i + 1;
}

/** Индекс текущей главы в STORY_CHAPTERS — первой неотмеченной; STORY_CHAPTERS.length, если отмечены все */
export function currentChapterIndex(done: Marks): number {
  const i = STORY_CHAPTERS.findIndex((c) => !has(done, chapterKey(c.slug)));
  return i < 0 ? STORY_CHAPTERS.length : i;
}

/** slug текущей главы или ALL_CHAPTERS_DONE */
export function currentChapter(done: Marks): string {
  return STORY_CHAPTERS[currentChapterIndex(done)]?.slug ?? ALL_CHAPTERS_DONE;
}

/**
 * Изменения отметок для выбора «Где я сейчас»:
 * - глава линейной части — главы до неё пройдены, она и все следующие (включая параллельные) — нет:
 *   кто ещё не прошёл The Ticket, поздних глав пройти не мог;
 * - параллельная глава (после The Ticket) — вся линейная часть пройдена, выбранная — нет,
 *   остальные параллельные главы не трогаем (они идут независимо, а снятие в аккаунте видят друзья);
 * - ALL_CHAPTERS_DONE — отметить все. Неизвестный slug — без изменений.
 */
export function chapterChanges(slug: string): Record<string, boolean> {
  const n = slug === ALL_CHAPTERS_DONE ? STORY_CHAPTERS.length : STORY_CHAPTERS.findIndex((c) => c.slug === slug);
  if (n < 0) return {};
  const lin = linearChapterCount();
  const ch: Record<string, boolean> = {};
  if (n === STORY_CHAPTERS.length || n < lin) {
    STORY_CHAPTERS.forEach((c, i) => { ch[chapterKey(c.slug)] = i < n; });
  } else {
    STORY_CHAPTERS.slice(0, lin).forEach((c) => { ch[chapterKey(c.slug)] = true; });
    ch[chapterKey(slug)] = false;
  }
  return ch;
}

/**
 * Отметки противоречат порядку: линейная часть пройдена не вся, а дальше есть отмеченные главы.
 * Пропуски среди параллельных глав — норма, это не «нарушение».
 */
export function chaptersOutOfOrder(done: Marks): boolean {
  const cur = currentChapterIndex(done);
  if (cur >= linearChapterCount()) return false;
  return STORY_CHAPTERS.slice(cur + 1).some((c) => has(done, chapterKey(c.slug)));
}

/**
 * Исправить chaptersOutOfOrder, ничего не снимая: отметить пропущенные главы линейной части,
 * которые точно пройдены, раз отмечена более поздняя глава. Нечего исправлять — {}.
 */
export function fillChapterGaps(done: Marks): Record<string, boolean> {
  let last = -1;
  STORY_CHAPTERS.forEach((c, i) => { if (has(done, chapterKey(c.slug))) last = i; });
  // параллельная отмечена — пройдена вся линейная часть; нет отметок (last = -1) — нечего исправлять
  const upTo = Math.max(0, Math.min(last, linearChapterCount()));
  const ch: Record<string, boolean> = {};
  STORY_CHAPTERS.slice(0, upTo).forEach((c) => { if (!has(done, chapterKey(c.slug))) ch[chapterKey(c.slug)] = true; });
  return ch;
}

/** Подпись для таблицы команды и сводки: «на главе Falling Skies», «сюжет пройден», «не отмечено» */
export function chapterStatusText(done: Marks): string {
  if (!chaptersDone(done)) return 'не отмечено';
  const c = STORY_CHAPTERS[currentChapterIndex(done)];
  return c ? `на главе ${c.name}` : 'сюжет пройден';
}
/** Есть ли у игрока хоть одна отметка вкладки «Терминал» */
export function hasTerminalProgress(done: Marks): boolean {
  const keys = done instanceof Set ? [...done] : Object.keys(done).filter((k) => done[k]);
  return keys.some((k) => k.startsWith('t:'));
}

/** Главы, которые нужно пройти до The Ticket; сама The Ticket и ведёт на Терминал. Одно правило для шагов, команды и текстов. */
export const CHAPTERS_BEFORE = ['tour', 'falling-skies'];

export type Step = { key: string; label: string; done: boolean };

/** Шаги «до Терминала» по порядку. Шаги убежища, нужные только на определённых путях, добавляются после выбора пути. */
export function personalSteps(done: Marks, stations?: Record<string, TStation>): Step[] {
  const route = routeOf(done);
  const steps: Step[] = [];
  for (const slug of CHAPTERS_BEFORE) {
    const c = STORY_CHAPTERS.find((x) => x.slug === slug);
    steps.push({ key: chapterKey(slug), label: `Пройти главу «${c?.name || slug}»`, done: has(done, chapterKey(slug)) });
  }
  for (const r of HIDEOUT_REQS) {
    if (r.key === 'bench1') continue; // верстак — для сюжетного крафта по гайдам, в счёт шагов не входит
    if (r.routes && (!route || !r.routes.includes(route))) continue;
    const s = stationOrFallback(stations, r.station);
    steps.push({ key: 'hideout:' + r.key, label: `Построить: ${s.name} ${r.level}`, done: builtLevel(s, done) >= r.level });
  }
  steps.push({ key: 't:route', label: 'Выбрать путь в главе The Ticket', done: !!route });
  steps.push({ key: PASS_KEY, label: 'Получить пропуск на Терминал', done: has(done, PASS_KEY) });
  return steps;
}

export function summarize(steps: Step[]) {
  return { done: steps.filter((s) => s.done).length, total: steps.length, next: steps.find((s) => !s.done) || null };
}

// ---------- команда ----------
/** Нужен ли пропуск каждому игроку группы или хватит одного — не подтверждено, выбирает игрок */
export type PassRule = 'each' | 'one';

export type Member = { userId?: string; name: string; me?: boolean; done: Marks };
export type MemberStatus = {
  userId?: string; name: string; me: boolean;
  chapters: number; chaptersBefore: boolean; pass: boolean; route: RouteId | null;
  /** Чего не хватает этому игроку (с учётом правила пропуска) */
  missing: string[];
};
export type TeamStatus = { members: MemberStatus[]; ready: boolean; waiting: string[]; passHolders: number };

/**
 * Готовность команды. Каждому нужны главы до The Ticket и выбранный путь.
 * Пропуск: при «each» — у каждого, при «one» — хотя бы у одного в группе.
 */
export function teamReadiness(team: Member[], rule: PassRule): TeamStatus {
  const members: MemberStatus[] = team.map((t) => {
    const chaptersBefore = CHAPTERS_BEFORE.every((s) => has(t.done, chapterKey(s)));
    const pass = has(t.done, PASS_KEY);
    const route = routeOf(t.done);
    const missing: string[] = [];
    if (!chaptersBefore) missing.push(`главы ${chaptersBeforeText()}`);
    if (!route) missing.push('путь');
    if (rule === 'each' && !pass) missing.push('пропуск');
    return { userId: t.userId, name: t.name, me: !!t.me, chapters: chaptersDone(t.done), chaptersBefore, pass, route, missing };
  });
  const passHolders = members.filter((m) => m.pass).length;
  const waiting = members.filter((m) => m.missing.length).map((m) => `${m.me ? 'я' : m.name} (${m.missing.join(', ')})`);
  if (rule === 'one' && members.length && !passHolders) waiting.push('пропуск хотя бы у одного');
  return { members, ready: members.length > 0 && waiting.length === 0, waiting, passHolders };
}

/** Подпись к требованию глав: «Tour, Falling Skies» */
export const chaptersBeforeText = () => CHAPTERS_BEFORE.map((s) => STORY_CHAPTERS.find((c) => c.slug === s)?.name || s).join(', ');

// ---------- группа ----------
/**
 * Кто идёт в рейд группой. stored — сохранённый выбор (id игроков) или null, если игрок ещё ничего не менял.
 * По умолчанию: я и все, у кого есть хоть одна отметка «t:».
 */
export function groupIds(team: Member[], stored: string[] | null): Set<string> {
  const idOf = (t: Member) => t.userId || t.name;
  if (stored) {
    const s = new Set(stored);
    // Себя из группы не теряем, даже если выбор сохранён на другом аккаунте
    for (const t of team) if (t.me) s.add(idOf(t));
    return s;
  }
  return new Set(team.filter((t) => t.me || hasTerminalProgress(t.done)).map(idOf));
}
export const inGroup = (team: Member[], ids: Set<string>) => team.filter((t) => ids.has(t.userId || t.name));

/** Длительность крафта: «5,5 ч» */
export function hoursText(sec: number): string {
  const h = sec / 3600;
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(h)} ч`;
}
