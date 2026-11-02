// Прогресс квестов: отдельно для PvP (regular) и PvE.
// Без входа — localStorage на устройстве (ключи done:regular и done:pve).
// После входа игрока из списка — таблица quest_progress в Supabase (строка = квест выполнен).
import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameMode } from './api';
import { getClient, useAuth } from './auth';

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

/** Добавить отметки в аккаунт. Повторный вызов не создаёт дубликатов. */
export async function uploadMarks(mode: GameMode, userId: string, ids: string[]) {
  if (!ids.length) return;
  const c = await getClient();
  for (let i = 0; i < ids.length; i += 500) {
    const rows = ids.slice(i, i + 500).map((quest_id) => ({ user_id: userId, mode, quest_id }));
    const { error } = await c!.from(table).upsert(rows, { onConflict: 'user_id,mode,quest_id', ignoreDuplicates: true });
    if (error) throw error;
  }
}

async function saveRemote(mode: GameMode, userId: string, id: string, value: boolean) {
  const c = await getClient();
  if (value) {
    const { error } = await c!.from(table).upsert({ user_id: userId, mode, quest_id: id }, { onConflict: 'user_id,mode,quest_id', ignoreDuplicates: true });
    if (error) throw error;
  } else {
    const { error } = await c!.from(table).delete().eq('user_id', userId).eq('mode', mode).eq('quest_id', id);
    if (error) throw error;
  }
}

// ---------- хук для страницы квестов ----------
export type ProgressSource = 'local' | 'account';

export function useProgress(mode: GameMode) {
  const auth = useAuth();
  const account = auth.status === 'allowed' && auth.userId ? auth.userId : null;
  const source: ProgressSource = account ? 'account' : 'local';

  const [done, setDone] = useState<Marks>(() => readLocal(mode));
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Отметки, которые не удалось сохранить: id → желаемое значение
  const [unsaved, setUnsaved] = useState<Record<string, boolean>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const gen = useRef(0);

  const reload = useCallback(async () => {
    const my = ++gen.current;
    setUnsaved({}); setSaveError(null); setLoadError(null);
    if (!account) { setDone(readLocal(mode)); setLoading(false); return; }
    setLoading(true);
    try {
      const m = await fetchRemote(mode, account);
      if (my === gen.current) setDone(m);
    } catch (e: any) {
      if (my === gen.current) setLoadError(e?.message || String(e));
    } finally {
      if (my === gen.current) setLoading(false);
    }
  }, [mode, account]);

  useEffect(() => { reload(); }, [reload]);

  const save = useCallback(async (id: string, value: boolean) => {
    if (!account) return;
    try {
      await saveRemote(mode, account, id, value);
      setUnsaved((u) => { const n = { ...u }; delete n[id]; return n; });
      setSaveError(null);
    } catch (e: any) {
      // Отметку на экране не снимаем: игрок видит, что она не сохранена, и может повторить
      setUnsaved((u) => ({ ...u, [id]: value }));
      setSaveError(e?.message || String(e));
    }
  }, [mode, account]);

  const doneRef = useRef(done);
  doneRef.current = done;

  const toggle = useCallback((id: string) => {
    const n = { ...doneRef.current };
    const value = !n[id];
    if (value) n[id] = true; else delete n[id];
    doneRef.current = n;
    setDone(n);
    if (!account) writeLocal(mode, n);
    else save(id, value);
  }, [mode, account, save]);

  const retry = useCallback(() => {
    for (const [id, v] of Object.entries(unsaved)) save(id, v);
  }, [unsaved, save]);

  return { done, toggle, source, loading, loadError, unsaved, saveError, retry, reload, auth };
}
