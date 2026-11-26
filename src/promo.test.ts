import { describe, expect, it } from 'vitest';
import type { GameMode, Task } from './api';
import bundled from '../public/promocodes.json';
import {
  OWNER_KEY, PROMO_PREFIX, USED_KEY, claimOwner, isPromoKey, migrateUsedCodes, migrationPlan, mirrorLocal, promoChanges, promoKey,
  promoProgressMode, readOwner, readSynced, readUsedLocal, sameMarks, syncedKey, usedInAccount, type PromoMode,
} from './promo';
import { availabilityFor, exclusiveCleanup, openTaskIds, playerLevel, playerLL, uploadPlan, withSideMarks } from './questAvail';
import { chaptersDone, groupIds, hasTerminalProgress, personalSteps, summarize, type Member } from './terminal';

const task = (id: string, extra: Partial<Task> = {}): Task => ({
  id, name: 'Квест ' + id, minPlayerLevel: 1, kappaRequired: false, trader: 'Прапор', map: null,
  objectives: [], requires: [], reqs: [], loyalty: 1, traderReqs: [], ...extra,
});
const marks = (...keys: string[]) => Object.fromEntries(keys.map((k) => [k, true])) as Record<string, boolean>;

/** Заглушка uploadMarks: «аккаунт» в памяти, повторная вставка не создаёт дублей */
function fakeAccount() {
  const rows: Record<GameMode, Set<string>> = { regular: new Set(), pve: new Set() };
  const calls: { mode: GameMode; ids: string[] }[] = [];
  const upload = async (mode: GameMode, _user: string, ids: string[]) => {
    if (!ids.length) return;
    calls.push({ mode, ids });
    ids.forEach((id) => rows[mode].add(id));
  };
  return { rows, calls, upload };
}
const modeOf = (m: Record<string, PromoMode>) => (code: string) => promoProgressMode(m[code]);

describe('ключ и режим отметки промокода', () => {
  it('все коды из public/promocodes.json влезают в quest_id (до 64 символов)', () => {
    for (const c of bundled.codes) {
      const k = promoKey(c.code);
      expect(k).toBe(PROMO_PREFIX + c.code);
      expect(k!.length).toBeLessThanOrEqual(64);
    }
  });

  it('слишком длинный код — без ключа (отмечается только в браузере)', () => {
    expect(promoKey('X'.repeat(58))).toHaveLength(64);
    expect(promoKey('X'.repeat(59))).toBeNull();
    expect(promoKey('')).toBeNull();
  });

  it('PvE-коды — в pve, PvP, PvP-сезон и «уточняется» — в regular', () => {
    expect(promoProgressMode('pve')).toBe('pve');
    expect(promoProgressMode('pvp')).toBe('regular');
    expect(promoProgressMode('season')).toBe('regular');
    expect(promoProgressMode('unknown')).toBe('regular');
    expect(promoProgressMode(undefined)).toBe('regular');
  });

  it('отметка читается из любого режима', () => {
    expect(usedInAccount('ABC', marks('promo:ABC'), {})).toBe(true);
    expect(usedInAccount('ABC', {}, marks('promo:ABC'))).toBe(true);
    expect(usedInAccount('ABC', marks('ABC'), {})).toBe(false);
  });

  it('включить — в режиме кода; снять — везде, где стоит', () => {
    expect(promoChanges('ABC', 'pve', true, {}, {})).toEqual({ regular: {}, pve: { 'promo:ABC': true } });
    expect(promoChanges('ABC', 'pve', false, marks('promo:ABC'), marks('promo:ABC')))
      .toEqual({ regular: { 'promo:ABC': false }, pve: { 'promo:ABC': false } });
    expect(promoChanges('ABC', 'regular', false, {}, marks('promo:ABC'))).toEqual({ regular: {}, pve: { 'promo:ABC': false } });
  });
});

describe('перенос usedCodes в аккаунт', () => {
  const modes = modeOf({ PVE1: 'pve', PVP1: 'pvp', SEASON1: 'season', ODD: 'unknown' });

  it('коды раскладываются по режимам, только отмеченные', () => {
    const plan = migrationPlan({ PVE1: true, PVP1: true, SEASON1: true, ODD: true, OFF: false }, [], modes);
    expect(plan.pve).toEqual(['promo:PVE1']);
    expect(plan.regular.sort()).toEqual(['promo:ODD', 'promo:PVP1', 'promo:SEASON1']);
    expect(plan.codes).not.toContain('OFF');
  });

  it('переносит один раз, usedCodes не стирает', async () => {
    localStorage.setItem(USED_KEY, JSON.stringify({ PVE1: true, PVP1: true }));
    const acc = fakeAccount();
    expect(await migrateUsedCodes('u1', modes, acc.upload)).toBe(2);
    expect([...acc.rows.pve]).toEqual(['promo:PVE1']);
    expect([...acc.rows.regular]).toEqual(['promo:PVP1']);
    expect(readUsedLocal()).toEqual({ PVE1: true, PVP1: true });
    expect(readSynced('u1').sort()).toEqual(['PVE1', 'PVP1']);

    // Повторный заход — ничего не отправляем
    acc.calls.length = 0;
    expect(await migrateUsedCodes('u1', modes, acc.upload)).toBe(0);
    expect(acc.calls).toEqual([]);
  });

  it('снятая в аккаунте отметка не возвращается при следующем заходе', async () => {
    localStorage.setItem(USED_KEY, JSON.stringify({ PVE1: true }));
    const acc = fakeAccount();
    await migrateUsedCodes('u1', modes, acc.upload);
    acc.rows.pve.delete('promo:PVE1'); // игрок снял галочку на другом устройстве
    await migrateUsedCodes('u1', modes, acc.upload);
    expect(acc.rows.pve.size).toBe(0);
  });

  it('новая отметка, сделанная без входа, переносится при следующем входе', async () => {
    localStorage.setItem(USED_KEY, JSON.stringify({ PVE1: true }));
    const acc = fakeAccount();
    await migrateUsedCodes('u1', modes, acc.upload);
    localStorage.setItem(USED_KEY, JSON.stringify({ PVE1: true, PVP1: true }));
    acc.calls.length = 0;
    expect(await migrateUsedCodes('u1', modes, acc.upload)).toBe(1);
    expect(acc.calls).toEqual([{ mode: 'regular', ids: ['promo:PVP1'] }]);
  });

  it('переносим только хозяину устройства — первому вошедшему; друг на этом ПК отметок не получает', async () => {
    localStorage.setItem(USED_KEY, JSON.stringify({ PVE1: true }));
    const acc = fakeAccount();
    await migrateUsedCodes('u1', modes, acc.upload);
    expect(readOwner()).toBe('u1');
    acc.calls.length = 0;
    expect(await migrateUsedCodes('u2', modes, acc.upload)).toBe(0);
    expect(acc.calls).toEqual([]);
    expect(localStorage.getItem(syncedKey('u2'))).toBeNull();
    expect(readOwner()).toBe('u1');
  });

  it('хозяином становится первый вошедший, даже если отметок на устройстве нет', async () => {
    expect(await migrateUsedCodes('u2', modes, fakeAccount().upload)).toBe(0);
    expect(readOwner()).toBe('u2');
    expect(claimOwner('u2')).toBe(true);
    expect(claimOwner('u1')).toBe(false);
    expect(localStorage.getItem(OWNER_KEY)).toBe('u2');
  });

  it('зеркало аккаунта в usedCodes: поставленные в аккаунте появляются, снятые — исчезают', () => {
    const long = 'X'.repeat(59); // без ключа — живёт только в браузере, не трогаем
    const local = { PVE1: true, GONE: true, [long]: true } as Record<string, boolean>;
    const m = mirrorLocal(local, marks('promo:PVP1', 'lvl:5', 'q1'), marks('promo:PVE1'));
    expect(m).toEqual({ PVE1: true, PVP1: true, [long]: true });
    expect(sameMarks(m, { PVP1: true, [long]: true, PVE1: true })).toBe(true);
    expect(sameMarks(m, { PVE1: true })).toBe(false);
  });

  it('ошибка записи — коды не считаются перенесёнными, следующий заход повторит', async () => {
    localStorage.setItem(USED_KEY, JSON.stringify({ PVE1: true }));
    const fail = async () => { throw new Error('нет сети'); };
    await expect(migrateUsedCodes('u1', modes, fail)).rejects.toThrow('нет сети');
    expect(readSynced('u1')).toEqual([]);
    const acc = fakeAccount();
    expect(await migrateUsedCodes('u1', modes, acc.upload)).toBe(1);
  });

  it('битый usedCodes — пустой перенос, без ошибки', async () => {
    localStorage.setItem(USED_KEY, 'не json');
    expect(await migrateUsedCodes('u1', modes, fakeAccount().upload)).toBe(0);
    localStorage.setItem(USED_KEY, JSON.stringify({ A: 'yes', B: 1 }));
    expect(readUsedLocal()).toEqual({});
  });

  it('перенос через uploadPlan: уже стоящая в аккаунте отметка не добавляется второй раз', () => {
    expect(uploadPlan(marks('promo:PVE1'), ['promo:PVE1', 'promo:PVP1'])).toEqual({ add: ['promo:PVP1'], remove: [] });
  });
});

describe('ключи promo: не влияют на прогресс', () => {
  const promo = ['promo:TWITCHDROPS', 'promo:PVE1', 'promo:lvl:99'];
  const withPromo = (...keys: string[]) => marks(...keys, ...promo);

  it('ключ promo: распознаётся', () => {
    expect(isPromoKey('promo:X')).toBe(true);
    expect(isPromoKey('t:pass')).toBe(false);
  });

  it('квесты: открытые, уровень и лояльность — как без промокодов', () => {
    const tasks = [task('A'), task('B', { minPlayerLevel: 10 }), task('C', { reqs: [{ id: 'A', status: ['complete'] }] })];
    expect([...openTaskIds(tasks, withPromo(), '')].sort()).toEqual(['A']);
    expect(playerLevel(tasks, withPromo())).toBe(1);
    expect(playerLL(tasks, withPromo(), 'Прапор')).toBe(1);
    expect(availabilityFor(tasks, withPromo('A')).C.state).toBe('open');
  });

  it('счётчик выполненных квестов (как в «Квестах» и в полосе команды) не растёт', () => {
    const tasks = [task('A'), task('B')];
    const done = withPromo('A');
    expect(tasks.filter((t) => done[t.id]).length).toBe(1);
    const ids = new Set(tasks.map((t) => t.id));
    expect([...new Set(Object.keys(done))].filter((id) => ids.has(id)).length).toBe(1);
  });

  it('чистка уровня/ЛЛ и сопутствующие отметки не трогают promo:', () => {
    expect(exclusiveCleanup(withPromo('lvl:5', 'lvl:10'))).toEqual({ 'lvl:5': false });
    expect(withSideMarks({ 'promo:X': true })).toEqual({ 'promo:X': true });
    expect(uploadPlan({}, promo).add.sort()).toEqual([...promo].sort());
    expect(uploadPlan({}, promo).remove).toEqual([]);
  });

  it('Терминал: игрок только с промокодами — без прогресса и не попадает в группу', () => {
    expect(hasTerminalProgress(withPromo())).toBe(false);
    expect(hasTerminalProgress(new Set(promo))).toBe(false);
    expect(chaptersDone(withPromo())).toBe(0);
    expect(summarize(personalSteps(withPromo())).done).toBe(0);
    const team: Member[] = [{ userId: 'a', name: 'А', me: true, done: new Set() }, { userId: 'b', name: 'Б', done: new Set(promo) }];
    expect([...groupIds(team, null)]).toEqual(['a']);
  });
});
