// Клиент открытого GraphQL API tarkov.dev (бесплатно, без ключа).
// Данные кэшируются в localStorage, чтобы приложение открывалось быстро и работало без сети.

const ENDPOINT = 'https://api.tarkov.dev/graphql';
const TTL_MS = 10 * 60 * 1000; // цены барахолки обновляются часто — держим кэш 10 минут

export type GameMode = 'regular' | 'pve';

export function getGameMode(): GameMode {
  try { return (localStorage.getItem('gameMode') as GameMode) || 'regular'; } catch { return 'regular'; }
}
export function setGameMode(m: GameMode) {
  try { localStorage.setItem('gameMode', m); } catch { /* ignore */ }
}

function cacheGet(key: string, allowStale = false) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { t, data } = JSON.parse(raw);
    if (allowStale || Date.now() - t < TTL_MS) return data;
  } catch { /* ignore */ }
  return null;
}
function cacheSet(key: string, data: unknown) {
  try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), data })); } catch { /* квота — не страшно */ }
}

async function post(query: string) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`Сервер ответил ${res.status}`);
  const json = await res.json();
  if (json.errors?.length && !json.data) throw new Error(json.errors[0].message);
  return json.data;
}

/**
 * Выполняет запрос. В тексте запроса можно использовать {MODE} — подставится аргумент gameMode.
 * Если API не поддерживает какой-то аргумент/поле, пробуем запасной вариант (fallback).
 */
export async function gql<T = any>(name: string, query: string, fallback?: string): Promise<T> {
  const mode = getGameMode();
  const key = `gql:${name}:${mode}`;
  const fresh = cacheGet(key);
  if (fresh) return fresh;
  const fill = (q: string, withMode: boolean) => q.replace(/\{MODE\}/g, withMode ? `, gameMode: ${mode}` : '');
  const attempts = [fill(query, true)];
  if (query.includes('{MODE}')) attempts.push(fill(query, false));
  if (fallback) attempts.push(fill(fallback, true), fill(fallback, false));
  let lastErr: unknown;
  for (const q of attempts) {
    try {
      const data = await post(q);
      cacheSet(key, data);
      return data;
    } catch (e) { lastErr = e; }
  }
  const stale = cacheGet(key, true);
  if (stale) return stale; // нет сети — показываем последние сохранённые данные
  throw lastErr;
}

export const rub = (n?: number | null) =>
  n == null || n === 0 ? '—' : new Intl.NumberFormat('ru-RU').format(Math.round(n)) + ' ₽';

export const num = (n?: number | null, d = 0) =>
  n == null ? '—' : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: d }).format(n);
