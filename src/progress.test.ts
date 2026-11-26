import { beforeEach, describe, expect, it, vi } from 'vitest';

// Заглушка клиента Supabase: запоминает запросы, хранит строки quest_progress в памяти.
type Call = { op: 'select' | 'upsert' | 'delete'; rows?: any[]; ids?: string[]; opts?: any };
const fake = vi.hoisted(() => ({
  calls: [] as Call[],
  rows: [] as { user_id: string; mode: string; quest_id: string }[],
  failUpsert: null as null | { message: string },
}));

function makeClient() {
  return {
    // writeRemote сверяет, что сессия во вкладке — того же игрока, чьи отметки пишутся
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
    from(_table: string) {
      return {
        select() {
          const f: Record<string, string> = {};
          const q = {
            eq(col: string, v: string) { f[col] = v; return q; },
            order() { return q; },
            range(from: number, to: number) {
              fake.calls.push({ op: 'select' });
              const data = fake.rows.filter((r) => r.user_id === f.user_id && r.mode === f.mode)
                .sort((a, b) => a.quest_id.localeCompare(b.quest_id)).slice(from, to + 1)
                .map((r) => ({ quest_id: r.quest_id }));
              return Promise.resolve({ data, error: null });
            },
          };
          return q;
        },
        upsert(rows: any[], opts: any) {
          fake.calls.push({ op: 'upsert', rows, opts });
          if (fake.failUpsert) return Promise.resolve({ error: fake.failUpsert });
          for (const r of rows) if (!fake.rows.some((x) => x.user_id === r.user_id && x.mode === r.mode && x.quest_id === r.quest_id)) fake.rows.push(r);
          return Promise.resolve({ error: null });
        },
        delete() {
          const f: Record<string, string> = {};
          const q = {
            eq(col: string, v: string) { f[col] = v; return q; },
            in(_col: string, ids: string[]) {
              fake.calls.push({ op: 'delete', ids });
              fake.rows = fake.rows.filter((r) => !(r.user_id === f.user_id && r.mode === f.mode && ids.includes(r.quest_id)));
              return Promise.resolve({ error: null });
            },
          };
          return q;
        },
      };
    },
  };
}

vi.mock('./auth', () => ({
  getClient: async () => makeClient(),
  useAuth: () => ({ status: 'signedOut' }),
}));

import { addLocal, archiveLegacy, LEGACY_KEY, readLegacy, readLocal, uploadMarks } from './progress';

const ids = (n: number, p = 'q') => Array.from({ length: n }, (_, i) => `${p}${String(i).padStart(4, '0')}`);
const remoteIds = (user = 'u1', mode = 'pve') => fake.rows.filter((r) => r.user_id === user && r.mode === mode).map((r) => r.quest_id).sort();

beforeEach(() => {
  fake.calls = [];
  fake.rows = [];
  fake.failUpsert = null;
});

describe('uploadMarks — перенос отметок в аккаунт', () => {
  it('1200 отметок уходят тремя запросами upsert (пачки по 500)', async () => {
    await uploadMarks('pve', 'u1', ids(1200));
    const ups = fake.calls.filter((c) => c.op === 'upsert');
    expect(ups.map((c) => c.rows!.length)).toEqual([500, 500, 200]);
    expect(remoteIds()).toHaveLength(1200);
    // Строки — с пользователем и режимом, повторная вставка не ломает уникальность
    expect(ups[0].rows![0]).toEqual({ user_id: 'u1', mode: 'pve', quest_id: 'q0000' });
    expect(ups[0].opts).toMatchObject({ onConflict: 'user_id,mode,quest_id' });
  });

  it('повторный перенос не создаёт дубликатов и лишних запросов', async () => {
    await uploadMarks('pve', 'u1', ['A', 'B']);
    fake.calls = [];
    await uploadMarks('pve', 'u1', ['A', 'B']);
    expect(fake.calls.filter((c) => c.op === 'upsert')).toEqual([]);
    expect(remoteIds()).toEqual(['A', 'B']);
  });

  it('пустой список — ни одного запроса', async () => {
    await uploadMarks('pve', 'u1', []);
    expect(fake.calls).toEqual([]);
  });

  it('уровень: в аккаунте остаётся одно наибольшее значение lvl:', async () => {
    fake.rows.push({ user_id: 'u1', mode: 'pve', quest_id: 'lvl:5' });
    await uploadMarks('pve', 'u1', ['lvl:12', 'A']);
    expect(remoteIds()).toEqual(['A', 'lvl:12']);
  });

  it('уровень: меньший с устройства не добавляет второго lvl:', async () => {
    fake.rows.push({ user_id: 'u1', mode: 'pve', quest_id: 'lvl:30' });
    await uploadMarks('pve', 'u1', ['lvl:12']);
    expect(remoteIds()).toEqual(['lvl:30']);
  });

  it('ЛЛ: в аккаунте одно значение на торговца', async () => {
    fake.rows.push({ user_id: 'u1', mode: 'pve', quest_id: 'll:Прапор:2' });
    await uploadMarks('pve', 'u1', ['ll:Прапор:3']);
    expect(remoteIds()).toEqual(['ll:Прапор:3']);
  });

  it('режимы и игроки не смешиваются', async () => {
    fake.rows.push({ user_id: 'u1', mode: 'regular', quest_id: 'lvl:50' }, { user_id: 'u2', mode: 'pve', quest_id: 'lvl:50' });
    await uploadMarks('pve', 'u1', ['lvl:10']);
    expect(remoteIds('u1', 'pve')).toEqual(['lvl:10']);
    expect(remoteIds('u1', 'regular')).toEqual(['lvl:50']);
    expect(remoteIds('u2', 'pve')).toEqual(['lvl:50']);
  });

  it('ошибка записи пробрасывается', async () => {
    fake.failUpsert = { message: 'нет прав' };
    await expect(uploadMarks('pve', 'u1', ['A'])).rejects.toMatchObject({ message: 'нет прав' });
  });
});

describe('локальное хранилище прогресса', () => {
  it('addLocal / readLocal: отдельно для PvP и PvE', () => {
    addLocal('pve', ['A', 'B']);
    addLocal('regular', ['C']);
    addLocal('pve', ['B', 'D']);
    expect(Object.keys(readLocal('pve')).sort()).toEqual(['A', 'B', 'D']);
    expect(readLocal('regular')).toEqual({ C: true });
  });

  it('readLocal: учитываются только true, битый JSON — пусто', () => {
    localStorage.setItem('done:pve', JSON.stringify({ A: true, B: false, C: 1 }));
    expect(readLocal('pve')).toEqual({ A: true });
    localStorage.setItem('done:pve', '{не json');
    expect(readLocal('pve')).toEqual({});
  });

  it('старый общий ключ: читается и архивируется в резервную копию', () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ A: true, B: false }));
    expect(readLegacy()).toEqual(['A']);
    archiveLegacy();
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
    expect(JSON.parse(localStorage.getItem('done:legacy-backup')!)).toEqual({ A: true, B: false });
    expect(readLegacy()).toEqual([]);
  });

  // Очередь сохранений (pending:<mode>:<user> в localStorage, flush пачками по 500) доступна только
  // через хук useProgress: enqueue/flush/queueOf не экспортированы. См. отчёт.
  it.todo('очередь pending: переживает перезагрузку и пишет пачками — нужен экспорт enqueue/flush');
});
