// Какие квесты сейчас открыты у торговцев — как во вкладке «Задания» в игре.
// Квест открыт, если он не выполнен, уровень ЧВК не ниже нужного, лояльность у его торговца
// достаточная и выполнены предыдущие квесты (для «взять» достаточно, чтобы предыдущий был открыт).
//
// С патча 1.1.0 большинство побочных квестов открываются пачками внутри «ветки» торговца:
// выполнил несколько квестов текущей пачки — открылась следующая. Игра хранит это в счётчике,
// который в открытых данных не расписан, поэтому здесь он оценивается по числу выполненных
// квестов той же ветки (estimated = true).
import type { Task } from './api';

// active — квест взят (по логам игры), такой всегда считается открытым; «f:<id>» — провален
export type Avail = { state: 'done' | 'open' | 'locked'; why: string[]; estimated?: boolean; active?: boolean };

export function questAvailability(tasks: Task[], done: Record<string, boolean>, level: number, ll: (trader: string) => number) {
  const byId: Record<string, Task> = Object.fromEntries(tasks.map((t) => [t.id, t]));
  // Ветки: сколько квестов выполнено и с какого значения ветка начинается
  const branch: Record<string, { min: number; done: number }> = {};
  for (const t of tasks) {
    if (!t.gate) continue;
    const b = (branch[t.gate.v] ||= { min: Infinity, done: 0 });
    b.min = Math.min(b.min, t.gate.n);
    if (done[t.id]) b.done++;
  }
  const memo: Record<string, Avail> = {};
  const calc = (t: Task, stack: Set<string>): Avail => {
    if (memo[t.id]) return memo[t.id];
    if (done[t.id]) return (memo[t.id] = { state: 'done', why: [] });
    if (done['f:' + t.id]) return (memo[t.id] = { state: 'locked', why: ['квест провален'] });
    if (done['a:' + t.id]) return (memo[t.id] = { state: 'open', why: [], active: true });
    if (stack.has(t.id)) return { state: 'locked', why: [] }; // защита от циклов в данных
    stack.add(t.id);
    const why: string[] = [];
    if (level < t.minPlayerLevel) why.push(`нужен ${t.minPlayerLevel} ур. ЧВК`);
    if (ll(t.trader) < t.loyalty) why.push(`нужен ЛЛ${t.loyalty} у торговца ${t.trader}`);
    if (t.traderUnlock && !done[t.traderUnlock]) why.push(`торговец ${t.trader} ещё закрыт: сначала «${byId[t.traderUnlock]?.name || '?'}»`);
    if (t.badRep) why.push(`только при отрицательной репутации у торговца ${t.trader}`);
    for (const r of t.reqs) {
      const rt = byId[r.id];
      if (!rt) continue;
      // Выполненный квест закрывает требования «выполнить»/«взять», но не «провалить»:
      // при выполненном квесте ветка «провалить» в игре недоступна
      if (done[r.id] && (r.status.includes('complete') || r.status.includes('active'))) continue;
      // «Провалить квест»: требование выполнено, если стоит отметка провала (из логов)
      if (r.status.includes('failed') && done['f:' + r.id]) continue;
      if (r.status.includes('active') && calc(rt, stack).state === 'open') continue;
      why.push(r.status.length === 1 && r.status[0] === 'failed' ? `сначала провалить «${rt.name}»` : `сначала «${rt.name}»`);
    }
    let estimated = false;
    if (t.gate) {
      const b = branch[t.gate.v];
      const need = t.gate.n - b.min;
      estimated = true;
      if (b.done < need) why.push(`выполнить ещё ${need - b.done} кв. из текущей пачки у торговца ${t.trader}`);
    }
    stack.delete(t.id);
    return (memo[t.id] = { state: why.length ? 'locked' : 'open', why, estimated });
  };
  const out: Record<string, Avail> = {};
  for (const t of tasks) out[t.id] = calc(t, new Set());
  return out;
}

// Выполненный или взятый квест (по логам) — значит, уровень и лояльность для него уже были
const had = (done: Record<string, boolean>, id: string) => !!done[id] || !!done['a:' + id];

/** Уровень ЧВК, если игрок его не указал: самый высокий из требований выполненных и взятых квестов */
export const guessLevel = (tasks: Task[], done: Record<string, boolean>) =>
  Math.max(1, ...tasks.filter((t) => had(done, t.id)).map((t) => t.minPlayerLevel));

/** Лояльность у торговца, если не указана: самая высокая из выполненных и взятых квестов этого торговца */
export const guessLoyalty = (tasks: Task[], done: Record<string, boolean>, trader: string) =>
  Math.max(1, ...tasks.filter((t) => had(done, t.id) && t.trader === trader).map((t) => t.loyalty));

// ---------- одно определение «открытых сейчас» для «Квестов», «Обзора» и «Карт» ----------
/** Квесты только для другой фракции (BEAR/USEC) прячем, если фракция выбрана */
export const forFaction = (tasks: Task[], faction: string) => tasks.filter((t) => !faction || !t.faction || t.faction === faction);
/** Уровень ЧВК: указанный игроком, иначе оценка по выполненным и взятым квестам */
export const playerLevel = (tasks: Task[], done: Record<string, boolean>) => storedLevel(done) || guessLevel(tasks, done);
/** Лояльность у торговца: указанная игроком, иначе оценка */
export const playerLL = (tasks: Task[], done: Record<string, boolean>, trader: string) => storedLL(done, trader) || guessLoyalty(tasks, done, trader);
/** Доступность квестов по отметкам игрока (tasks — уже отфильтрованные по фракции) */
export const availabilityFor = (tasks: Task[], done: Record<string, boolean>) =>
  questAvailability(tasks, done, playerLevel(tasks, done), (tr) => playerLL(tasks, done, tr));
/** id квестов, открытых сейчас у торговцев */
export function openTaskIds(all: Task[], done: Record<string, boolean>, faction: string): Set<string> {
  const tasks = forFaction(all, faction);
  const av = availabilityFor(tasks, done);
  return new Set(tasks.filter((t) => av[t.id].state === 'open').map((t) => t.id));
}

// ---------- уровень ЧВК и лояльность, указанные игроком ----------
// Хранятся вместе с прогрессом (в аккаунте, если вошли): «lvl:28», «ll:Прапор:3».
// Значение должно быть одно; если из-за переноса или гонки записей их несколько — берём наибольшее
// (уровень и лояльность в игре только растут), а лишние снимает exclusiveCleanup.
const maxOf = (m: Record<string, boolean>, p: string) => {
  let best = 0;
  for (const k in m) if (m[k] && k.startsWith(p)) best = Math.max(best, Number(k.slice(p.length)) || 0);
  return best;
};
export const storedLevel = (m: Record<string, boolean>): number => maxOf(m, 'lvl:');
export const storedLL = (m: Record<string, boolean>, trader: string): number => maxOf(m, `ll:${trader}:`);

/** Группа «эксклюзивного» ключа: «lvl:» или «ll:<торговец>:»; для прочих ключей — null */
function exclusiveGroup(k: string): string | null {
  if (k.startsWith('lvl:')) return 'lvl:';
  if (k.startsWith('ll:')) { const i = k.lastIndexOf(':'); return i > 2 ? k.slice(0, i + 1) : null; }
  return null;
}
/** Лишние значения уровня и лояльности (все, кроме наибольшего в группе) — снять */
export function exclusiveCleanup(m: Record<string, boolean>): Record<string, false> {
  const groups: Record<string, string[]> = {};
  for (const k in m) { const g = m[k] && exclusiveGroup(k); if (g) (groups[g] ||= []).push(k); }
  const ch: Record<string, false> = {};
  for (const [g, keys] of Object.entries(groups)) {
    if (keys.length < 2) continue;
    const keep = 'lvl:' === g ? 'lvl:' + storedLevel(m) : g + maxOf(m, g);
    for (const k of keys) if (k !== keep) ch[k] = false;
    // Все значения нечисловые — оставляем как есть, чтобы не стереть всё
    if (!keys.includes(keep)) for (const k of keys) delete ch[k];
  }
  return ch;
}

/** Перенос отметок с устройства в аккаунт: что добавить и что удалить в аккаунте */
export function uploadPlan(remote: Record<string, boolean>, local: string[]): { add: string[]; remove: string[] } {
  const union: Record<string, boolean> = { ...remote };
  for (const k of local) union[k] = true;
  const drop = exclusiveCleanup(union);
  const add = local.filter((k) => !remote[k] && !(k in drop)
    // «взят»/«провален» для квеста, уже выполненного где-либо, не переносим
    && !((k.startsWith('a:') || k.startsWith('f:')) && union[k.slice(2)]));
  return { add: [...new Set(add)], remove: Object.keys(drop).filter((k) => remote[k]) };
}

/** Сопутствующие изменения: отметка «выполнен» (или её снятие) снимает «взят», а «выполнен» — и «провален».
 *  Явно заданные в changes «a:»/«f:» не трогаем. */
export function withSideMarks(changes: Record<string, boolean>): Record<string, boolean> {
  const out = { ...changes };
  for (const [id, v] of Object.entries(changes)) {
    if (id.includes(':')) continue; // только сами квесты (id без префикса)
    if (!(('a:' + id) in changes)) out['a:' + id] = false;
    if (v && !(('f:' + id) in changes)) out['f:' + id] = false;
  }
  return out;
}
/** Изменения отметок, чтобы записать новое значение (старое снимается) */
export function levelChanges(m: Record<string, boolean>, level: number) {
  const ch: Record<string, boolean> = {};
  for (const k in m) if (m[k] && k.startsWith('lvl:')) ch[k] = false;
  if (level > 0) ch['lvl:' + level] = true;
  return ch;
}
export function llChanges(m: Record<string, boolean>, trader: string, n: number) {
  const ch: Record<string, boolean> = {};
  const p = `ll:${trader}:`;
  for (const k in m) if (m[k] && k.startsWith(p)) ch[k] = false;
  if (n > 0) ch[p + n] = true;
  return ch;
}
