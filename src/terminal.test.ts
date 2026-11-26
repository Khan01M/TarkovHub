import { describe, expect, it } from 'vitest';
import { STORY_CHAPTERS } from './guides';
import {
  ALL_CHAPTERS_DONE, PASS_KEY, chapterChanges, chapterKey, chapterStatusText, chaptersDone, chaptersOutOfOrder,
  currentChapter, currentChapterIndex, fillChapterGaps, linearChapterCount, builtLevel, groupIds, hoursText, personalSteps, routeChanges, routeKey, routeOf,
  stationOrFallback, summarize, teamReadiness, type Member,
} from './terminal';

/** Отметки как в useProgress: { ключ: true } */
const marks = (...keys: string[]) => Object.fromEntries(keys.map((k) => [k, true])) as Record<string, boolean>;
/** Применить изменения к отметкам, как setMarks */
const apply = (done: Record<string, boolean>, ch: Record<string, boolean>) => {
  const out = { ...done };
  for (const [k, v] of Object.entries(ch)) { if (v) out[k] = true; else delete out[k]; }
  return out;
};
const ch = (slug: string) => chapterKey(slug);
const slugs = STORY_CHAPTERS.map((c) => c.slug);

describe('«Где я сейчас»: текущая глава', () => {
  it('линейная часть — Tour, Falling Skies, The Ticket', () => {
    expect(linearChapterCount()).toBe(3);
    expect(slugs.slice(0, 3)).toEqual(['tour', 'falling-skies', 'the-ticket']);
  });

  it('без отметок — первая глава (Tour), в таблице «не отмечено»', () => {
    expect(currentChapterIndex({})).toBe(0);
    expect(currentChapter({})).toBe('tour');
    expect(chapterStatusText({})).toBe('не отмечено');
    expect(chapterStatusText(new Set(['t:pass']))).toBe('не отмечено');
  });

  it('пройден Tour — «на главе Falling Skies»', () => {
    expect(chapterStatusText(marks(ch('tour')))).toBe('на главе Falling Skies');
  });

  it('текущая — первая неотмеченная, даже если дальше есть отметки', () => {
    const d = marks(ch('tour'), ch('the-ticket'));
    expect(currentChapter(d)).toBe('falling-skies');
    expect(chaptersOutOfOrder(d)).toBe(true);
  });

  it('пропуски среди параллельных глав — не нарушение порядка', () => {
    const d = marks(ch('tour'), ch('falling-skies'), ch('the-ticket'), ch('blue-fire'));
    expect(currentChapter(d)).toBe('batya');
    expect(chaptersOutOfOrder(d)).toBe(false);
  });

  it('все отмечены — сюжет пройден', () => {
    const d = marks(...slugs.map(ch));
    expect(currentChapterIndex(d)).toBe(STORY_CHAPTERS.length);
    expect(currentChapter(d)).toBe(ALL_CHAPTERS_DONE);
    expect(chapterStatusText(d)).toBe('сюжет пройден');
    expect(chaptersOutOfOrder(d)).toBe(false);
  });

  it('работает и с Set (отметки товарища из useTeam)', () => {
    expect(currentChapter(new Set([ch('tour'), ch('falling-skies')]))).toBe('the-ticket');
  });
});

describe('«Где я сейчас»: выбор главы', () => {
  it('закрыл Tour, начал Falling Skies → Tour отмечен, остальные сняты', () => {
    const c = chapterChanges('falling-skies');
    expect(c[ch('tour')]).toBe(true);
    for (const s of slugs.slice(1)) expect(c[ch(s)]).toBe(false);
    const d = apply({}, c);
    expect(currentChapter(d)).toBe('falling-skies');
    expect(chaptersDone(d)).toBe(1);
  });

  it('выбор первой главы снимает все отметки', () => {
    const d = apply(marks(...slugs.map(ch), PASS_KEY), chapterChanges('tour'));
    expect(chaptersDone(d)).toBe(0);
    expect(d[PASS_KEY]).toBe(true); // другие отметки не трогаем
  });

  it('выбор линейной главы снимает отметки с неё и всех следующих, включая параллельные', () => {
    const d = apply(marks(ch('tour'), ch('falling-skies'), ch('the-ticket'), ch('batya'), ch('blue-fire')), chapterChanges('falling-skies'));
    expect(Object.keys(d).sort()).toEqual([ch('tour')]);
  });

  it('выбор The Ticket снимает её и все параллельные', () => {
    const d = apply(marks(...slugs.map(ch)), chapterChanges('the-ticket'));
    expect(Object.keys(d).sort()).toEqual([ch('falling-skies'), ch('tour')]);
  });

  it('параллельная глава: линейная часть пройдена, выбранная снята, остальные параллельные не тронуты', () => {
    // Tour, Falling Skies, Батя, Blue Fire → выбирает «Батя»
    const d = apply(marks(ch('tour'), ch('falling-skies'), ch('batya'), ch('blue-fire')), chapterChanges('batya'));
    expect(d[ch('the-ticket')]).toBe(true);      // линейная часть отмечена
    expect(d[ch('batya')]).toBeUndefined();      // выбранная — не пройдена
    expect(d[ch('blue-fire')]).toBe(true);       // параллельная осталась
    expect(currentChapter(d)).toBe('batya');
  });

  it('параллельная глава меняет только линейную часть и себя', () => {
    expect(chapterChanges('blue-fire')).toEqual({
      [ch('tour')]: true, [ch('falling-skies')]: true, [ch('the-ticket')]: true, [ch('blue-fire')]: false,
    });
  });

  it('«весь сюжет пройден» отмечает все главы', () => {
    const d = apply({}, chapterChanges(ALL_CHAPTERS_DONE));
    expect(chaptersDone(d)).toBe(STORY_CHAPTERS.length);
    expect(currentChapter(d)).toBe(ALL_CHAPTERS_DONE);
    expect(chapterStatusText(d)).toBe('сюжет пройден');
  });

  it('выбор линейной главы убирает «дыры»', () => {
    const d = apply(marks(ch('tour'), ch('blue-fire')), chapterChanges('the-ticket'));
    expect(chaptersOutOfOrder(d)).toBe(false);
    expect(currentChapter(d)).toBe('the-ticket');
  });

  it('меняет только ключи глав t:ch:', () => {
    for (const s of [...slugs, ALL_CHAPTERS_DONE]) expect(Object.keys(chapterChanges(s)).every((k) => k.startsWith('t:ch:'))).toBe(true);
  });
});

describe('«Отметить пропущенные»', () => {
  it('отмечена The Ticket без Tour — добавить Tour и Falling Skies', () => {
    expect(fillChapterGaps(marks(ch('the-ticket')))).toEqual({ [ch('tour')]: true, [ch('falling-skies')]: true });
  });

  it('отмечена параллельная глава — добавить всю линейную часть, параллельные не трогать', () => {
    const c = fillChapterGaps(marks(ch('falling-skies'), ch('boreas')));
    expect(c).toEqual({ [ch('tour')]: true, [ch('the-ticket')]: true });
    expect(chaptersOutOfOrder(apply(marks(ch('falling-skies'), ch('boreas')), c))).toBe(false);
  });

  it('только добавляет и ничего не делает, если пропусков нет', () => {
    expect(fillChapterGaps({})).toEqual({});
    expect(fillChapterGaps(marks(ch('tour'), ch('falling-skies')))).toEqual({});
    expect(fillChapterGaps(marks(ch('tour'), ch('falling-skies'), ch('the-ticket'), ch('blue-fire')))).toEqual({});
  });

  it('неизвестная глава — без изменений', () => {
    expect(chapterChanges('no-such-chapter')).toEqual({});
  });
});

describe('путь (концовка)', () => {
  it('выбор пути включает один и снимает остальные; повторный — снимает', () => {
    const d = apply({}, routeChanges({}, 'debtor'));
    expect(routeOf(d)).toBe('debtor');
    expect(routeOf(apply(d, routeChanges(d, 'savior')))).toBe('savior');
    expect(routeOf(apply(d, routeChanges(d, 'debtor')))).toBe(null);
  });
});

describe('личные шаги до Терминала', () => {
  it('без отметок: главы, Разведцентр 1, путь, пропуск; дальше — Tour', () => {
    const s = summarize(personalSteps({}));
    expect(s.total).toBe(5);
    expect(s.done).toBe(0);
    expect(s.next?.label).toContain('Tour');
  });

  it('уровни убежища считаются подряд с первого', () => {
    const st = stationOrFallback(undefined, 'intelligence-center');
    expect(builtLevel(st, marks('h:' + st.levelIds[0], 'h:' + st.levelIds[2]))).toBe(1);
  });

  it('путь «Спасителя» добавляет шаги убежища', () => {
    const d = marks(routeKey('savior'));
    expect(personalSteps(d).length).toBe(7);
  });
});

describe('готовность команды', () => {
  const ready = new Set([ch('tour'), ch('falling-skies'), routeKey('fallen'), PASS_KEY]);
  const noPass = new Set([ch('tour'), ch('falling-skies'), routeKey('fallen')]);
  const team: Member[] = [{ userId: 'a', name: 'А', me: true, done: ready }, { userId: 'b', name: 'Б', done: noPass }];

  it('пропуск каждому — ждём Б', () => {
    const st = teamReadiness(team, 'each');
    expect(st.ready).toBe(false);
    expect(st.waiting).toEqual(['Б (пропуск)']);
  });

  it('один пропуск на группу — готовы', () => {
    expect(teamReadiness(team, 'one').ready).toBe(true);
  });

  it('группа по умолчанию — я и все с отметками t:', () => {
    const t: Member[] = [...team, { userId: 'c', name: 'В', done: new Set(['some-quest']) }];
    expect([...groupIds(t, null)].sort()).toEqual(['a', 'b']);
    expect([...groupIds(t, ['c'])].sort()).toEqual(['a', 'c']);
  });
});

it('hoursText: часы с одной цифрой после запятой', () => {
  expect(hoursText(5.5 * 3600)).toBe('5,5 ч');
});
