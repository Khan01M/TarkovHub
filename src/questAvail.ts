// Какие квесты сейчас открыты у торговцев — как во вкладке «Задания» в игре.
// Квест открыт, если он не выполнен, уровень ЧВК не ниже нужного, лояльность у его торговца
// достаточная и выполнены предыдущие квесты (для «взять» достаточно, чтобы предыдущий был открыт).
//
// С патча 1.1.0 большинство побочных квестов открываются пачками внутри «ветки» торговца:
// выполнил несколько квестов текущей пачки — открылась следующая. Игра хранит это в счётчике,
// который в открытых данных не расписан, поэтому здесь он оценивается по числу выполненных
// квестов той же ветки (estimated = true).
import type { Task } from './api';

export type Avail = { state: 'done' | 'open' | 'locked'; why: string[]; estimated?: boolean };

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
    if (stack.has(t.id)) return { state: 'locked', why: [] }; // защита от циклов в данных
    stack.add(t.id);
    const why: string[] = [];
    if (level < t.minPlayerLevel) why.push(`нужен ${t.minPlayerLevel} ур. ЧВК`);
    if (ll(t.trader) < t.loyalty) why.push(`нужен ЛЛ${t.loyalty} у торговца ${t.trader}`);
    if (t.traderUnlock && !done[t.traderUnlock]) why.push(`торговец ${t.trader} ещё закрыт: сначала «${byId[t.traderUnlock]?.name || '?'}»`);
    if (t.badRep) why.push(`только при отрицательной репутации у торговца ${t.trader}`);
    for (const r of t.reqs) {
      const rt = byId[r.id];
      if (!rt || done[r.id]) continue;
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

/** Уровень ЧВК, если игрок его не указал: самый высокий из требований выполненных квестов */
export const guessLevel = (tasks: Task[], done: Record<string, boolean>) =>
  Math.max(1, ...tasks.filter((t) => done[t.id]).map((t) => t.minPlayerLevel));

/** Лояльность у торговца, если не указана: самая высокая из выполненных квестов этого торговца */
export const guessLoyalty = (tasks: Task[], done: Record<string, boolean>, trader: string) =>
  Math.max(1, ...tasks.filter((t) => done[t.id] && t.trader === trader).map((t) => t.loyalty));
