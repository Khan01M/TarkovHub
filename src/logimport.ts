// Импорт выполненных квестов из логов игры (папка Logs в папке Escape from Tarkov).
// Читаем только два вида файлов: application (режим PvP/PvE) и push-notifications
// (сообщения торговцев: тип 10 — квест взят, 11 — провален, 12 — выполнен).
import type { GameMode, Task } from './api';

export type Raid = { id: string; t: number; map: string };
export type LogResult = { mode: GameMode; finished: string[]; started: string[]; failed: string[]; raids: Raid[]; sessions: number; from: number; to: number };

// Начало рейда в application-логе: время строки, локация и короткий id рейда
const RAID = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\.\d+\|[^\n]*TRACE-NetworkGameCreate profileStatus:[^\n]*?Location: ([\w-]+)[^\n]*?shortId: (\w+)/gm;

/** Названия локаций из логов игры */
const LOC: Record<string, string> = {
  bigmap: 'Таможня', woods: 'Лес', shoreline: 'Берег', interchange: 'Развязка', rezervbase: 'Резерв',
  laboratory: 'Лаборатория', lighthouse: 'Маяк', tarkovstreets: 'Улицы Таркова', sandbox: 'Эпицентр',
  sandbox_high: 'Эпицентр', factory4_day: 'Завод', factory4_night: 'Завод (ночь)', labyrinth: 'Лабиринт', icebreaker: 'Ледокол',
};
export const locName = (id: string) => {
  const low = id.toLowerCase();
  const ev = low.endsWith('_event');
  const base = ev ? low.slice(0, -6) : low;
  const n = LOC[base] || LOC[base.replace(/_event$/, '')] || (base.startsWith('factory') ? 'Завод' : base);
  return ev ? `${n} (заражённая)` : n;
};

// ---------- история рейдов: хранится на устройстве ----------
const raidsKey = (mode: GameMode) => `raids:${mode}`;
export function readRaids(mode: GameMode): Raid[] {
  try { return JSON.parse(localStorage.getItem(raidsKey(mode)) || '[]') || []; } catch { return []; }
}
export function saveRaids(mode: GameMode, add: Raid[]) {
  const m: Record<string, Raid> = {};
  for (const r of [...readRaids(mode), ...add]) m[r.id] = r;
  const list = Object.values(m).sort((a, b) => b.t - a.t).slice(0, 500);
  try { localStorage.setItem(raidsKey(mode), JSON.stringify(list)); } catch { /* ignore */ }
  return list.length;
}

const EVENT = /"type":\s*(1[0-2]),\s*"dt":\s*(\d+),[\s\S]*?"templateId":\s*"([0-9a-f]{24}) /g;

export async function parseLogs(files: File[]): Promise<LogResult[]> {
  // Файлы одной игровой сессии лежат в одной папке log_<дата>_<версия>
  const byDir: Record<string, File[]> = {};
  for (const f of files) {
    const name = f.name.toLowerCase();
    if (!name.includes('push-notifications') && !name.includes('application')) continue;
    const path = (f as any).webkitRelativePath || f.name;
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : name.replace(/ (application|push-notifications).*$/, '');
    (byDir[dir] ||= []).push(f);
  }
  const ev: Record<GameMode, { dt: number; type: number; id: string }[]> = { regular: [], pve: [] };
  const raids: Record<GameMode, Raid[]> = { regular: [], pve: [] };
  const sessions: Record<GameMode, number> = { regular: 0, pve: 0 };
  for (const list of Object.values(byDir)) {
    let mode: GameMode = 'regular';
    const rBefore = { regular: raids.regular.length, pve: raids.pve.length };
    const appText: string[] = [];
    for (const f of list) if (f.name.toLowerCase().includes('application')) {
      const txt = await f.text();
      appText.push(txt);
      const m = /Session mode: (\w+)/.exec(txt);
      if (m) mode = m[1].toLowerCase() === 'pve' ? 'pve' : 'regular';
    }
    for (const txt of appText) for (const m of txt.matchAll(RAID)) {
      raids[mode].push({ id: m[3], t: new Date(m[1].replace(' ', 'T')).getTime(), map: m[2] });
    }
    let any = false;
    for (const f of list) if (f.name.toLowerCase().includes('push-notifications')) {
      const txt = await f.text();
      for (const m of txt.matchAll(EVENT)) { ev[mode].push({ type: Number(m[1]), dt: Number(m[2]), id: m[3] }); any = true; }
    }
    if (any || raids[mode].length > rBefore[mode]) sessions[mode]++;
  }
  const out: LogResult[] = [];
  for (const mode of ['pve', 'regular'] as GameMode[]) {
    const list = ev[mode].sort((a, b) => a.dt - b.dt);
    const rs = raids[mode];
    if (!list.length && !rs.length) continue;
    const times = [...list.map((e) => e.dt), ...rs.map((r) => Math.floor(r.t / 1000))];
    const last: Record<string, number> = {};
    for (const e of list) last[e.id] = e.type;
    const pick = (t: number) => Object.keys(last).filter((id) => last[id] === t);
    out.push({ mode, finished: pick(12), started: pick(10), failed: pick(11), raids: rs, sessions: sessions[mode], from: Math.min(...times), to: Math.max(...times) });
  }
  return out;
}

/**
 * Что отметить выполненным: квесты, выполненные по логам, и все предыдущие квесты,
 * без которых нельзя было взять выполненные или взятые сейчас.
 */
export function marksFromLogs(r: LogResult, tasks: Task[]) {
  const byId: Record<string, Task> = Object.fromEntries(tasks.map((t) => [t.id, t]));
  const done = new Set<string>();
  const inferred = new Set<string>();
  const walk = (id: string) => {
    for (const q of byId[id]?.reqs || []) {
      if (!q.status.includes('complete') || !byId[q.id] || done.has(q.id) || inferred.has(q.id)) continue;
      inferred.add(q.id);
      walk(q.id);
    }
  };
  for (const id of r.finished) if (byId[id]) { done.add(id); }
  for (const id of [...r.finished, ...r.started]) if (byId[id]) walk(id);
  for (const id of done) inferred.delete(id);
  return { fromLog: [...done], inferred: [...inferred], unknown: r.finished.filter((id) => !byId[id]).length };
}
