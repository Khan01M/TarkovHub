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
const raw = new Map<string, Promise<any>>();

function getJson(path: string): Promise<any> {
  if (!raw.has(path)) {
    const p = fetch(BASE + path, { headers: { Accept: 'application/json' } }).then((r) => {
      if (!r.ok) throw new Error(`Сервер ответил ${r.status}`);
      return r.json();
    });
    p.catch(() => raw.delete(path)); // при ошибке разрешаем повторить запрос
    raw.set(path, p);
  }
  return raw.get(path)!;
}

async function dataset(name: string): Promise<{ data: any; ru: Dict }> {
  const mode = getGameMode();
  const [main, ru] = await Promise.all([getJson(`${mode}/${name}`), getJson(`${mode}/${name}_ru`).catch(() => ({ data: {} }))]);
  return { data: main?.data ?? {}, ru: ru?.data ?? {} };
}

const tr = (ru: Dict, key?: string | null) => (key == null ? '' : ru[key] ?? key);

// В русском переводе tarkov.dev нет некоторых имён — подставляем свои
const MOB_RU: Record<string, string> = {
  bossKnight: 'Рыцарь', followerBigPipe: 'Большая Труба', followerBirdEye: 'Птичий Глаз',
  bossTagillaAgro: 'Тень Тагиллы', bossKillaAgro: 'Мстительный Килла', infectedScreamer: 'Заражённый крикун',
  bossWedge: 'Клин', bossWedgeLab: 'Клин (Лаборатория)',
};

// ---------- кэш готовых результатов ----------
function cacheGet(key: string, allowStale = false) {
  try {
    const s = localStorage.getItem(key);
    if (!s) return null;
    const { t, data } = JSON.parse(s);
    if (allowStale || Date.now() - t < TTL_MS) return data;
  } catch { /* ignore */ }
  return null;
}
function cacheSet(key: string, data: unknown) {
  try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), data })); } catch { /* квота — не страшно */ }
}

const done = new Map<string, Promise<any>>();

/** Загружает данные через loader с кэшем. Без сети отдаёт последний сохранённый результат. */
export function load<T>(name: string, loader: () => Promise<T>): Promise<T> {
  const key = `data:v3:${name}:${getGameMode()}`;
  if (done.has(key)) return done.get(key)!;
  const fresh = cacheGet(key);
  if (fresh) return Promise.resolve(fresh);
  const p = loader()
    .then((d) => { cacheSet(key, d); return d; })
    .catch((e) => {
      done.delete(key);
      const stale = cacheGet(key, true);
      if (stale) return stale;
      throw e;
    });
  done.set(key, p);
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
  gun?: { caliber: string; fireRate: number; ergonomics: number; recoilVertical: number; recoilHorizontal: number; defaultAmmo?: string };
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
export type Boss = { normalizedName: string; name: string; imagePortraitLink?: string; health: { id: string; max: number }[] };

// Служебные и обучающие карты не показываем
const HIDDEN_MAPS = new Set(['ground-zero-tutorial']);

export const loadMaps = () => load<{ maps: MapInfo[]; bosses: Boss[] }>('maps', async () => {
  const { data, ru } = await dataset('maps');
  const mobs: Record<string, any> = data.mobs || {};
  const mobName = (id: string) => {
    const t = tr(ru, mobs[id]?.name ?? id);
    return t === (mobs[id]?.name ?? id) && MOB_RU[id] ? MOB_RU[id] : t;
  };
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
      byName.set(mob.normalizedName, { normalizedName: mob.normalizedName, name: mobName(id), imagePortraitLink: mob.imagePortraitLink, health });
    }
  }
  return { maps, bosses: [...byName.values()] };
});

// ---------- квесты ----------
export type Task = {
  id: string; name: string; minPlayerLevel: number; kappaRequired: boolean; experience?: number; wikiLink?: string;
  trader: string; map: string | null; objectives: { description: string; optional: boolean }[]; requires: string[];
  /** Уровень лояльности у своего торговца, с которого квест становится доступен */
  loyalty: number;
  /** Прочие требования к торговцам: «Лыжник ЛЛ2», «репутация у Лыжника ≥ 0,2» */
  traderReqs: string[];
};

export const loadTasks = () => load<{ tasks: Task[]; traders: TraderInfo[] }>('tasks', async () => {
  const mode = getGameMode();
  const [{ data, ru }, info, mapsRu] = await Promise.all([
    dataset('tasks'), traderInfo(), getJson(`${mode}/maps_ru`).then((d) => d?.data ?? {}).catch(() => ({})),
  ]);
  const traders: Record<string, string> = Object.fromEntries(Object.entries(info).map(([id, t]) => [id, t.name]));
  const fmt = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(n);
  const all: Record<string, any> = data.tasks || {};
  const tasks: Task[] = Object.values<any>(all).map((t) => ({
    id: t.id, name: tr(ru, t.name), minPlayerLevel: t.minPlayerLevel || 1, kappaRequired: !!t.kappaRequired,
    experience: t.experience, wikiLink: t.wikiLink, trader: traders[t.trader] || '',
    map: t.map ? (mapsRu[`${t.map} Name`] ?? null) : null,
    objectives: (t.objectives || []).map((o: any) => ({ description: tr(ru, o.description), optional: !!o.optional })),
    requires: (t.taskRequirements || []).map((r: any) => (all[r.task] ? tr(ru, all[r.task].name) : '')).filter(Boolean),
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

// ---------- форматирование ----------
export const rub = (n?: number | null) =>
  n == null || n === 0 ? '—' : new Intl.NumberFormat('ru-RU').format(Math.round(n)) + ' ₽';

export const num = (n?: number | null, d = 0) =>
  n == null ? '—' : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: d }).format(n);
