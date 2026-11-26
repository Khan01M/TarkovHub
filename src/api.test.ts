import { describe, it, expect, vi, afterEach } from 'vitest';
import { load, datasetRaw } from './api';

// Запасная копия (без сети) не должна сохраняться в localStorage как свежая:
// иначе после возврата сети старые цены жили бы ещё 15 минут.
// Набор crafts выбран потому, что у него нет перевода и проверки размера — один запрос на загрузку.

const g = globalThis as any;
const realFetch = g.fetch;
type Reply = { fail?: boolean; cacheHeader?: boolean; value: number };
let replies: Reply[] = [];
const modes: string[] = [];

function mockFetch() {
  g.fetch = vi.fn(async (_url: string, init: RequestInit) => {
    modes.push(String(init.cache));
    const r = replies.shift()!;
    if (r.fail) throw new TypeError('Failed to fetch');
    return {
      ok: true, status: 200,
      headers: new Headers(r.cacheHeader ? { 'X-TH-Cache': '1' } : {}),
      json: async () => ({ data: { v: r.value } }),
    };
  });
}

const saved = (name: string) => {
  const s = localStorage.getItem(`data:v8:${name}:regular`);
  return s ? JSON.parse(s).data : null;
};

afterEach(() => { g.fetch = realFetch; vi.useRealTimers(); modes.length = 0; });

describe('api.load: свежие данные и запасные копии', () => {
  it('ответ из кэша service worker (X-TH-Cache) отдаётся, но не сохраняется', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(1_000_000_000_000);
    mockFetch(); replies = [{ cacheHeader: true, value: 1 }];
    const d = await load('t1', () => datasetRaw('crafts'));
    expect(d.data).toEqual({ v: 1 });
    expect(saved('t1')).toBeNull();
  });

  it('копия из HTTP-кэша (второй заход, force-cache) — тоже не свежая', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(1_000_000_000_000 + 10 * 60_000);
    mockFetch(); replies = [{ fail: true, value: 0 }, { value: 2 }];
    const d = await load('t2', () => datasetRaw('crafts'));
    expect(modes).toEqual(['no-cache', 'force-cache']);
    expect(d.data).toEqual({ v: 2 });
    expect(saved('t2')).toBeNull();
  });

  it('после возврата сети (через минуту) свежий ответ сохраняется', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(1_000_000_000_000 + 20 * 60_000);
    mockFetch(); replies = [{ value: 3 }];
    const d = await load('t3', () => datasetRaw('crafts'));
    expect(d.data).toEqual({ v: 3 });
    expect(saved('t3')).toEqual({ data: { v: 3 }, ru: {} });
  });
});
