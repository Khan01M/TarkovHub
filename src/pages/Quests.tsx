import { useMemo, useState } from 'react';
import { useData, State, Search, norm, safeUrl } from '../ui';
import { num, loadTasks } from '../api';

function useDone() {
  const [done, setDone] = useState<Record<string, boolean>>(() => { try { return JSON.parse(localStorage.getItem('done') || '{}'); } catch { return {}; } });
  const toggle = (id: string) => setDone((d) => { const n = { ...d, [id]: !d[id] }; try { localStorage.setItem('done', JSON.stringify(n)); } catch { /* ignore */ } return n; });
  return [done, toggle] as const;
}

function useStored(key: string, initial: string) {
  const [v, setV] = useState<string>(() => { try { return localStorage.getItem(key) || initial; } catch { return initial; } });
  const set = (x: string) => { setV(x); try { localStorage.setItem(key, x); } catch { /* ignore */ } };
  return [v, set] as const;
}

const fmt = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(n);

export default function Quests() {
  const { data, error, loading } = useData(loadTasks);
  const [view, setView] = useStored('questsView', 'loyalty');
  const [q, setQ] = useState('');
  const [trader, setTrader] = useStored('questsTrader', '');
  const [mapF, setMapF] = useState('');
  const [kappa, setKappa] = useState(false);
  const [hideDone, setHideDone] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [done, toggle] = useDone();

  const tasks = data?.tasks || [];
  // Торговцы в игровом порядке, только те, у кого есть квесты
  const traderInfo = useMemo(() => (data?.traders || []).filter((t) => tasks.some((x) => x.trader === t.name)), [data]);
  const traders = traderInfo.map((t) => t.name);
  const maps = useMemo(() => Array.from(new Set(tasks.map((t) => t.map).filter(Boolean))).sort() as string[], [tasks]);

  // В режиме «по лояльности» всегда выбран один торговец
  const byLoyalty = view === 'loyalty';
  const activeTrader = byLoyalty ? (traders.includes(trader) ? trader : traders[0] || '') : trader;

  const list = useMemo(() => {
    const nq = norm(q);
    return tasks
      .filter((t) => (!activeTrader || t.trader === activeTrader) && (!mapF || t.map === mapF) && (!kappa || t.kappaRequired) && (!hideDone || !done[t.id]))
      .filter((t) => !nq || norm(t.name).includes(nq) || t.objectives.some((o) => norm(o.description).includes(nq)))
      .sort((a, b) => a.loyalty - b.loyalty || a.minPlayerLevel - b.minPlayerLevel || a.name.localeCompare(b.name, 'ru'));
  }, [tasks, q, activeTrader, mapF, kappa, hideDone, done]);

  const groups = useMemo(() => {
    if (!byLoyalty) return [];
    const info = traderInfo.find((t) => t.name === activeTrader);
    const levels = new Set<number>(list.map((t) => t.loyalty));
    return [...levels].sort((a, b) => a - b).map((ll) => {
      const lvl = info?.levels.find((l) => l.level === ll);
      const all = tasks.filter((t) => t.trader === activeTrader && t.loyalty === ll);
      return {
        ll, items: list.filter((t) => t.loyalty === ll),
        req: ll > 1 && lvl ? `нужен ${lvl.playerLevel} уровень${lvl.reputation ? ` и репутация ${fmt(lvl.reputation)}` : ''}` : 'доступно сразу',
        doneCount: all.filter((t) => done[t.id]).length, total: all.length,
      };
    });
  }, [byLoyalty, list, traderInfo, activeTrader, tasks, done]);

  const doneCount = tasks.filter((t) => done[t.id]).length;

  const card = (t: (typeof tasks)[number]) => (
    <div key={t.id} className={`card quest ${done[t.id] ? 'done' : ''}`}>
      <div className="row-main" onClick={() => setOpen(open === t.id ? null : t.id)}>
        <input type="checkbox" checked={!!done[t.id]} onChange={() => toggle(t.id)} onClick={(e) => e.stopPropagation()} aria-label="Выполнено" />
        <div className="grow">
          <div className="title">
            {t.name} {t.kappaRequired && <span className="badge">Каппа</span>}
            {!byLoyalty && t.loyalty > 1 && <span className="badge ll">ЛЛ{t.loyalty}</span>}
          </div>
          <div className="muted small">
            {byLoyalty ? '' : `${t.trader} · `}{t.map || 'любая карта'} · ур. {t.minPlayerLevel}{t.experience ? ` · ${num(t.experience)} опыта` : ''}
          </div>
        </div>
      </div>
      {open === t.id && (
        <div className="details">
          <ol>{t.objectives.map((o, i) => <li key={i}>{o.description}{o.optional ? ' (необязательно)' : ''}</li>)}</ol>
          {t.loyalty > 1 && <div className="muted small">Нужен уровень лояльности {t.loyalty} у торговца {t.trader}</div>}
          {t.traderReqs.length > 0 && <div className="muted small">Ещё нужно: {t.traderReqs.join(', ')}</div>}
          {t.requires.length > 0 && <div className="muted small">Сначала выполнить: {t.requires.join(', ')}</div>}
          {safeUrl(t.wikiLink) && <a className="link small" href={safeUrl(t.wikiLink)} target="_blank" rel="noreferrer">Подробный гайд в Wiki ↗</a>}
        </div>
      )}
    </div>
  );

  return (
    <section>
      <h1>Квесты</h1>
      <p className="lead">Что нужно сделать и где. Отмечайте выполненные — прогресс сохраняется на устройстве.</p>
      {tasks.length > 0 && (
        <div className="progress"><div className="bar"><i style={{ width: `${(doneCount / tasks.length) * 100}%` }} /></div><span className="small">Выполнено {doneCount} из {tasks.length}</span></div>
      )}
      <div className="tabs">
        <button className={byLoyalty ? 'on' : ''} onClick={() => setView('loyalty')}>По уровням лояльности</button>
        <button className={!byLoyalty ? 'on' : ''} onClick={() => setView('list')}>Списком</button>
      </div>
      {byLoyalty && traders.length > 0 && (
        <div className="chips">
          {traders.map((t) => <button key={t} className={t === activeTrader ? 'chip on' : 'chip'} onClick={() => setTrader(t)}>{t}</button>)}
        </div>
      )}
      <div className="toolbar">
        <Search value={q} onChange={setQ} placeholder="Название квеста или предмет…" />
        {!byLoyalty && (
          <select value={trader} onChange={(e) => setTrader(e.target.value)}><option value="">Все торговцы</option>{traders.map((t) => <option key={t}>{t}</option>)}</select>
        )}
        <select value={mapF} onChange={(e) => setMapF(e.target.value)}><option value="">Все карты</option>{maps.map((m) => <option key={m}>{m}</option>)}</select>
      </div>
      <div className="chips">
        <button className={kappa ? 'chip on' : 'chip'} onClick={() => setKappa(!kappa)}>Нужны для Каппы</button>
        <button className={hideDone ? 'chip on' : 'chip'} onClick={() => setHideDone(!hideDone)}>Скрыть выполненные</button>
      </div>
      <State loading={loading} error={error} />
      {data && list.length === 0 && <div className="state">Ничего не найдено</div>}
      {byLoyalty ? (
        groups.map((g) => (
          <div key={g.ll} className="ll-group">
            <div className="ll-head">
              <span className="ll-num">ЛЛ{g.ll}</span>
              <span className="muted small grow">{g.req}</span>
              <span className="small">{g.doneCount} / {g.total}</span>
            </div>
            <div className="list">{g.items.map(card)}</div>
          </div>
        ))
      ) : (
        <div className="list">{list.map(card)}</div>
      )}
    </section>
  );
}
