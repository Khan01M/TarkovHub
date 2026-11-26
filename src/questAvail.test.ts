import { describe, expect, it } from 'vitest';
import type { Task } from './api';
import {
  availabilityFor, exclusiveCleanup, levelChanges, llChanges, openTaskIds, playerLevel, playerLL,
  storedLevel, storedLL, uploadPlan, withSideMarks,
} from './questAvail';

const task = (id: string, extra: Partial<Task> = {}): Task => ({
  id, name: 'Квест ' + id, minPlayerLevel: 1, kappaRequired: false, trader: 'Прапор', map: null,
  objectives: [], requires: [], reqs: [], loyalty: 1, traderReqs: [], ...extra,
});
const marks = (...keys: string[]) => Object.fromEntries(keys.map((k) => [k, true]));
const open = (tasks: Task[], done: Record<string, boolean>, faction = '') => [...openTaskIds(tasks, done, faction)].sort();

describe('openTaskIds — какие квесты открыты', () => {
  it('уровень ЧВК: закрыт, пока указанный уровень ниже нужного', () => {
    const tasks = [task('A', { minPlayerLevel: 10 })];
    expect(open(tasks, marks('lvl:5'))).toEqual([]);
    expect(open(tasks, marks('lvl:10'))).toEqual(['A']);
    expect(open(tasks, marks('lvl:30'))).toEqual(['A']);
  });

  it('уровень не указан — оценивается по выполненным квестам', () => {
    const tasks = [task('done15', { minPlayerLevel: 15 }), task('B', { minPlayerLevel: 12 }), task('C', { minPlayerLevel: 20 })];
    expect(open(tasks, marks('done15'))).toEqual(['B']);
    expect(playerLevel(tasks, marks('done15'))).toBe(15);
    expect(playerLevel(tasks, {})).toBe(1);
  });

  it('указанный уровень важнее оценки', () => {
    const tasks = [task('done15', { minPlayerLevel: 15 }), task('B', { minPlayerLevel: 12 })];
    expect(playerLevel(tasks, marks('done15', 'lvl:40'))).toBe(40);
  });

  it('ЛЛ торговца: учитывается лояльность именно у торговца квеста', () => {
    const tasks = [task('A', { loyalty: 2 }), task('T', { trader: 'Терапевт', loyalty: 2 })];
    expect(open(tasks, marks('ll:Прапор:1', 'll:Терапевт:2'))).toEqual(['T']);
    expect(open(tasks, marks('ll:Прапор:2', 'll:Терапевт:2'))).toEqual(['A', 'T']);
  });

  it('ЛЛ не указан — оценка по выполненным квестам того же торговца', () => {
    const tasks = [task('p3', { loyalty: 3 }), task('t1', { trader: 'Терапевт', loyalty: 1 })];
    const done = marks('p3');
    expect(playerLL(tasks, done, 'Прапор')).toBe(3);
    expect(playerLL(tasks, done, 'Терапевт')).toBe(1);
  });

  it('фракция: квесты другой фракции спрятаны, без выбранной фракции видны все', () => {
    const tasks = [task('all'), task('bear', { faction: 'BEAR' }), task('usec', { faction: 'USEC' })];
    expect(open(tasks, {}, 'BEAR')).toEqual(['all', 'bear']);
    expect(open(tasks, {}, 'USEC')).toEqual(['all', 'usec']);
    expect(open(tasks, {}, '')).toEqual(['all', 'bear', 'usec']);
  });

  it('цепочка: следующий открывается, когда предыдущий выполнен', () => {
    const tasks = [
      task('A'),
      task('B', { reqs: [{ id: 'A', status: ['complete'] }] }),
      task('C', { reqs: [{ id: 'B', status: ['complete'] }] }),
    ];
    expect(open(tasks, {})).toEqual(['A']);
    expect(open(tasks, marks('A'))).toEqual(['B']);
    expect(open(tasks, marks('A', 'B'))).toEqual(['C']);
    expect(open(tasks, marks('A', 'B', 'C'))).toEqual([]);
  });

  it('несколько требований: нужны все', () => {
    const tasks = [task('A'), task('B'), task('C', { reqs: [{ id: 'A', status: ['complete'] }, { id: 'B', status: ['complete'] }] })];
    expect(open(tasks, marks('A'))).toEqual(['B']);
    expect(open(tasks, marks('A', 'B'))).toEqual(['C']);
  });

  it('требование «взят»: достаточно, чтобы предыдущий был открыт', () => {
    const tasks = [task('A', { minPlayerLevel: 5 }), task('B', { reqs: [{ id: 'A', status: ['active'] }] })];
    expect(open(tasks, marks('lvl:1'))).toEqual([]);
    expect(open(tasks, marks('lvl:5'))).toEqual(['A', 'B']);
  });

  it('требование на квест, которого нет в данных, не блокирует', () => {
    const tasks = [task('B', { reqs: [{ id: 'нет-такого', status: ['complete'] }] })];
    expect(open(tasks, {})).toEqual(['B']);
  });

  it('требование «провален» выполняется отметкой f:<id>', () => {
    const tasks = [task('A'), task('B', { reqs: [{ id: 'A', status: ['failed'] }] })];
    expect(open(tasks, {})).toEqual(['A']);
    const av = availabilityFor(tasks, {});
    expect(av.B.why.join(' ')).toContain('провалить');
    expect(open(tasks, marks('f:A'))).toEqual(['B']);
  });

  it('требование «выполнен или провален»: подходит и то, и другое', () => {
    const tasks = [task('A'), task('B', { reqs: [{ id: 'A', status: ['complete', 'failed'] }] })];
    expect(open(tasks, marks('A'))).toEqual(['B']);
    expect(open(tasks, marks('f:A'))).toEqual(['B']);
  });

  // Квест, требующий ТОЛЬКО провала A, после выполнения A закрыт: в игре такая ветка уже недоступна.
  it('требование только «провален» не выполняется, если предыдущий выполнен', () => {
    const tasks = [task('A'), task('B', { reqs: [{ id: 'A', status: ['failed'] }] })];
    expect(open(tasks, marks('A'))).toEqual([]);
  });

  it('проваленный квест закрыт', () => {
    const tasks = [task('A')];
    expect(open(tasks, marks('f:A'))).toEqual([]);
    expect(availabilityFor(tasks, marks('f:A')).A.state).toBe('locked');
  });

  it('a:<id> — квест взят: открыт, даже если по уровню и цепочке не подходит', () => {
    const tasks = [task('A', { minPlayerLevel: 50 }), task('B', { reqs: [{ id: 'A', status: ['complete'] }] })];
    expect(open(tasks, marks('lvl:1', 'a:B'))).toEqual(['B']);
    expect(availabilityFor(tasks, marks('lvl:1', 'a:B')).B.active).toBe(true);
  });

  it('выполненный квест не считается открытым, даже если стоит a:', () => {
    const tasks = [task('A')];
    expect(open(tasks, marks('A', 'a:A'))).toEqual([]);
  });

  it('торговец закрыт до квеста-«ключа»', () => {
    const tasks = [task('key'), task('J', { trader: 'Егерь', traderUnlock: 'key' })];
    expect(open(tasks, {})).toEqual(['key']);
    expect(open(tasks, marks('key'))).toEqual(['J']);
  });

  it('квест только при отрицательной репутации закрыт', () => {
    expect(open([task('A', { badRep: true })], {})).toEqual([]);
  });

  it('пачки ветки: следующий открывается после нужного числа выполненных в ветке', () => {
    const tasks = [
      task('g1', { gate: { v: 'br', n: 0 } }), task('g2', { gate: { v: 'br', n: 0 } }),
      task('g3', { gate: { v: 'br', n: 2 } }),
    ];
    expect(open(tasks, {})).toEqual(['g1', 'g2']);
    expect(open(tasks, marks('g1'))).toEqual(['g2']);
    expect(open(tasks, marks('g1', 'g2'))).toEqual(['g3']);
    expect(availabilityFor(tasks, {}).g3.estimated).toBe(true);
  });

  it('цикл в данных не зависает', () => {
    const tasks = [task('A', { reqs: [{ id: 'B', status: ['active'] }] }), task('B', { reqs: [{ id: 'A', status: ['active'] }] })];
    expect(() => openTaskIds(tasks, {}, '')).not.toThrow();
  });
});

describe('storedLevel / storedLL — уровень и ЛЛ, указанные игроком', () => {
  it('нет отметки — 0', () => {
    expect(storedLevel({})).toBe(0);
    expect(storedLL({}, 'Прапор')).toBe(0);
  });

  it('при дублях берётся наибольшее', () => {
    expect(storedLevel(marks('lvl:5', 'lvl:12', 'lvl:8'))).toBe(12);
    expect(storedLL(marks('ll:Прапор:1', 'll:Прапор:3', 'll:Прапор:2'), 'Прапор')).toBe(3);
  });

  it('снятые (false) отметки не учитываются', () => {
    expect(storedLevel({ 'lvl:40': false, 'lvl:10': true })).toBe(10);
  });

  it('ЛЛ разных торговцев не смешиваются', () => {
    const m = marks('ll:Прапор:2', 'll:Терапевт:4');
    expect(storedLL(m, 'Прапор')).toBe(2);
    expect(storedLL(m, 'Терапевт')).toBe(4);
    expect(storedLL(m, 'Лыжник')).toBe(0);
  });
});

describe('запись уровня и ЛЛ', () => {
  it('levelChanges: старые значения снимаются, новое ставится', () => {
    expect(levelChanges(marks('lvl:5', 'lvl:7', 'A'), 20)).toEqual({ 'lvl:5': false, 'lvl:7': false, 'lvl:20': true });
  });

  it('levelChanges: то же значение остаётся отмеченным', () => {
    expect(levelChanges(marks('lvl:20'), 20)).toEqual({ 'lvl:20': true });
  });

  it('levelChanges(0) — только снимает', () => {
    expect(levelChanges(marks('lvl:5'), 0)).toEqual({ 'lvl:5': false });
  });

  it('llChanges: трогает только своего торговца', () => {
    expect(llChanges(marks('ll:Прапор:1', 'll:Терапевт:2'), 'Прапор', 3)).toEqual({ 'll:Прапор:1': false, 'll:Прапор:3': true });
    expect(llChanges(marks('ll:Прапор:1'), 'Прапор', 0)).toEqual({ 'll:Прапор:1': false });
  });

  it('exclusiveCleanup: снимает все значения, кроме наибольшего, в каждой группе', () => {
    const m = marks('lvl:5', 'lvl:12', 'll:Прапор:1', 'll:Прапор:3', 'll:Терапевт:2', 'A');
    expect(exclusiveCleanup(m)).toEqual({ 'lvl:5': false, 'll:Прапор:1': false });
  });

  it('exclusiveCleanup: одиночные значения не трогает', () => {
    expect(exclusiveCleanup(marks('lvl:5', 'll:Прапор:1'))).toEqual({});
  });
});

describe('withSideMarks — сопутствующие отметки', () => {
  it('выполнение снимает «взят» и «провален»', () => {
    expect(withSideMarks({ Q: true })).toEqual({ Q: true, 'a:Q': false, 'f:Q': false });
  });

  it('снятие выполнения снимает «взят», но не трогает «провален»', () => {
    expect(withSideMarks({ Q: false })).toEqual({ Q: false, 'a:Q': false });
  });

  it('явно заданные a:/f: не перезаписываются', () => {
    expect(withSideMarks({ Q: true, 'a:Q': true })).toEqual({ Q: true, 'a:Q': true, 'f:Q': false });
  });

  it('ключи с префиксом (цели, убежище, уровень) не порождают сопутствующих', () => {
    const ch = { 'o:obj1': true, 'h:lvl': true, 'lvl:10': true, 'a:X': true };
    expect(withSideMarks(ch)).toEqual(ch);
  });
});

describe('uploadPlan — перенос с устройства в аккаунт', () => {
  it('добавляет только новое', () => {
    expect(uploadPlan(marks('A'), ['A', 'B'])).toEqual({ add: ['B'], remove: [] });
  });

  it('дубли в локальном списке не задваиваются', () => {
    expect(uploadPlan({}, ['B', 'B']).add).toEqual(['B']);
  });

  it('уровень: в аккаунте больше — локальный меньший не переносится', () => {
    expect(uploadPlan(marks('lvl:20'), ['lvl:5', 'A'])).toEqual({ add: ['A'], remove: [] });
  });

  it('уровень: на устройстве больше — в аккаунте меньший снимается, второго lvl: нет', () => {
    const plan = uploadPlan(marks('lvl:5'), ['lvl:12']);
    expect(plan).toEqual({ add: ['lvl:12'], remove: ['lvl:5'] });
  });

  it('ЛЛ: остаётся одно наибольшее значение на торговца', () => {
    const plan = uploadPlan(marks('ll:Прапор:2', 'll:Терапевт:3'), ['ll:Прапор:4', 'll:Терапевт:1']);
    expect(plan).toEqual({ add: ['ll:Прапор:4'], remove: ['ll:Прапор:2'] });
  });

  it('несколько уровней на устройстве — в аккаунт попадает один', () => {
    const plan = uploadPlan({}, ['lvl:3', 'lvl:9', 'lvl:7']);
    expect(plan.add.filter((k) => k.startsWith('lvl:'))).toEqual(['lvl:9']);
  });

  it('«взят»/«провален» для квеста, выполненного в аккаунте или на устройстве, не переносятся', () => {
    expect(uploadPlan(marks('Q'), ['a:Q', 'f:Q']).add).toEqual([]);
    expect(uploadPlan({}, ['R', 'a:R']).add).toEqual(['R']);
    expect(uploadPlan({}, ['a:S']).add).toEqual(['a:S']);
  });
});
