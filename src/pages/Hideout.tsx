// Убежище: построенные уровни модулей и сводка «что нужно» для квестов и убежища.
// Уровни хранятся вместе с прогрессом квестов (ключ «h:<id уровня>»), запас предметов — на устройстве.
import { useCallback, useMemo, useState } from 'react';
import { useData, State, Search, norm, Img } from '../ui';
import { loadHideout, loadTasks, loadItems, getGameMode, rub, num } from '../api';
import type { Item, Station, HideoutLevel, Task } from '../api';
import { useProgress } from '../progress';
import ItemModal from '../components/ItemModal';

const MONEY: Record<string, string> = { '5449016a4bdc2d6f028b456f': '₽', '5696686a4bdc2da3298b456a': '$', '569668774bdc2da2298b4568': '€' };

function useStored(key: string, initial: string) {
  const [v, setV] = useState<string>(() => { try { return localStorage.getItem(key) || initial; } catch { return initial; } });
  const set = (x: string) => { setV(x); try { localStorage.setItem(key, x); } catch { /* ignore */ } };
  return [v, set] as const;
}

/** Сколько предметов уже есть — только на этом устройстве, отдельно для PvP и PvE */
function useHave(mode: string) {
  const key = `have:${mode}`;
  const [have, setHaveState] = useState<Record<string, number>>(() => { try { return JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch { return {}; } });
  const setHave = useCallback((id: string, n: number) => {
    setHaveState((h) => {
      const next = { ...h };
      if (n > 0) next[id] = Math.min(99999, Math.floor(n)); else delete next[id];
      try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, [key]);
  return { have, setHave };
}

const hours = (sec: number) => {
  if (!sec) return 'сразу';
  const h = sec / 3600;
  return h >= 24 ? `${num(h / 24, 1)} д.` : h >= 1 ? `${num(h, 1)} ч` : `${Math.round(sec / 60)} мин`;
};

export default function Hideout() {
  const hideout = useData(loadHideout);
  const tasks = useData(loadTasks);
  const items = useData(loadItems);
  const mode = getGameMode();
  const progress = useProgress(mode);
  const { done, setMarks } = progress;
  const { have, setHave } = useHave(mode);
  const [tab, setTab] = useStored('hideoutTab', 'stations');
  const [open, setOpen] = useState<Item | null>(null);

  const byId = useMemo(() => {
    const m: Record<string, Item> = {};
    for (const it of items.data?.items || []) m[it.id] = it;
    return m;
  }, [items.data]);

  const stations = hideout.data?.stations || [];
  const stationById = useMemo(() => Object.fromEntries(stations.map((s) => [s.id, s])), [stations]);
  /** Построенный уровень: сколько уровней подряд отмечено с первого */
  const built = useCallback((s: Station) => {
    let n = 0;
    for (const l of s.levels) { if (done['h:' + l.id]) n = l.level; else break; }
    return n;
  }, [done]);
  const setBuilt = (s: Station, level: number) => {
    const ch: Record<string, boolean> = {};
    for (const l of s.levels) ch['h:' + l.id] = l.level <= level;
    setMarks(ch);
  };

  return (
    <section>
      <h1>Убежище</h1>
      <p className="lead">Отмечайте построенные уровни модулей — сайт покажет, что нужно для следующих, и соберёт общий список предметов для убежища и квестов.</p>
      <div className="small muted">
        {progress.source === 'account' ? <>Уровни модулей сохраняются в аккаунте <b>{progress.auth.name}</b>. </> : <>Уровни модулей сохраняются на этом устройстве. </>}
        Запас предметов («есть») хранится на этом устройстве.
      </div>
      {progress.saveError && <div className="alert">Не удалось сохранить: {progress.saveError} <button className="btn small" onClick={progress.retry}>Повторить</button></div>}
      <div className="tabs">
        <button className={tab === 'stations' ? 'on' : ''} onClick={() => setTab('stations')}>Модули</button>
        <button className={tab === 'items' ? 'on' : ''} onClick={() => setTab('items')}>Нужные предметы</button>
      </div>
      <State loading={hideout.loading || (tab === 'items' && (tasks.loading || items.loading))} error={hideout.error || tasks.error || items.error} />
      {hideout.data && tab === 'stations' && (
        <Stations stations={stations} stationById={stationById} built={built} setBuilt={setBuilt} byId={byId} have={have} onItem={setOpen} disabled={progress.loading} />
      )}
      {hideout.data && tasks.data && items.data && tab === 'items' && (
        <Needs stations={stations} built={built} tasks={tasks.data.tasks} done={done} byId={byId} have={have} setHave={setHave} onItem={setOpen} />
      )}
      {open && <ItemModal item={open} allItems={items.data?.items} onClose={() => setOpen(null)} onOpen={setOpen} />}
    </section>
  );
}

// ---------- модули ----------
function Stations({ stations, stationById, built, setBuilt, byId, have, onItem, disabled }: {
  stations: Station[]; stationById: Record<string, Station>; built: (s: Station) => number; setBuilt: (s: Station, l: number) => void;
  byId: Record<string, Item>; have: Record<string, number>; onItem: (it: Item) => void; disabled: boolean;
}) {
  const [filter, setFilter] = useState('');
  const levelOf = (id: string) => (stationById[id] ? built(stationById[id]) : 0);
  const canBuild = (l?: HideoutLevel) => !!l && l.stations.every((r) => levelOf(r.id) >= r.level);
  const list = stations.filter((s) => {
    const b = built(s), next = s.levels.find((l) => l.level === b + 1);
    if (filter === 'can') return canBuild(next);
    if (filter === 'todo') return !!next;
    return true;
  });
  const total = stations.reduce((a, s) => a + s.levels.length, 0);
  const doneLv = stations.reduce((a, s) => a + built(s), 0);

  return (
    <>
      <div className="progress"><div className="bar"><i style={{ width: `${total ? (doneLv / total) * 100 : 0}%` }} /></div><span className="small">Построено уровней: {doneLv} из {total}</span></div>
      <div className="chips">
        {[['', 'Все'], ['can', 'Можно строить'], ['todo', 'Не достроены']].map(([v, l]) => (
          <button key={v} className={filter === v ? 'chip on' : 'chip'} onClick={() => setFilter(v)}>{l}</button>
        ))}
      </div>
      {list.length === 0 && <div className="state">Ничего не найдено</div>}
      <div className="hd-grid">
        {list.map((s) => {
          const b = built(s);
          const next = s.levels.find((l) => l.level === b + 1);
          const ok = canBuild(next);
          return (
            <div key={s.id} className={`card hd-card ${!next ? 'max' : ''}`}>
              <div className="hd-head">
                {s.image ? <img src={s.image} alt="" width={44} height={44} loading="lazy" /> : null}
                <div className="grow">
                  <div className="title">{s.name}</div>
                  <div className="muted small">{!next ? 'Построен полностью' : b === 0 ? 'Не построен' : `Уровень ${b} из ${s.levels.length}`}</div>
                </div>
                {next && <span className={`badge ${ok ? '' : 'warn'}`}>{ok ? 'можно строить' : 'нужны модули'}</span>}
              </div>
              <div className="hd-levels" role="group" aria-label="Построенный уровень">
                {[0, ...s.levels.map((l) => l.level)].map((lv) => (
                  <button key={lv} disabled={disabled} className={lv === b ? 'on' : lv < b ? 'past' : ''} onClick={() => setBuilt(s, lv)} title={lv === 0 ? 'Не построен' : `Построен уровень ${lv}`}>{lv === 0 ? '—' : lv}</button>
                ))}
              </div>
              {next && (
                <div className="hd-next">
                  <div className="small"><b>Для уровня {next.level}:</b> <span className="muted">строится {hours(next.time)}</span></div>
                  {(next.stations.length > 0 || next.traders.length > 0 || next.skills.length > 0) && (
                    <div className="hd-reqs">
                      {next.stations.map((r) => {
                        const met = levelOf(r.id) >= r.level;
                        return <span key={r.id} className={`tag ${met ? 'ok' : 'no'}`}>{met ? '✓' : '✗'} {stationById[r.id]?.name || '?'} {r.level}</span>;
                      })}
                      {next.traders.map((r, i) => <span key={'t' + i} className="tag">{r.name} ЛЛ{r.level}</span>)}
                      {next.skills.map((r, i) => <span key={'s' + i} className="tag">{r.name} {r.level}</span>)}
                    </div>
                  )}
                  <div className="hd-items">
                    {next.items.map((r) => {
                      const it = byId[r.id];
                      const money = MONEY[r.id];
                      const got = have[r.id] || 0;
                      return (
                        <button key={r.id} className={`hd-item ${!money && got >= r.count ? 'got' : ''}`} onClick={() => it && onItem(it)} title={it?.name || ''}>
                          <Img src={it?.iconLink} alt="" size={36} />
                          <span className="grow">{money ? `${num(r.count)} ${money}` : it?.shortName || it?.name || '?'}</span>
                          {!money && <b>{got > 0 ? `${Math.min(got, r.count)}/` : '×'}{r.count}</b>}
                          {r.fir && <span className="badge fir" title="Только найденное в рейде">FiR</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

// ---------- сводка нужных предметов ----------
type Use = { label: string; count: number; fir: boolean; kind: 'quest' | 'hideout' };
type Need = { id: string; total: number; fir: number; uses: Use[] };
type Choice = { key: string; label: string; text: string; count: number; fir: boolean; items: string[] };

function Needs({ stations, built, tasks, done, byId, have, setHave, onItem }: {
  stations: Station[]; built: (s: Station) => number; tasks: Task[]; done: Record<string, true>;
  byId: Record<string, Item>; have: Record<string, number>; setHave: (id: string, n: number) => void; onItem: (it: Item) => void;
}) {
  const [src, setSrc] = useStored('needsSrc', 'all');          // all | quests | hideout
  const [scope, setScope] = useStored('needsScope', 'next');    // next — только следующий уровень модулей, all — все
  const [firOnly, setFirOnly] = useState(false);
  const [hideGot, setHideGot] = useState(false);
  const [q, setQ] = useState('');
  const [sort, setSort] = useStored('needsSort', 'uses');
  const [openId, setOpenId] = useState<string | null>(null);

  const { needs, choices, money } = useMemo(() => {
    const m: Record<string, Need> = {};
    const money: Record<string, number> = {};
    const choices: Choice[] = [];
    const add = (id: string, count: number, fir: boolean, use: Use) => {
      if (MONEY[id]) { money[id] = (money[id] || 0) + count; return; }
      const n = (m[id] ||= { id, total: 0, fir: 0, uses: [] });
      n.total += count; if (fir) n.fir += count; n.uses.push(use);
    };
    if (src !== 'hideout') {
      for (const t of tasks) {
        if (done[t.id]) continue;
        for (const o of t.objectives) {
          if (!o.give || done['o:' + o.id]) continue;
          const g = o.give;
          if (g.items.length === 1) add(g.items[0], g.count, g.fir, { label: t.name, count: g.count, fir: g.fir, kind: 'quest' });
          else choices.push({ key: o.id, label: t.name, text: o.description, count: g.count, fir: g.fir, items: g.items });
        }
      }
    }
    if (src !== 'quests') {
      for (const s of stations) {
        const b = built(s);
        for (const l of s.levels) {
          if (l.level <= b || (scope === 'next' && l.level > b + 1)) continue;
          for (const r of l.items) add(r.id, r.count, r.fir, { label: `${s.name} ${l.level}`, count: r.count, fir: r.fir, kind: 'hideout' });
        }
      }
    }
    return { needs: Object.values(m), choices, money };
  }, [src, scope, tasks, done, stations, built]);

  const nq = norm(q);
  const list = needs
    .filter((n) => !firOnly || n.fir > 0)
    .filter((n) => !hideGot || (have[n.id] || 0) < n.total)
    .filter((n) => !nq || norm(byId[n.id]?.name || '').includes(nq) || norm(byId[n.id]?.shortName || '').includes(nq) || n.uses.some((u) => norm(u.label).includes(nq)))
    .sort((a, b) => {
      const ra = Math.max(0, a.total - (have[a.id] || 0)), rb = Math.max(0, b.total - (have[b.id] || 0));
      if ((ra === 0) !== (rb === 0)) return ra === 0 ? 1 : -1; // собранное — в конец
      const price = (n: Need) => (byId[n.id]?.avg24hPrice || 0) * Math.max(0, n.total - (have[n.id] || 0));
      const d = sort === 'count' ? rb - ra : sort === 'price' ? price(b) - price(a) : sort === 'name' ? 0 : b.uses.length - a.uses.length || rb - ra;
      return d || (byId[a.id]?.name || '').localeCompare(byId[b.id]?.name || '', 'ru');
    });
  const left = needs.reduce((a, n) => a + Math.max(0, n.total - (have[n.id] || 0)), 0);

  return (
    <>
      <div className="chips">
        {[['all', 'Квесты и убежище'], ['quests', 'Только квесты'], ['hideout', 'Только убежище']].map(([v, l]) => (
          <button key={v} className={src === v ? 'chip on' : 'chip'} onClick={() => setSrc(v)}>{l}</button>
        ))}
      </div>
      <div className="chips">
        {src !== 'quests' && <button className={scope === 'next' ? 'chip on' : 'chip'} onClick={() => setScope(scope === 'next' ? 'all' : 'next')} title="Для убежища: считать только ближайший уровень каждого модуля">Только следующий уровень модулей</button>}
        <button className={firOnly ? 'chip on' : 'chip'} onClick={() => setFirOnly(!firOnly)}>Найденное в рейде (FiR)</button>
        <button className={hideGot ? 'chip on' : 'chip'} onClick={() => setHideGot(!hideGot)}>Скрыть собранное</button>
      </div>
      <div className="toolbar">
        <Search value={q} onChange={setQ} placeholder="Предмет, квест или модуль…" />
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Сортировка">
          <option value="uses">Нужны в большем числе мест</option>
          <option value="count">Больше осталось собрать</option>
          <option value="price">Дороже собрать</option>
          <option value="name">По названию</option>
        </select>
      </div>
      <div className="small muted">
        Предметов: {needs.length} видов, ещё собрать {num(left)} шт.
        {Object.keys(money).length > 0 && <> · Деньги на модули: {Object.entries(money).map(([id, v]) => `${num(v)} ${MONEY[id]}`).join(', ')}</>}
        {' '}· Выполненные квесты и отмеченные цели не учитываются.
      </div>

      <div className="list needs">
        {list.map((n) => {
          const it = byId[n.id];
          const got = have[n.id] || 0;
          const rest = Math.max(0, n.total - got);
          return (
            <div key={n.id} className={`card need ${rest === 0 ? 'got' : ''}`}>
              <div className="row-main">
                <button className="need-img" onClick={() => it && onItem(it)} title="Открыть предмет"><Img src={it?.iconLink} alt="" size={44} /></button>
                <div className="grow" onClick={() => setOpenId(openId === n.id ? null : n.id)}>
                  <div className="title">{it?.name || n.id}</div>
                  <div className="muted small">
                    нужно {n.total}{n.fir > 0 && <> (FiR: {n.fir})</>} · {n.uses.length} {n.uses.length === 1 ? 'место' : 'мест'}
                    {it?.avg24hPrice ? ` · ${rub(it.avg24hPrice)}` : ''}
                  </div>
                </div>
                <div className="have">
                  <button onClick={() => setHave(n.id, got - 1)} disabled={got <= 0} aria-label="Меньше">−</button>
                  <input inputMode="numeric" value={got} onChange={(e) => setHave(n.id, Number(e.target.value.replace(/\D/g, '')) || 0)} aria-label="Есть" />
                  <button onClick={() => setHave(n.id, got + 1)} aria-label="Больше">+</button>
                  <span className="small">{rest === 0 ? '✓' : `ещё ${rest}`}</span>
                </div>
              </div>
              {openId === n.id && (
                <div className="details">
                  {n.uses.map((u, i) => (
                    <div key={i} className="kv"><span>{u.kind === 'quest' ? '✓ ' : '▣ '}{u.label}</span><b>{u.count}{u.fir ? ' FiR' : ''}</b></div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {emptyState(list.length, needs.length)}

      {choices.length > 0 && src !== 'hideout' && (
        <>
          <h3>Квесты «любой из списка»</h3>
          <div className="muted small">Можно сдать любой подходящий предмет — в общий список они не попали.</div>
          <div className="list">
            {choices.filter((c) => !nq || norm(c.label + ' ' + c.text).includes(nq)).map((c) => (
              <div key={c.key} className="card choice">
                <div className="title">{c.label} {c.fir && <span className="badge fir">FiR</span>}</div>
                <div className="muted small">{c.text}</div>
                <div className="choice-items">
                  {c.items.slice(0, 12).map((id) => byId[id] ? (
                    <button key={id} className="choice-item" onClick={() => onItem(byId[id])} title={byId[id].name}><Img src={byId[id].iconLink} alt="" size={32} /></button>
                  ) : null)}
                  {c.items.length > 12 && <span className="muted small">и ещё {c.items.length - 12}</span>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

const emptyState = (shown: number, all: number) =>
  shown === 0 ? <div className="state">{all === 0 ? 'Ничего собирать не нужно 🎉' : 'Ничего не найдено'}</div> : null;
