// Импорт выполненных квестов из логов игры (папка Logs в папке Escape from Tarkov).
// Читаем только два вида файлов: application (режим PvP/PvE) и push-notifications
// (сообщения торговцев: тип 10 — квест взят, 11 — провален, 12 — выполнен).
import type { GameMode, Task } from './api';

export type LogResult = { mode: GameMode; finished: string[]; started: string[]; failed: string[]; sessions: number; from: number; to: number };

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
  const sessions: Record<GameMode, number> = { regular: 0, pve: 0 };
  for (const list of Object.values(byDir)) {
    let mode: GameMode = 'regular';
    for (const f of list) if (f.name.toLowerCase().includes('application')) {
      const m = /Session mode: (\w+)/.exec(await f.text());
      if (m) mode = m[1].toLowerCase() === 'pve' ? 'pve' : 'regular';
    }
    let any = false;
    for (const f of list) if (f.name.toLowerCase().includes('push-notifications')) {
      const txt = await f.text();
      for (const m of txt.matchAll(EVENT)) { ev[mode].push({ type: Number(m[1]), dt: Number(m[2]), id: m[3] }); any = true; }
    }
    if (any) sessions[mode]++;
  }
  const out: LogResult[] = [];
  for (const mode of ['pve', 'regular'] as GameMode[]) {
    const list = ev[mode].sort((a, b) => a.dt - b.dt);
    if (!list.length) continue;
    const last: Record<string, number> = {};
    for (const e of list) last[e.id] = e.type;
    const pick = (t: number) => Object.keys(last).filter((id) => last[id] === t);
    out.push({ mode, finished: pick(12), started: pick(10), failed: pick(11), sessions: sessions[mode], from: list[0].dt, to: list[list.length - 1].dt });
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
