import { describe, expect, it } from 'vitest';
import type { Task } from './api';
import { locName, marksFromLogs, parseLogs, readRaids, saveRaids, type LogResult } from './logimport';

// Форматы — как в папке Logs игры: log_<дата>_<версия>/<дата>_<версия> application_000.log и push-notifications_000.log
const DIR = 'log_2025.01.08_20-10-03_0.16.0.2.34510';
const file = (name: string, text: string, dir = DIR) => {
  const f = new File([text], name);
  Object.defineProperty(f, 'webkitRelativePath', { value: dir ? `Logs/${dir}/${name}` : '' });
  return f;
};

const appLine = (time: string, loc: string, shortId: string) =>
  `${time}.123|0.16.0.2.34510|Info|application|TRACE-NetworkGameCreate profileStatus: 'Profileid: 6612aa, Status: Busy, RaidMode: Online, Ip: 1.2.3.4, Port: 17000, Location: ${loc}, Sid: abc, GameMode: deathmatch, shortId: ${shortId}'`;

const app = (mode: 'Pve' | 'Regular', ...raids: string[]) => [
  `2025-01-08 20:10:05.001|0.16.0.2.34510|Info|application|Application awaken, updateQueue:'Update'`,
  `2025-01-08 20:10:09.002|0.16.0.2.34510|Info|application|Session mode: ${mode}`,
  ...raids,
  '',
].join('\n');

// Сообщение торговца в push-notifications: type 10 — взят, 11 — провален, 12 — выполнен
const push = (type: number, dt: number, questId: string, suffix = 'successMessageText') =>
  `2025-01-08 20:30:00.000|0.16.0.2.34510|Info|push-notifications|Got notification | ChatMessageReceived
{
  "type": "new_message",
  "eventId": "e${dt}",
  "dialogId": "5935c25fb3acc3127c3d8cd9",
  "message": {
    "_id": "m${dt}",
    "uid": "5935c25fb3acc3127c3d8cd9",
    "type": ${type},
    "dt": ${dt},
    "hasRewards": true,
    "text": "${questId} ${suffix}",
    "templateId": "${questId} ${suffix} 0",
    "systemData": {}
  }
}
`;

const Q1 = '5936d90786f7742b1420ba5b';
const Q2 = '5936da9e86f7742d65037edf';
const Q3 = '59674cd986f7744ab26e32f2';

describe('parseLogs — разбор логов игры', () => {
  it('последнее событие по квесту побеждает: взят → выполнен', async () => {
    const [r] = await parseLogs([
      file('2025.01.08_20-10-03_0.16.0.2.34510 application_000.log', app('Regular')),
      file('2025.01.08_20-10-03_0.16.0.2.34510 push-notifications_000.log',
        push(10, 1736356000, Q1) + push(12, 1736357000, Q1) + push(10, 1736358000, Q2) + push(11, 1736359000, Q3)),
    ]);
    expect(r.mode).toBe('regular');
    expect(r.finished).toEqual([Q1]);
    expect(r.started).toEqual([Q2]);
    expect(r.failed).toEqual([Q3]);
    expect(r.sessions).toBe(1);
    expect(r.from).toBe(1736356000);
    expect(r.to).toBe(1736359000);
  });

  it('порядок по времени, а не по порядку в файле', async () => {
    const [r] = await parseLogs([
      file('x push-notifications_000.log', push(12, 1736357000, Q1) + push(10, 1736356000, Q1)),
    ]);
    expect(r.finished).toEqual([Q1]);
    expect(r.started).toEqual([]);
  });

  it('режим PvE определяется по строке «Session mode»', async () => {
    const res = await parseLogs([
      file('a application_000.log', app('Pve')),
      file('a push-notifications_000.log', push(12, 1736357000, Q1)),
    ]);
    expect(res.map((r) => r.mode)).toEqual(['pve']);
  });

  it('рейды из application-лога: время, карта, shortId', async () => {
    const [r] = await parseLogs([
      file('a application_000.log', app('Pve', appLine('2025-01-08 20:17:03', 'bigmap', 'ABC123'), appLine('2025-01-08 21:02:44', 'Sandbox_high', 'Z9X8Y7'))),
    ]);
    expect(r.mode).toBe('pve');
    expect(r.raids.map((x) => [x.id, x.map])).toEqual([['ABC123', 'bigmap'], ['Z9X8Y7', 'Sandbox_high']]);
    expect(r.raids[0].t).toBe(new Date('2025-01-08T20:17:03').getTime());
    expect(r.finished).toEqual([]);
    expect(r.sessions).toBe(1);
  });

  it('две папки разных режимов — два результата, PvE первым', async () => {
    const res = await parseLogs([
      file('a application_000.log', app('Regular'), 'log_A'),
      file('a push-notifications_000.log', push(12, 1736357000, Q1), 'log_A'),
      file('b application_000.log', app('Pve'), 'log_B'),
      file('b push-notifications_000.log', push(12, 1736358000, Q2), 'log_B'),
    ]);
    expect(res.map((r) => [r.mode, r.finished])).toEqual([['pve', [Q2]], ['regular', [Q1]]]);
  });

  it('без webkitRelativePath папка берётся из имени файла', async () => {
    const res = await parseLogs([
      file('2025.01.08_20-10-03_0.16.0.2.34510 application_000.log', app('Pve'), ''),
      file('2025.01.08_20-10-03_0.16.0.2.34510 push-notifications_000.log', push(12, 1736357000, Q1), ''),
    ]);
    expect(res.map((r) => [r.mode, r.finished])).toEqual([['pve', [Q1]]]);
  });

  it('прочие файлы логов игнорируются, пустой набор — пустой результат', async () => {
    expect(await parseLogs([file('a backend_000.log', push(12, 1736357000, Q1))])).toEqual([]);
    expect(await parseLogs([])).toEqual([]);
  });

  it('прочие типы сообщений (не 10–12) не учитываются', async () => {
    const [r] = await parseLogs([file('a push-notifications_000.log', push(12, 1736357000, Q1) + push(4, 1736358000, Q2, 'description'))]);
    expect(r.finished).toEqual([Q1]);
    expect([...r.started, ...r.failed]).toEqual([]);
  });
});

describe('locName — названия карт', () => {
  it.each([
    ['bigmap', 'Таможня'], ['Woods', 'Лес'], ['TarkovStreets', 'Улицы Таркова'], ['Sandbox_high', 'Эпицентр'],
    ['factory4_night', 'Завод (ночь)'], ['factory4_xmas', 'Завод'], ['Sandbox_event', 'Эпицентр (заражённая)'],
    ['NewMap', 'newmap'],
  ])('%s → %s', (id, name) => {
    expect(locName(id)).toBe(name);
  });
});

describe('история рейдов на устройстве', () => {
  it('без дублей, новые сверху, отдельно по режимам', () => {
    saveRaids('pve', [{ id: 'A', t: 1, map: 'bigmap' }, { id: 'B', t: 3, map: 'woods' }]);
    expect(saveRaids('pve', [{ id: 'A', t: 1, map: 'bigmap' }, { id: 'C', t: 2, map: 'lighthouse' }])).toBe(3);
    expect(readRaids('pve').map((r) => r.id)).toEqual(['B', 'C', 'A']);
    expect(readRaids('regular')).toEqual([]);
  });

  it('хранится не больше 500 последних', () => {
    saveRaids('pve', Array.from({ length: 600 }, (_, i) => ({ id: 'r' + i, t: i, map: 'bigmap' })));
    const list = readRaids('pve');
    expect(list).toHaveLength(500);
    expect(list[0].id).toBe('r599');
  });
});

describe('marksFromLogs — что отметить выполненным', () => {
  const t = (id: string, reqs: Task['reqs'] = []) => ({ id, reqs } as Task);
  const tasks = [
    t('A'), t('B', [{ id: 'A', status: ['complete'] }]), t('C', [{ id: 'B', status: ['complete'] }]),
    t('D', [{ id: 'C', status: ['active'] }]), t('E', [{ id: 'A', status: ['failed'] }]),
  ];
  const res = (p: Partial<LogResult>): LogResult => ({ mode: 'pve', finished: [], started: [], failed: [], raids: [], sessions: 1, from: 0, to: 0, ...p });

  it('выполненный по логам + вся цепочка «выполнен» до него', () => {
    const m = marksFromLogs(res({ finished: ['C'] }), tasks);
    expect(m.fromLog).toEqual(['C']);
    expect(m.inferred.sort()).toEqual(['A', 'B']);
  });

  it('взятый квест тоже выводит выполненными предыдущие', () => {
    expect(marksFromLogs(res({ started: ['B'] }), tasks).inferred).toEqual(['A']);
  });

  it('требования «взят»/«провален» не выводятся выполненными', () => {
    expect(marksFromLogs(res({ finished: ['D'] }), tasks).inferred).toEqual([]);
    expect(marksFromLogs(res({ finished: ['E'] }), tasks).inferred).toEqual([]);
  });

  it('выполненный по логам не дублируется в выведенных; неизвестные id считаются', () => {
    const m = marksFromLogs(res({ finished: ['A', 'C', 'zzz'] }), tasks);
    expect(m.fromLog.sort()).toEqual(['A', 'C']);
    expect(m.inferred).toEqual(['B']);
    expect(m.unknown).toBe(1);
  });
});
