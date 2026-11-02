// Данные для «Обзора»: подробности квестов (точки на картах, ключи, маркеры, закладки),
// сборки «Оружейника» и отчёты о Гонщиках (группа Рыцаря). Всё считается из json.tarkov.dev.
import { load, datasetRaw, getGameMode } from './api';

export type Point = { x: number; z: number };
export type ItemRef = { id: string; name: string; shortName: string; icon?: string; price?: number; sellers: string[] };
export type Objective = {
  id: string; type: string; description: string; optional: boolean; count?: number;
  maps: string[];                 // id карт
  points: { map: string; pos: Point }[];
  keys: string[][];               // варианты ключей (любой из вложенного списка)
  marker?: string;                // MS2000 / глушилка и т.п.
  plant: string[];                // что нужно заложить
};
export type QuestTask = {
  id: string; name: string; trader: string; minPlayerLevel: number; loyalty: number;
  requires: { id: string; status: string[] }[]; objectives: Objective[]; map: string | null; wikiLink?: string;
};
export type BuildReq = { key: string; label: string; op: string; value: number; unit: string };
export type Gunsmith = {
  taskId: string; weapon: string; parts: string[];
  categories: { id: string; name: string; options: string[] }[]; // «любой модуль категории» и чем его закрыть
  reqs: BuildReq[];
};
export type QuestData = {
  tasks: QuestTask[]; items: Record<string, ItemRef>; mapNames: Record<string, string>;
  gunsmith: Gunsmith[]; goonReports: { map: string; time: number }[];
};

const ATTR: Record<string, [string, string]> = {
  ergonomics: ['Эргономика', ''], recoil: ['Сумма отдачи', ''], weight: ['Вес', ' кг'], durability: ['Прочность', '%'],
  effectiveDistance: ['Прицельная дальность', ' м'], magazineCapacity: ['Ёмкость магазина', ''], accuracy: ['Точность (MOA)', ''],
  muzzleVelocity: ['Начальная скорость', ' м/с'], width: ['Ширина', ' кл.'], height: ['Высота', ' кл.'],
};

export const loadQuestData = () => load<QuestData>('questdata', async () => {
  const mode = getGameMode();
  const [tasksD, itemsD, tradersD, mapsD] = await Promise.all([
    datasetRaw('tasks'), datasetRaw('items'), datasetRaw('traders'), datasetRaw('maps'),
  ]);
  const tr = (ru: Record<string, string>, k?: string) => (k == null ? '' : ru[k] ?? k);
  const allItems: Record<string, any> = itemsD.data.items || {};
  const traderName: Record<string, string> = {};
  for (const t of Object.values<any>(tradersD.data)) traderName[t.id] = tr(tradersD.ru, t.name);
  const mapNames: Record<string, string> = {};
  for (const m of Object.values<any>(mapsD.data.maps || {})) mapNames[m.id] = tr(mapsD.ru, m.name);
  const questItems: Record<string, any> = tasksD.data.questItems || {};

  // Справочник предметов, которые реально упоминаются — только их и сохраняем
  const items: Record<string, ItemRef> = {};
  const ref = (id: string) => {
    if (!id || items[id]) return id;
    const it = allItems[id];
    if (it) {
      const flea = !(it.types || []).includes('noFlea') ? (it.avg24hPrice || it.lastLowPrice) : undefined;
      const sellers = (it.buyFromTrader || []).slice().sort((a: any, b: any) => a.priceRUB - b.priceRUB)
        .map((o: any) => `${traderName[o.trader] || '?'} ЛЛ${o.minTraderLevel || 1}: ${new Intl.NumberFormat('ru-RU').format(o.priceRUB)} ₽${o.taskUnlock ? ' (после квеста)' : ''}`);
      const cheapestTrader = Math.min(...(it.buyFromTrader || []).map((o: any) => o.priceRUB), Infinity);
      items[id] = {
        id, name: tr(itemsD.ru, it.name), shortName: tr(itemsD.ru, it.shortName), icon: it.iconLink,
        price: flea || (isFinite(cheapestTrader) ? cheapestTrader : undefined), sellers,
      };
    } else if (questItems[id]) {
      const q = questItems[id];
      items[id] = { id, name: tr(tasksD.ru, q.name), shortName: tr(tasksD.ru, q.shortName), icon: q.iconLink, sellers: [] };
    } else {
      items[id] = { id, name: id, shortName: id, sellers: [] };
    }
    return id;
  };

  const tasks: QuestTask[] = [];
  const gunsmith: Gunsmith[] = [];
  for (const t of Object.values<any>(tasksD.data.tasks || {})) {
    const objectives: Objective[] = (t.objectives || []).map((o: any) => {
      const points: { map: string; pos: Point }[] = [];
      for (const z of o.zones || []) if (z.position && z.map) points.push({ map: z.map, pos: { x: z.position.x, z: z.position.z } });
      for (const l of o.possibleLocations || []) for (const p of l.positions || []) points.push({ map: l.map, pos: { x: p.x, z: p.z } });
      // повторяющиеся точки убираем
      const seen = new Set<string>();
      const uniq = points.filter((p) => { const k = `${p.map}:${Math.round(p.pos.x)}:${Math.round(p.pos.z)}`; if (seen.has(k)) return false; seen.add(k); return true; });
      const keys = (o.requiredKeys || []).map((alts: string[]) => alts.map(ref));
      const plant = o.type === 'plantItem' ? (o.items || []).map(ref) : o.type === 'plantQuestItem' && o.questItem ? [ref(o.questItem)] : [];
      return {
        id: o.id, type: o.type, description: tr(tasksD.ru, o.description), optional: !!o.optional, count: o.count,
        maps: o.maps || [], points: uniq, keys, marker: o.markerItem ? ref(o.markerItem) : undefined, plant,
      };
    });
    const loyalty = Math.max(1, ...(t.traderRequirements || []).filter((r: any) => r.requirementType === 'level' && r.trader === t.trader).map((r: any) => Number(r.value) || 1));
    tasks.push({
      id: t.id, name: tr(tasksD.ru, t.name), trader: traderName[t.trader] || '', minPlayerLevel: t.minPlayerLevel || 1, loyalty,
      requires: (t.taskRequirements || []).map((r: any) => ({ id: r.task, status: r.status || ['complete'] })),
      objectives, map: t.map || null, wikiLink: t.wikiLink,
    });

    for (const o of t.objectives || []) {
      if (o.type !== 'buildWeapon' || !o.item) continue;
      const compatible = compatibleWith(o.item, allItems);
      gunsmith.push({
        taskId: t.id, weapon: ref(o.item), parts: (o.containsAll || []).map(ref),
        categories: (o.containsCategory || []).map((cid: string) => {
          const cat = itemsD.data.itemCategories?.[cid];
          const options = [...compatible].filter((id) => (allItems[id]?.categories || []).includes(cid) && !(allItems[id]?.types || []).includes('preset'))
            .map((id) => ({ id, p: allItems[id]?.avg24hPrice || allItems[id]?.lastLowPrice || Math.min(...(allItems[id]?.buyFromTrader || []).map((x: any) => x.priceRUB), 9e9) }))
            .sort((a, b) => a.p - b.p).slice(0, 6).map((x) => ref(x.id));
          return { id: cid, name: tr(itemsD.ru, cat?.name) || cid, options };
        }),
        reqs: Object.entries(o.buildAttributes || {})
          .filter(([k, v]: any) => v && v.value && ATTR[k])
          .map(([k, v]: any) => ({ key: k, label: ATTR[k][0], op: v.compareMethod, value: v.value, unit: ATTR[k][1] })),
      });
    }
  }

  const goonReports = (mapsD.data.goonReports || [])
    .map((r: any) => ({ map: mapNames[r.map] || r.map, time: Number(r.timestamp) }))
    .filter((r: any) => r.time > 0).sort((a: any, b: any) => b.time - a.time).slice(0, 15);

  void mode;
  return { tasks, items, mapNames, gunsmith, goonReports };
});

/** Все модули, которые можно поставить на оружие (обход дерева слотов) */
function compatibleWith(weaponId: string, all: Record<string, any>): Set<string> {
  const out = new Set<string>();
  const queue = [weaponId];
  const visited = new Set<string>();
  const byCategory = (cid: string) => Object.values<any>(all).filter((x) => (x.categories || []).includes(cid)).map((x) => x.id);
  const catCache = new Map<string, string[]>();
  while (queue.length && visited.size < 3000) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const slot of all[id]?.properties?.slots || []) {
      const f = slot.filters || {};
      const allowed = new Set<string>(f.allowedItems || []);
      for (const cid of f.allowedCategories || []) {
        if (!catCache.has(cid)) catCache.set(cid, byCategory(cid));
        catCache.get(cid)!.forEach((x) => allowed.add(x));
      }
      for (const ex of f.excludedItems || []) allowed.delete(ex);
      for (const x of allowed) {
        if ((all[x]?.categories || []).some((c: string) => (f.excludedCategories || []).includes(c))) continue;
        if (!out.has(x)) { out.add(x); queue.push(x); }
      }
    }
  }
  return out;
}

/** Текущие задания: не выполнены, предыдущие выполнены, уровень подходит */
export function currentTasks(data: QuestData, done: Record<string, boolean>, level: number) {
  return data.tasks.filter((t) => !done[t.id]
    && t.minPlayerLevel <= level
    && t.requires.every((r) => done[r.id] || !r.status.includes('complete')));
}
