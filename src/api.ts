// Данные берутся из статического JSON API tarkov.dev (https://json.tarkov.dev).
// GraphQL API (api.tarkov.dev) не работает с июля 2026 года, а сам tarkov.dev живёт на JSON API.
//
// Формат: GET /<режим>/<набор> → { data, translations }. Текстовые поля в data содержат
// ключи перевода (например "5447a9cd4bdc2dbd208b4567 Name"), а сами строки лежат в
// /<режим>/<набор>_ru → { data: { ключ: "текст" } }.
//
// Здесь наборы загружаются и сразу превращаются в компактные объекты, которые нужны страницам.
// Готовый результат кэшируется в памяти (на время работы) и в localStorage (для работы без сети).

const BASE = 'https://json.tarkov.dev/';
const TTL_MS = 15 * 60 * 1000;

export type GameMode = 'regular' | 'pve';

export function getGameMode(): GameMode {
  try { return localStorage.getItem('gameMode') === 'pve' ? 'pve' : 'regular'; } catch { return 'regular'; }
}
export function setGameMode(m: GameMode) {
  try { localStorage.setItem('gameMode', m); } catch { /* ignore */ }
}

type Dict = Record<string, string>;

// ---------- загрузка исходных наборов ----------
// tarkov.dev отдаёт Cache-Control: max-age=691200 (8 суток). Без cache: 'no-cache' браузер
// неделю отдаёт ответ с диска, поэтому спрашиваем сервер каждый раз (по ETag придёт 304).
// Нет сети или таймаут — берём копию из HTTP-кэша браузера (force-cache).
const FETCH_TIMEOUT_MS = 20 * 1000; // items весит ~1.8 МБ сжатым — на медленной сети нужен запас
const FALLBACK_TIMEOUT_MS = 10 * 1000;

async function fetchJson(url: string, cache: RequestCache, timeout: number): Promise<any> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' }, cache, signal: ctl.signal });
    if (!r.ok) throw new Error(`Сервер ответил ${r.status}`);
    return await r.json(); // таймаут действует и на чтение тела
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error('Сервер не ответил вовремя');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// Сырые ответы держим в памяти не дольше TTL_MS, иначе повторная загрузка взяла бы старый ответ
const raw = new Map<string, { t: number; p: Promise<any> }>();

function getJson(path: string): Promise<any> {
  const hit = raw.get(path);
  if (hit && Date.now() - hit.t < TTL_MS) return hit.p;
  const url = BASE + path;
  const p = fetchJson(url, 'no-cache', FETCH_TIMEOUT_MS)
    .catch(() => fetchJson(url, 'force-cache', FALLBACK_TIMEOUT_MS)); // одна попытка: офлайн-копия
  const entry = { t: Date.now(), p };
  p.catch(() => { if (raw.get(path) === entry) raw.delete(path); }); // при ошибке разрешаем повторить запрос
  raw.set(path, entry);
  return p;
}

// Счётчик неудачных загрузок перевода: load() по нему понимает, что результат без русских названий
let ruFails = 0;
function getRu(path: string): Promise<Dict> {
  return getJson(path).then((d) => d?.data ?? {}).catch(() => { ruFails++; return {}; });
}

// Минимальный правдоподобный размер ключевого набора (с запасом от реальных цифр на 11.2026:
// предметов ~5500, квестов ~500, карт 19, торговцев 16, станций убежища 26).
// Меньше — значит сменился формат или пришёл обрезанный ответ: бросаем ошибку, load() отдаст stale-копию.
const size = (x: any) => (x ? (Array.isArray(x) ? x.length : Object.keys(x).length) : 0);
const MIN_SIZE: Record<string, [(d: any) => number, number]> = {
  items: [(d) => size(d.items), 1000],
  tasks: [(d) => size(d.tasks), 100],
  maps: [(d) => size(d.maps), 5],
  traders: [(d) => size(d), 3],
  hideout: [(d) => size(d), 5],
};

const NO_RU = new Set(['crafts']);
async function dataset(name: string): Promise<{ data: any; ru: Dict }> {
  const mode = getGameMode();
  // У некоторых наборов перевода нет (crafts_ru отвечает 404) — не запрашиваем, чтобы не сыпать ошибками в консоль
  const [main, ru] = await Promise.all([getJson(`${mode}/${name}`), NO_RU.has(name) ? Promise.resolve({} as Dict) : getRu(`${mode}/${name}_ru`)]);
  const data = main?.data ?? {};
  const check = MIN_SIZE[name];
  if (check && check[0](data) <= check[1]) throw new Error(`Набор ${name} пустой или неполный — формат данных мог измениться`);
  return { data, ru };
}

/** Сырой набор данных с переводом — для своих расчётов */
export const datasetRaw = (name: string) => dataset(name);

const tr = (ru: Dict, key?: string | null) => (key == null ? '' : ru[key] ?? key);

// В русском переводе tarkov.dev нет некоторых имён — подставляем свои
const MOB_RU: Record<string, string> = {
  bossKnight: 'Рыцарь', followerBigPipe: 'Большая Труба', followerBirdEye: 'Птичий Глаз',
  bossTagillaAgro: 'Тень Тагиллы', bossKillaAgro: 'Мстительный Килла', infectedScreamer: 'Заражённый крикун',
  bossWedge: 'Клин', bossWedgeLab: 'Клин (Лаборатория)',
};

// ---------- кэш готовых результатов ----------
// Ключи: `${CACHE_PREFIX}<набор>:<режим>`. При смене формата результата поднимаем версию в префиксе.
const CACHE_PREFIX = 'data:v8:';

// Старые версии кэша (data:v2 … data:v7) никто не удаляет, а localStorage почти забит —
// чистим один раз при загрузке модуля. Трогаем только ключи data:*, пользовательские не трогаем.
try {
  const old: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('data:') && !k.startsWith(CACHE_PREFIX)) old.push(k);
  }
  old.forEach((k) => localStorage.removeItem(k));
} catch { /* ignore */ }

function cacheRead(key: string): { t: number; data: any } | null {
  try {
    const s = localStorage.getItem(key);
    if (!s) return null;
    const { t, data } = JSON.parse(s);
    return data ? { t: Number(t) || 0, data } : null;
  } catch { return null; }
}
function cacheGet(key: string, allowStale = false) {
  const c = cacheRead(key);
  return c && (allowStale || Date.now() - c.t < TTL_MS) ? c.data : null;
}
function cacheSet(key: string, data: unknown) {
  const s = JSON.stringify({ t: Date.now(), data });
  try { localStorage.setItem(key, s); return; } catch { /* скорее всего квота */ }
  // Квота: освобождаем место за счёт кэша данных другого режима и пробуем ещё раз
  try {
    const mode = key.slice(key.lastIndexOf(':') + 1);
    const other: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(CACHE_PREFIX) && !k.endsWith(`:${mode}`)) other.push(k);
    }
    other.forEach((k) => localStorage.removeItem(k));
    localStorage.setItem(key, s);
  } catch { /* всё равно не влезло — не страшно, работаем из памяти */ }
}

// Результаты в памяти: t — когда получены; старше TTL_MS считаются протухшими
const done = new Map<string, { t: number; p: Promise<any> }>();

/** Загружает данные через loader с кэшем. Без сети отдаёт последний сохранённый результат. */
export function load<T>(name: string, loader: () => Promise<T>): Promise<T> {
  const key = `${CACHE_PREFIX}${name}:${getGameMode()}`;
  const hit = done.get(key);
  if (hit && Date.now() - hit.t < TTL_MS) return hit.p;
  const c = cacheRead(key);
  if (c && Date.now() - c.t < TTL_MS) {
    // свежая копия из localStorage — запоминаем, чтобы не парсить мегабайты JSON на каждом монтировании
    const p = Promise.resolve(c.data);
    done.set(key, { t: c.t, p });
    return p;
  }
  const forget = () => { if (done.get(key) === entry) done.delete(key); };
  const fails = ruFails;
  const p = loader()
    .then((d) => {
      if (ruFails !== fails) {
        // Перевод не загрузился: лучше старая полная копия; если её нет — отдаём как есть,
        // но не сохраняем и не запоминаем, чтобы следующий вызов попробовал снова
        forget();
        return cacheGet(key, true) ?? d;
      }
      cacheSet(key, d);
      return d;
    })
    .catch((e) => {
      forget();
      const stale = cacheGet(key, true);
      if (stale) return stale;
      throw e;
    });
  const entry = { t: Date.now(), p };
  done.set(key, entry);
  return p;
}

// ---------- торговцы ----------
export type TraderInfo = { name: string; order: number; levels: { level: number; playerLevel: number; reputation: number }[] };

async function traderInfo(): Promise<Record<string, TraderInfo>> {
  const { data, ru } = await dataset('traders');
  const out: Record<string, TraderInfo> = {};
  Object.values<any>(data).forEach((t, i) => {
    out[t.id] = {
      name: tr(ru, t.name), order: i,
      levels: (t.levels || []).map((l: any) => ({ level: l.level, playerLevel: l.requiredPlayerLevel || 1, reputation: l.requiredReputation || 0 })),
    };
  });
  return out;
}

async function traderNames(): Promise<Record<string, string>> {
  const info = await traderInfo();
  return Object.fromEntries(Object.entries(info).map(([id, t]) => [id, t.name]));
}

// ---------- предметы ----------
export type Offer = { priceRUB: number; vendor: { name: string } };
export type Item = {
  id: string; name: string; shortName: string; iconLink?: string; wikiLink?: string; types: string[];
  width: number; height: number; avg24hPrice?: number; low24hPrice?: number; lastLowPrice?: number;
  changeLast48hPercent?: number; sellFor: Offer[]; buyFor: Offer[];
  gun?: { caliber: string; fireRate: number; ergonomics: number; recoilVertical: number; recoilHorizontal: number; defaultAmmo?: string; preset?: string };
  ammo?: { caliber: string; damage: number; penetrationPower: number; armorDamage: number; initialSpeed: number; projectileCount: number };
};

export const loadItems = () => load<{ items: Item[] }>('items', async () => {
  const [{ data, ru }, traders] = await Promise.all([dataset('items'), traderNames()]);
  const flea = tr(ru, data.fleaMarket?.name) || 'Барахолка';
  const fleaOn = data.fleaMarket?.enabled !== false;
  const all: Record<string, any> = data.items || {};
  const items: Item[] = [];
  for (const it of Object.values<any>(all)) {
    const types: string[] = it.types || [];
    const canFlea = fleaOn && !types.includes('noFlea');
    const sellFor: Offer[] = [];
    const buyFor: Offer[] = [];
    if (canFlea && it.lastLowPrice) sellFor.push({ priceRUB: it.lastLowPrice, vendor: { name: flea } });
    for (const o of it.sellToTrader || []) sellFor.push({ priceRUB: o.priceRUB, vendor: { name: traders[o.trader] || '?' } });
    const fleaBuy = it.avg24hPrice ?? it.lastLowPrice;
    if (canFlea && fleaBuy) buyFor.push({ priceRUB: fleaBuy, vendor: { name: flea } });
    for (const o of it.buyFromTrader || []) {
      buyFor.push({ priceRUB: o.priceRUB, vendor: { name: `${traders[o.trader] || '?'}${o.minTraderLevel ? ` (ур. ${o.minTraderLevel})` : ''}` } });
    }
    const p = it.properties || {};
    const item: Item = {
      id: it.id, name: tr(ru, it.name), shortName: tr(ru, it.shortName), iconLink: it.iconLink, wikiLink: it.wikiLink,
      types, width: it.width, height: it.height,
      avg24hPrice: canFlea ? it.avg24hPrice : undefined, low24hPrice: canFlea ? it.low24hPrice : undefined,
      lastLowPrice: canFlea ? it.lastLowPrice : undefined, changeLast48hPercent: canFlea ? it.changeLast48hPercent : undefined,
      sellFor, buyFor,
    };
    if (p.propertiesType === 'ItemPropertiesWeapon' && types.includes('gun') && !types.includes('preset')) {
      item.gun = {
        caliber: p.caliber, fireRate: p.fireRate, ergonomics: p.ergonomics,
        recoilVertical: p.recoilVertical, recoilHorizontal: p.recoilHorizontal,
        defaultAmmo: p.defaultAmmo && all[p.defaultAmmo] ? tr(ru, all[p.defaultAmmo].name) : undefined,
        preset: p.defaultPreset && all[p.defaultPreset] ? p.defaultPreset : undefined,
      };
    }
    if (p.propertiesType === 'ItemPropertiesAmmo' && types.includes('ammo')) {
      item.ammo = {
        caliber: p.caliber, damage: p.damage, penetrationPower: p.penetrationPower, armorDamage: p.armorDamage,
        initialSpeed: p.initialSpeed, projectileCount: p.projectileCount || 1,
      };
    }
    items.push(item);
  }
  return { items };
});

// ---------- карты и боссы ----------
export type MapInfo = {
  id: string; name: string; normalizedName: string; nameId: string; description: string;
  raidDuration?: number; players?: string; wiki?: string;
  bosses: { mob: string; name: string; normalizedName: string; spawnChance: number; spawnLocations: { name: string; chance: number }[]; escorts: { name: string; count: number }[] }[];
  extracts: { name: string; faction: string; position?: { x: number; y: number; z: number } }[];
  spawns: { position: { x: number; y: number; z: number }; sides: string[] }[];
};
export type GearSlot = 'FirstPrimaryWeapon' | 'SecondPrimaryWeapon' | 'Holster' | 'Scabbard' | 'Headwear' | 'FaceCover' | 'Earpiece' | 'Eyewear' | 'ArmorVest' | 'TacticalVest' | 'Backpack';
export const GEAR_SLOTS: GearSlot[] = ['FirstPrimaryWeapon', 'SecondPrimaryWeapon', 'Holster', 'Scabbard', 'Headwear', 'FaceCover', 'Earpiece', 'Eyewear', 'ArmorVest', 'TacticalVest', 'Backpack'];
/** Снаряжение: для каждого слота — предметы и доля наборов, в которых они встречаются (0..1) */
export type Gear = { slot: GearSlot; items: { id: string; share: number }[] }[];
export type Boss = {
  normalizedName: string; name: string; imagePortraitLink?: string; imagePosterLink?: string;
  health: { id: string; max: number }[];
  gear: Gear;
  /** Лут в карманах и рюкзаке: id предмета и шанс в процентах */
  loot: { id: string; chance: number }[];
};

function summarizeGear(equipment: any[]): Gear {
  const bySlot: Record<string, Record<string, number>> = {};
  for (const e of equipment || []) {
    const slot = e?.attributes?.slot;
    if (!GEAR_SLOTS.includes(slot)) continue;
    (bySlot[slot] ||= {})[e.item] = (bySlot[slot][e.item] || 0) + 1;
  }
  // Число вариантов снаряжения — по самому заполненному «одиночному» слоту
  const samples = Math.max(1, ...['FirstPrimaryWeapon', 'Holster', 'TacticalVest', 'ArmorVest', 'Headwear']
    .map((sl) => Object.values(bySlot[sl] || {}).reduce((a, b) => a + b, 0)));
  return GEAR_SLOTS.filter((sl) => bySlot[sl]).map((slot) => ({
    slot,
    items: Object.entries(bySlot[slot]).map(([id, n]) => ({ id, share: Math.min(1, n / samples) }))
      .sort((a, b) => b.share - a.share).slice(0, 8),
  }));
}

// Служебные и обучающие карты не показываем
const HIDDEN_MAPS = new Set(['ground-zero-tutorial']);

export const loadMaps = () => load<{ maps: MapInfo[]; bosses: Boss[] }>('maps', async () => {
  const { data, ru } = await dataset('maps');
  const mobs: Record<string, any> = data.mobs || {};
  const mobName = (id: string) => MOB_RU[id] || tr(ru, mobs[id]?.name ?? id);
  const maps: MapInfo[] = Object.values<any>(data.maps || {})
    .filter((m) => !HIDDEN_MAPS.has(m.normalizedName))
    .map((m) => ({
      id: m.id, name: tr(ru, m.name), normalizedName: m.normalizedName, nameId: m.nameId,
      description: tr(ru, m.description), raidDuration: m.raidDuration, players: m.players, wiki: m.wiki,
      bosses: (m.bosses || []).map((b: any) => ({
        mob: b.mob, name: mobName(b.mob), normalizedName: mobs[b.mob]?.normalizedName || b.mob,
        spawnChance: b.spawnChance || 0,
        spawnLocations: (b.spawnLocations || []).map((l: any) => ({ name: tr(ru, l.name), chance: l.chance || 0 })),
        escorts: (b.escorts || []).map((e: any) => ({ name: mobName(e.mob), count: Math.max(0, ...(e.amount || []).map((a: any) => a.count || 0)) })),
      })),
      extracts: (m.extracts || []).map((e: any) => ({ name: tr(ru, e.name), faction: e.faction, position: e.position })),
      spawns: (m.spawns || []).filter((s: any) => s.position && (s.categories || []).includes('player'))
        .map((s: any) => ({ position: s.position, sides: s.sides || [] })),
    }));
  // Боссы — мобы, которые где-то появляются как основной босс (не охрана)
  const used = new Set(maps.flatMap((m) => m.bosses.map((b) => b.mob)));
  const byName = new Map<string, Boss>();
  for (const id of used) {
    const mob = mobs[id];
    if (!mob) continue;
    const prev = byName.get(mob.normalizedName);
    const health = (mob.health || []).map((h: any) => ({ id: h.id, max: h.max }));
    if (!prev || (!prev.health.length && health.length)) {
      byName.set(mob.normalizedName, {
        normalizedName: mob.normalizedName, name: mobName(id), imagePortraitLink: mob.imagePortraitLink, imagePosterLink: mob.imagePosterLink,
        health, gear: summarizeGear(mob.equipment),
        loot: (mob.items || []).map((x: any) => ({ id: x.id, chance: x.attributes?.prevalence || 0 }))
          .filter((x: any) => x.chance > 0).sort((a: any, b: any) => b.chance - a.chance).slice(0, 24),
      });
    }
  }
  return { maps, bosses: [...byName.values()] };
});

// ---------- квесты ----------
/** give — что сдать: любой из items, count штук; fir — только найденное в рейде */
export type TaskObjective = { id: string; description: string; optional: boolean; give?: { items: string[]; count: number; fir: boolean } };
export type Task = {
  id: string; name: string; minPlayerLevel: number; kappaRequired: boolean; experience?: number; wikiLink?: string;
  trader: string; map: string | null; objectives: TaskObjective[]; requires: string[];
  /** Предыдущие квесты: id и нужный статус (complete — выполнен, active — взят, failed — провален) */
  reqs: { id: string; status: string[] }[];
  /** С 1.1.0 квесты открываются пачками: счётчик ветки торговца (id) и нужное значение */
  gate?: { v: string; n: number };
  /** Только для BEAR или USEC; для всех — не задано */
  faction?: 'BEAR' | 'USEC';
  /** Квест только при отрицательной репутации (ветка «Возмещение ущерба» у Скупщика) */
  badRep?: boolean;
  /** Квест, который открывает этого торговца (Егерь — «Поручение»), если торговец закрыт с начала */
  traderUnlock?: string;
  /** Уровень лояльности у своего торговца, с которого квест становится доступен */
  loyalty: number;
  /** Прочие требования к торговцам: «Лыжник ЛЛ2», «репутация у Лыжника ≥ 0,2» */
  traderReqs: string[];
};

export const loadTasks = () => load<{ tasks: Task[]; traders: TraderInfo[] }>('tasks', async () => {
  const mode = getGameMode();
  const [{ data, ru }, info, mapsRu] = await Promise.all([
    dataset('tasks'), traderInfo(), getRu(`${mode}/maps_ru`),
  ]);
  const traders: Record<string, string> = Object.fromEntries(Object.entries(info).map(([id, t]) => [id, t.name]));
  const fmt = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(n);
  const all: Record<string, any> = data.tasks || {};
  // Каких торговцев открывает какой квест (например, Егеря — «Поручение» у Механика)
  const unlockBy: Record<string, string> = {};
  for (const t of Object.values<any>(all)) {
    for (const u of [...(t.finishRewards?.traderUnlock || []), ...(t.startRewards?.traderUnlock || [])]) {
      const id = typeof u === 'string' ? u : u?.id || u?.trader;
      if (id && !unlockBy[id]) unlockBy[id] = t.id;
    }
  }
  const tasks: Task[] = Object.values<any>(all).map((t) => ({
    id: t.id, name: tr(ru, t.name), minPlayerLevel: t.minPlayerLevel || 1, kappaRequired: !!t.kappaRequired,
    experience: t.experience, wikiLink: t.wikiLink, trader: traders[t.trader] || '',
    map: t.map ? (mapsRu[`${t.map} Name`] ?? null) : null,
    objectives: (t.objectives || []).map((o: any): TaskObjective => ({
      id: o.id, description: tr(ru, o.description), optional: !!o.optional,
      give: o.type === 'giveItem' && (o.items || []).length && o.count > 0
        ? { items: o.items.slice(0, 60), count: o.count, fir: !!o.foundInRaid } : undefined,
    })),
    requires: (t.taskRequirements || []).map((r: any) => (all[r.task] ? tr(ru, all[r.task].name) : '')).filter(Boolean),
    reqs: (t.taskRequirements || []).filter((r: any) => all[r.task]).map((r: any) => ({ id: r.task, status: r.status || ['complete'] })),
    gate: ((g) => (g ? { v: g.variableId, n: Number(g.value) || 0 } : undefined))((t.otherRequirements || []).find((o: any) => o.type === 'globalVariable' && o.compareMethod === '>=')),
    traderUnlock: unlockBy[t.trader] && unlockBy[t.trader] !== t.id ? unlockBy[t.trader] : undefined,
    badRep: (t.traderRequirements || []).some((r: any) => r.requirementType === 'reputation' && (r.compareMethod === '<' || r.compareMethod === '<=') && Number(r.value) < 0),
    faction: t.factionName === 'BEAR' || t.factionName === 'USEC' ? t.factionName : undefined,
    loyalty: Math.max(1, ...(t.traderRequirements || [])
      .filter((r: any) => r.requirementType === 'level' && r.trader === t.trader).map((r: any) => Number(r.value) || 1)),
    traderReqs: (t.traderRequirements || [])
      .filter((r: any) => !(r.requirementType === 'level' && r.trader === t.trader))
      .map((r: any) => {
        const name = traders[r.trader] || '?';
        if (r.requirementType === 'level') return `${name}: ЛЛ${r.value}`;
        if (r.requirementType === 'reputation') return `репутация у торговца ${name} ${r.compareMethod} ${fmt(Number(r.value))}`;
        return '';
      }).filter(Boolean),
  }));
  const traderList = Object.values(info).sort((a, b) => a.order - b.order);
  return { tasks, traders: traderList };
});

// ---------- убежище ----------
export type HideoutLevel = {
  id: string; level: number; time: number;
  items: { id: string; count: number; fir: boolean }[];
  stations: { id: string; level: number }[];
  traders: { name: string; level: number }[];
  skills: { name: string; level: number }[];
};
export type Station = { id: string; name: string; image?: string; levels: HideoutLevel[] };

export const loadHideout = () => load<{ stations: Station[] }>('hideout', async () => {
  const [{ data, ru }, info] = await Promise.all([dataset('hideout'), traderInfo()]);
  const list: any[] = Array.isArray(data) ? data : Object.values(data || {});
  const stations: Station[] = list.map((s) => ({
    id: s.id, name: tr(ru, s.name), image: s.imageLink,
    levels: (s.levels || []).map((l: any) => ({
      id: l.id, level: l.level, time: l.constructionTime || 0,
      items: (l.itemRequirements || []).map((r: any) => ({ id: r.item, count: r.count, fir: !!r.attributes?.foundInRaid })),
      stations: (l.stationLevelRequirements || []).map((r: any) => ({ id: r.station, level: r.level })),
      traders: (l.traderRequirements || []).filter((r: any) => r.requirementType === 'level')
        .map((r: any) => ({ name: info[r.trader]?.name || '?', level: Number(r.value) || 1 })),
      skills: (l.skillRequirements || []).map((r: any) => ({ name: tr(ru, r.skill), level: r.level })),
    })).sort((a: HideoutLevel, b: HideoutLevel) => a.level - b.level),
  })).filter((s) => s.levels.length).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  return { stations };
});

// ---------- форматирование ----------
export const rub = (n?: number | null) =>
  n == null || n === 0 ? '—' : new Intl.NumberFormat('ru-RU').format(Math.round(n)) + ' ₽';

export const num = (n?: number | null, d = 0) =>
  n == null ? '—' : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: d }).format(n);
