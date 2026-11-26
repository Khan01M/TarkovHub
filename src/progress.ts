// Прогресс квестов: отдельно для PvP (regular) и PvE.
// Ключи: id квеста; «o:<id цели>» — выполненная цель квеста; «h:<id уровня>» — построенный уровень модуля убежища.
// Без входа — localStorage на устройстве (ключи done:regular и done:pve).
// После входа игрока из списка — таблица quest_progress в Supabase (строка = квест выполнен).
import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameMode } from './api';
import { getClient, useAuth } from './auth';
import { exclusiveCleanup, uploadPlan, withSideMarks } from './questAvail';

type Marks = Record<string, true>;

// ---------- локальное хранилище ----------
const localKey = (mode: GameMode) => `done:${mode}`;
export const LEGACY_KEY = 'done';

export function readLocal(mode: GameMode): Marks {
  try {
    const raw = JSON.parse(localStorage.getItem(localKey(mode)) || '{}');
    const out: Marks = {};
    for (const [k, v] of Object.entries(raw)) if (v === true) out[k] = true;
    return out;
  } catch { return {}; }
}
function writeLocal(mode: GameMode, m: Marks) {
  try { localStorage.setItem(localKey(mode), JSON.stringify(m)); } catch { /* ignore */ }
}

/** Отметки из старой версии (общие для PvP и PvE). Учитываются только true. */
export function readLegacy(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LEGACY_KEY) || '{}');
    return Object.entries(raw).filter(([, v]) => v === true).map(([k]) => k);
  } catch { return []; }
}
/** Убираем старый ключ, но оставляем резервную копию на всякий случай. */
export function archiveLegacy() {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (raw != null) localStorage.setItem('done:legacy-backup', raw);
    localStorage.removeItem(LEGACY_KEY);
  } catch { /* ignore */ }
}

export function addLocal(mode: GameMode, ids: string[]) {
  const m = readLocal(mode);
  for (const id of ids) m[id] = true;
  writeLocal(mode, m);
}

// ---------- сервер ----------
const table = 'quest_progress';
const CONFLICT = { onConflict: 'user_id,mode,quest_id', ignoreDuplicates: true };
// Пачки: вставка — массивом в теле запроса, удаление — фильтром in(...) в адресе, поэтому пачка меньше
const UPSERT_CHUNK = 500;
const DELETE_CHUNK = 100;

async function fetchRemote(mode: GameMode, userId: string): Promise<Marks> {
  const c = await getClient();
  const out: Marks = {};
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await c!.from(table).select('quest_id').eq('user_id', userId).eq('mode', mode)
      .order('quest_id').range(from, from + page - 1);
    if (error) throw error;
    for (const r of data || []) out[(r as any).quest_id] = true;
    if (!data || data.length < page) break;
  }
  return out;
}

// Коды Postgres, когда сервер не принимает само значение ключа: check, длина, формат, not null
const KEY_CODES = new Set(['23514', '22001', '22P02', '23502', '22023', '22003']);

/** Ошибка записи; permanent — сервер не принимает сами ключи (400/409/422 или коды из KEY_CODES),
 *  повтор не поможет. Всё прочее — временное, ключи остаются в очереди: сеть, 5xx, 401/403/404
 *  (истёк вход, исключили из списка, другая сессия), ошибки PostgREST (PGRST…) про запрос в целом. */
class WriteError extends Error {
  permanent: boolean;
  code: string;
  constructor(e: any, status: number, temporary = false) {
    super(e?.message || String(e));
    this.code = String(e?.code || '');
    this.permanent = !temporary && !this.code.startsWith('PGRST') && (KEY_CODES.has(this.code) || [400, 409, 422].includes(status));
  }
}

/** Записать пачкой: del — удалить, ins — добавить. Ошибка любого запроса бросается (WriteError).
 *  Удаление идёт раньше вставки: при смене уровня/ЛЛ у пишущей стороны не бывает окна {старое, новое}. */
async function writeRemote(mode: GameMode, userId: string, ins: string[], del: string[]) {
  const c = await getClient();
  if (!c) throw new WriteError(new Error('нет связи с аккаунтом'), 0);
  // Во вкладке сменился вход (другой игрок) — не пишем чужие отметки в его аккаунт
  const { data } = await c.auth.getSession();
  if (data.session?.user.id !== userId) throw new WriteError(new Error('вход в аккаунт сменился — отметки сохранятся после входа под своим аккаунтом'), 0);
  for (let i = 0; i < del.length; i += DELETE_CHUNK) {
    const { error, status } = await c.from(table).delete().eq('user_id', userId).eq('mode', mode).in('quest_id', del.slice(i, i + DELETE_CHUNK));
    if (error) throw new WriteError(error, status);
  }
  for (let i = 0; i < ins.length; i += UPSERT_CHUNK) {
    const rows = ins.slice(i, i + UPSERT_CHUNK).map((quest_id) => ({ user_id: userId, mode, quest_id }));
    const { error, status } = await c.from(table).upsert(rows, CONFLICT);
    if (error) throw new WriteError(error, status);
  }
}

/** Добавить отметки с устройства в аккаунт. Повторный вызов не создаёт дубликатов;
 *  уровень и лояльность не задваиваются — остаётся наибольшее значение. */
export async function uploadMarks(mode: GameMode, userId: string, ids: string[]) {
  if (!ids.length) return;
  const { add, remove } = uploadPlan(await fetchRemote(mode, userId), ids);
  await writeRemote(mode, userId, add, remove);
}

// ---------- очередь сохранений в аккаунт ----------
// Желаемое значение каждой несохранённой отметки лежит в localStorage — переживает F5 и потерю сети.
// Пишем пачками и по одной пачке за раз: следующая уходит только после ответа на предыдущую,
// поэтому записи одного ключа не обгоняют друг друга, а побеждает последнее значение.
// Несколько вкладок: в localStorage каждая дописывает свои ключи поверх общего значения и удаляет
// только подтверждённые; несохранённое из других вкладок показываем (foreign), но не отправляем.
type Pending = Record<string, boolean>;
type Queue = {
  pending: Pending;                                   // ключ → желаемое значение, ещё не подтверждено сервером
  foreign: Pending;                                   // несохранённое другими вкладками (только показ)
  written: Map<string, { seq: number; v: boolean }>;  // что и когда подтверждено (для чтения, идущего параллельно)
  inherited: Set<string>;                             // ключи из localStorage, не правленные в этой вкладке
  rejected: Set<string>;                              // ключи, которые сервер отклонил окончательно
  rejectError: string | null;
  seq: number; error: string | null; running: Promise<void> | null;
  listeners: Set<(foreign?: Pending) => void>;
};
const queues = new Map<string, Queue>();
const pendingKey = (mode: GameMode, userId: string) => `pending:${mode}:${userId}`;

function readPending(k: string): Pending {
  const out: Pending = {};
  try {
    for (const [id, v] of Object.entries(JSON.parse(localStorage.getItem(k) || '{}'))) if (typeof v === 'boolean') out[id] = v;
  } catch { /* ignore */ }
  return out;
}
/** Слить в localStorage: set — свои новые значения поверх, drop — убрать, если значение то же */
function mergePending(k: string, set: [string, boolean][], drop: [string, boolean][] = []) {
  try {
    const cur = readPending(k);
    for (const [id, v] of set) cur[id] = v;
    for (const [id, v] of drop) if (cur[id] === v) delete cur[id];
    if (Object.keys(cur).length) localStorage.setItem(k, JSON.stringify(cur));
    else localStorage.removeItem(k);
  } catch { /* ignore */ }
}

function queueOf(mode: GameMode, userId: string): Queue {
  const k = pendingKey(mode, userId);
  let q = queues.get(k);
  if (!q) {
    const pending = readPending(k);
    q = { pending, foreign: {}, written: new Map(), inherited: new Set(Object.keys(pending)), rejected: new Set(), rejectError: null, seq: 0, error: null, running: null, listeners: new Set() };
    queues.set(k, q);
  }
  return q;
}
const notify = (q: Queue, foreign?: Pending) => q.listeners.forEach((l) => l(foreign));

/** Другая вкладка поменяла свой несохранённый список: берём из него то, чего нет у нас.
 *  Унаследованные ключи (взяты из localStorage, здесь не правились) сверяем с ним: значение
 *  сменилось — берём новое, ключ исчез (другая вкладка сохранила) — не досылаем устаревшее. */
function syncForeign(mode: GameMode, userId: string) {
  const q = queueOf(mode, userId);
  const ls = readPending(pendingKey(mode, userId));
  const n = { ...q.pending };
  for (const id of [...q.inherited]) {
    if (id in ls) n[id] = ls[id];
    else { delete n[id]; q.inherited.delete(id); }
  }
  q.pending = n;
  const f: Pending = {};
  for (const [id, v] of Object.entries(ls)) if (!(id in q.pending)) f[id] = v;
  q.foreign = f;
  notify(q, f);
}

/** Отправить всё несохранённое. Промис завершается, когда очередь пуста, или с ошибкой (временной). */
function flush(mode: GameMode, userId: string): Promise<void> {
  const q = queueOf(mode, userId);
  const k = pendingKey(mode, userId);
  // Уже отправляем: новые отметки подхватит текущий цикл
  if (q.running) return q.running;
  if (!Object.keys(q.pending).length) return Promise.resolve();

  // Подтверждённые убираем, если за время запроса их не поменяли ещё раз
  const confirm = (part: [string, boolean][]) => {
    const n = { ...q.pending };
    q.seq++;
    for (const [id, v] of part) {
      if (n[id] === v) { delete n[id]; q.inherited.delete(id); }
      q.written.set(id, { seq: q.seq, v });
    }
    q.pending = n; q.error = null;
    mergePending(k, [], part);
    notify(q);
  };
  // Пачку, которую сервер отклонил, делим пополам до одиночных ключей; одиночный — убираем из очереди.
  // Предохранитель: два разных ключа подряд отклонены одной и той же ошибкой — значит, дело не в ключах
  // (права, схема): первый возвращаем в очередь, остальное не трогаем, ошибка считается временной.
  let last: { id: string; v: boolean; sig: string } | null = null;
  const send = async (part: [string, boolean][]): Promise<void> => {
    try {
      await writeRemote(mode, userId, part.filter(([, v]) => v).map(([id]) => id), part.filter(([, v]) => !v).map(([id]) => id));
      confirm(part);
      last = null;
    } catch (e: any) {
      if (!(e instanceof WriteError) || !e.permanent) throw e;
      if (part.length > 1) {
        const h = Math.ceil(part.length / 2);
        await send(part.slice(0, h));
        await send(part.slice(h));
        return;
      }
      const [id, v] = part[0];
      const sig = e.code + '|' + e.message;
      if (last && last.sig === sig && last.id !== id) {
        const prev = last;
        if (!(prev.id in q.pending)) { q.pending = { ...q.pending, [prev.id]: prev.v }; mergePending(k, [[prev.id, prev.v]]); }
        q.rejected.delete(prev.id);
        if (!q.rejected.size) q.rejectError = null;
        console.warn('quest_progress: одинаковая ошибка у разных отметок — похоже на сбой сервера или прав', e.message);
        throw new WriteError(e, 0, true);
      }
      last = { id, v, sig };
      console.warn('quest_progress: сервер отклонил отметку', id, v, e.message);
      const n = { ...q.pending };
      if (n[id] === v) delete n[id];
      q.pending = n;
      q.rejected.add(id); q.rejectError = e.message; q.error = null;
      mergePending(k, [], part);
      notify(q);
    }
  };

  q.running = (async () => {
    try {
      for (;;) {
        const part = Object.entries(q.pending).slice(0, UPSERT_CHUNK);
        if (!part.length) break;
        await send(part);
      }
    } catch (e: any) {
      q.error = e?.message || String(e);
      notify(q);
      throw e;
    } finally {
      q.running = null;
    }
  })();
  q.running.catch(() => { /* ошибку показывает saveError */ });
  return q.running;
}

function enqueue(mode: GameMode, userId: string, changes: [string, boolean][]): Promise<void> {
  const q = queueOf(mode, userId);
  q.pending = { ...q.pending };
  for (const [id, v] of changes) { q.pending[id] = v; delete q.foreign[id]; q.rejected.delete(id); q.inherited.delete(id); }
  mergePending(pendingKey(mode, userId), changes);
  notify(q);
  return flush(mode, userId);
}

/** Наложить на отметки то, что ещё не сохранено (своё и других вкладок), и то, что подтверждено после sinceSeq */
function overlay(m: Marks, q: Queue, sinceSeq: number) {
  const apply = (id: string, v: boolean) => { if (v) m[id] = true; else delete m[id]; };
  q.written.forEach((w, id) => { if (w.seq > sinceSeq) apply(id, w.v); });
  for (const [id, v] of Object.entries(q.foreign)) apply(id, v);
  for (const [id, v] of Object.entries(q.pending)) apply(id, v);
}

const noop = () => { /* ошибку показывает saveError */ };
/** Отклонённый промис, который не считается «необработанным», если вызывающий его не ждёт */
const quietReject = (msg: string) => { const p = Promise.reject(new Error(msg)); p.catch(noop); return p; };

// ---------- хук для страницы квестов ----------
export type ProgressSource = 'local' | 'account';
type Changes = Record<string, boolean>;

export function useProgress(mode: GameMode) {
  const auth = useAuth();
  const account = auth.status === 'allowed' && auth.userId ? auth.userId : null;
  const source: ProgressSource = account ? 'account' : 'local';

  const [done, setDone] = useState<Marks>(() => readLocal(mode));
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const gen = useRef(0);
  const doneRef = useRef(done);
  doneRef.current = done;
  const loadErrorRef = useRef(loadError);
  loadErrorRef.current = loadError;

  const apply = (n: Marks) => { doneRef.current = n; setDone(n); };

  const reload = useCallback(async () => {
    const my = ++gen.current;
    setLoadError(null);
    if (!account) { apply(readLocal(mode)); setLoading(false); return; }
    setLoading(true);
    const q = queueOf(mode, account);
    // Сначала сверяемся с несохранённым других вкладок, потом досылаем своё — независимо от того, удастся ли чтение
    syncForeign(mode, account);
    flush(mode, account).catch(noop);
    const since = q.seq;
    try {
      const m = await fetchRemote(mode, account);
      if (my !== gen.current) return;
      overlay(m, q, since);
      // Задвоенные уровень/лояльность (после переноса или старой гонки записей) чистим
      const fix = Object.entries(exclusiveCleanup(m));
      for (const [id] of fix) delete m[id];
      apply(m);
      if (fix.length) enqueue(mode, account, fix).catch(noop);
    } catch (e: any) {
      if (my !== gen.current) return;
      // Прогресс из аккаунта не прочитан: правка заблокирована, показываем хотя бы несохранённое поверх того, что есть
      const m = { ...doneRef.current };
      overlay(m, q, -1);
      apply(m);
      setLoadError(e?.message || String(e));
    } finally {
      if (my === gen.current) setLoading(false);
    }
  }, [mode, account]);

  useEffect(() => { reload(); }, [reload]);

  // Состояние очереди (несохранённые отметки и ошибки) — общее для всех страниц
  const [, rerender] = useState(0);
  useEffect(() => {
    if (!account) return;
    const q = queueOf(mode, account);
    const k = pendingKey(mode, account);
    const f = (foreign?: Pending) => {
      if (foreign) { const m = { ...doneRef.current }; overlay(m, q, Infinity); apply(m); }
      rerender((x) => x + 1);
    };
    q.listeners.add(f);
    // Сеть вернулась — досылаем; если прогресс не прочитался — читаем заново
    const online = () => { if (loadErrorRef.current) reload(); else flush(mode, account).catch(noop); };
    const storage = (e: StorageEvent) => { if (e.key === k) syncForeign(mode, account); };
    window.addEventListener('online', online);
    window.addEventListener('storage', storage);
    return () => { q.listeners.delete(f); window.removeEventListener('online', online); window.removeEventListener('storage', storage); };
  }, [mode, account, reload]);

  // Править можно, когда отметки загружены (в аккаунте — прочитаны с сервера)
  const canEdit = !loading && !(account && loadError);
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;

  /** Задать сразу несколько отметок (например, уровни модуля убежища). changes можно посчитать
   *  от текущих отметок функцией. В аккаунте промис завершается, когда всё отправлено, или с ошибкой;
   *  результат — сколько из этих отметок сервер не принял окончательно. */
  const setMarks = useCallback((changes: Changes | ((cur: Record<string, true>) => Changes)): Promise<number> => {
    if (!canEditRef.current) return quietReject('прогресс из аккаунта не загружен — отметки пока нельзя менять');
    const cur = doneRef.current;
    const all = withSideMarks(typeof changes === 'function' ? changes(cur) : changes);
    const n = { ...cur };
    const real: [string, boolean][] = [];
    for (const [id, v] of Object.entries(all)) {
      if (!!n[id] === v) continue;
      if (v) n[id] = true; else delete n[id];
      real.push([id, v]);
    }
    if (!real.length) return Promise.resolve(0);
    apply(n);
    if (!account) { writeLocal(mode, n); return Promise.resolve(0); }
    const q = queueOf(mode, account);
    const p = enqueue(mode, account, real).then(() => real.filter(([id]) => q.rejected.has(id)).length);
    p.catch(noop); // вызывающий может не ждать — ошибку покажет saveError
    return p;
  }, [mode, account]);

  const toggle = useCallback((id: string) => {
    setMarks((cur) => ({ [id]: !cur[id] })).catch(noop);
  }, [setMarks]);

  const retry = useCallback(() => {
    if (account) flush(mode, account).catch(noop);
  }, [mode, account]);

  const q = account ? queueOf(mode, account) : null;
  // «Не сохранено» показываем, только если запись не удалась (пока запрос идёт, это не ошибка)
  const unsaved: Changes = q?.error ? q.pending : {};
  const saveError = q?.error || null;
  // Отметки, которые сервер не принял окончательно (убраны из очереди)
  const rejected = q ? q.rejected.size : 0;
  const rejectError = q?.rejectError || null;

  return { done, toggle, setMarks, source, loading, loadError, canEdit, unsaved, saveError, rejected, rejectError, retry, reload, auth };
}

/** Числовое поле, которое сохраняет не на каждый символ, а по уходу с поля, Enter или через delay мс
 *  после последнего ввода. commit получает введённый текст. */
export function useLazyNumber(value: number, commit: (s: string) => void, delay = 600, disabled = false) {
  const [draft, setDraft] = useState<string | null>(null); // null — не редактируют, показываем value
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const pending = useRef<string | null>(null);
  const focused = useRef(false);
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const fire = (force = false) => {
    clearTimeout(timer.current);
    // Поле заблокировано (прогресс грузится) — набранное держим и сохраним после разблокировки
    if (disabledRef.current && !force) return;
    if (pending.current != null) { const s = pending.current; pending.current = null; commitRef.current(s); }
    // Поле уже не в фокусе — показываем сохранённое значение
    if (!focused.current) setDraft(null);
  };
  // Ушли со страницы, не дождавшись задержки, — всё равно пробуем сохранить
  useEffect(() => () => fire(true), []); // eslint-disable-line react-hooks/exhaustive-deps
  // Поле стало недоступно (blur в этом случае может не прийти) — снимаем фокус, черновик не теряем;
  // снова доступно — сохраняем то, что набрали
  useEffect(() => {
    if (disabled) { focused.current = false; clearTimeout(timer.current); } else if (pending.current != null) fire();
  }, [disabled]); // eslint-disable-line react-hooks/exhaustive-deps
  // Значение поменялось извне, а поле не редактируют — показываем новое
  useEffect(() => { if (!focused.current && pending.current == null) setDraft(null); }, [value]);
  return {
    value: draft ?? (value ? String(value) : ''),
    onFocus: () => { focused.current = true; },
    onChange: (e: { target: { value: string } }) => {
      const s = e.target.value;
      setDraft(s); pending.current = s;
      clearTimeout(timer.current);
      timer.current = setTimeout(fire, delay);
    },
    onBlur: () => { focused.current = false; fire(); },
    onKeyDown: (e: { key: string }) => { if (e.key === 'Enter') fire(); },
  };
}

// ---------- команда: прогресс друг друга (только просмотр) ----------
export type Teammate = { userId: string; name: string; avatar?: string; done: Set<string>; me: boolean };

/** Сохраняет имя и аватар из Discord, чтобы товарищи видели, чей прогресс. */
export async function saveProfile(userId: string, name: string, avatar?: string) {
  const c = await getClient();
  const safeAvatar = avatar && avatar.startsWith('https://cdn.discordapp.com/') ? avatar : null;
  const { error } = await c!.from('players').upsert(
    { user_id: userId, name: (name || 'Игрок').slice(0, 64), avatar: safeAvatar, updated_at: new Date().toISOString() },
    { onConflict: 'user_id' },
  );
  if (error) throw error;
}

async function fetchTeam(mode: GameMode, myId: string): Promise<Teammate[]> {
  const c = await getClient();
  const { data: players, error: e1 } = await c!.from('players').select('user_id,name,avatar');
  if (e1) throw e1;
  const done: Record<string, Set<string>> = {};
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await c!.from(table).select('user_id,quest_id').eq('mode', mode)
      .order('user_id').order('quest_id').range(from, from + page - 1);
    if (error) throw error;
    for (const r of (data || []) as any[]) (done[r.user_id] ||= new Set()).add(r.quest_id);
    if (!data || data.length < page) break;
  }
  const list: Teammate[] = (players || []).map((p: any) => ({
    userId: p.user_id, name: p.name, avatar: p.avatar || undefined, done: done[p.user_id] || new Set(), me: p.user_id === myId,
  }));
  // Сначала я, потом остальные по имени
  return list.sort((a, b) => (a.me ? -1 : b.me ? 1 : a.name.localeCompare(b.name, 'ru')));
}

export function useTeam(mode: GameMode, enabled: boolean, myId?: string, myName?: string, myAvatar?: string, myDone?: Record<string, true>) {
  const [team, setTeam] = useState<Teammate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [missingTable, setMissingTable] = useState(false);

  const load = useCallback(async () => {
    if (!enabled || !myId) { setTeam([]); return; }
    setLoading(true); setError(null);
    try {
      // Профиль обновляем при каждом входе: вдруг сменили ник или аватар
      await saveProfile(myId, myName || 'Игрок', myAvatar).catch((e) => { throw e; });
      setTeam(await fetchTeam(mode, myId));
      setMissingTable(false);
    } catch (e: any) {
      const msg = e?.message || String(e);
      // Таблицы players ещё нет — значит, team.sql не запускали. Просто не показываем блок команды.
      if (/players/.test(msg) && /(schema cache|does not exist|PGRST205)/i.test(msg + (e?.code || ''))) setMissingTable(true);
      else setError(msg);
    } finally { setLoading(false); }
  }, [mode, enabled, myId, myName, myAvatar]);

  useEffect(() => { load(); }, [load]);
  // Обновляем, когда игрок возвращается на вкладку
  useEffect(() => {
    if (!enabled) return;
    const f = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', f);
    return () => document.removeEventListener('visibilitychange', f);
  }, [enabled, load]);

  // Мои отметки берём из локального состояния страницы, чтобы они обновлялись сразу
  const merged = team.map((t) => (t.me && myDone ? { ...t, done: new Set(Object.keys(myDone)) } : t));
  return { team: merged, error, loading, missingTable, reload: load };
}
