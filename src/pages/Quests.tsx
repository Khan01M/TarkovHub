import { useMemo, useState } from 'react';
import { useData, State, Search, norm, safeUrl } from '../ui';
import { num, loadTasks } from '../api';


function useDone() {
  const [done, setDone] = useState<Record<string, boolean>>(() => { try { return JSON.parse(localStorage.getItem('done') || '{}'); } catch { return {}; } });
  const toggle = (id: string) => setDone((d) => { const n = { ...d, [id]: !d[id] }; localStorage.setItem('done', JSON.stringify(n)); return n; });
  return [done, toggle] as const;
}

export default function Quests() {
  const { data, error, loading } = useData(loadTasks);
  const [q, setQ] = useState('');
  const [trader, setTrader] = useState('');
  const [mapF, setMapF] = useState('');
  const [kappa, setKappa] = useState(false);
  const [hideDone, setHideDone] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [done, toggle] = useDone();

  const tasks = data?.tasks || [];
  const traders = useMemo(() => Array.from(new Set(tasks.map((t: any) => t.trader).filter(Boolean))) as string[], [tasks]);
  const maps = useMemo(() => Array.from(new Set(tasks.map((t: any) => t.map).filter(Boolean))).sort() as string[], [tasks]);
  const list = useMemo(() => {
    const nq = norm(q);
    return tasks
      .filter((t: any) => (!trader || t.trader === trader) && (!mapF || t.map === mapF) && (!kappa || t.kappaRequired) && (!hideDone || !done[t.id]))
      .filter((t: any) => !nq || norm(t.name).includes(nq) || (t.objectives || []).some((o: any) => norm(o.description).includes(nq)))
      .sort((a: any, b: any) => (a.minPlayerLevel || 0) - (b.minPlayerLevel || 0));
  }, [tasks, q, trader, mapF, kappa, hideDone, done]);
  const doneCount = tasks.filter((t: any) => done[t.id]).length;

  return (
    <section>
      <h1>Квесты</h1>
      <p className="lead">Что нужно сделать и где. Отмечайте выполненные — прогресс сохраняется на устройстве.</p>
      {tasks.length > 0 && (
        <div className="progress"><div className="bar"><i style={{ width: `${(doneCount / tasks.length) * 100}%` }} /></div><span className="small">Выполнено {doneCount} из {tasks.length}</span></div>
      )}
      <div className="toolbar">
        <Search value={q} onChange={setQ} placeholder="Название квеста или предмет…" />
        <select value={trader} onChange={(e) => setTrader(e.target.value)}><option value="">Все торговцы</option>{traders.map((t) => <option key={t}>{t}</option>)}</select>
        <select value={mapF} onChange={(e) => setMapF(e.target.value)}><option value="">Все карты</option>{maps.map((m) => <option key={m}>{m}</option>)}</select>
      </div>
      <div className="chips">
        <button className={kappa ? 'chip on' : 'chip'} onClick={() => setKappa(!kappa)}>Нужны для Каппы</button>
        <button className={hideDone ? 'chip on' : 'chip'} onClick={() => setHideDone(!hideDone)}>Скрыть выполненные</button>
      </div>
      <State loading={loading} error={error} />
      <div className="list">
        {list.map((t: any) => (
          <div key={t.id} className={`card quest ${done[t.id] ? 'done' : ''}`}>
            <div className="row-main" onClick={() => setOpen(open === t.id ? null : t.id)}>
              <input type="checkbox" checked={!!done[t.id]} onChange={() => toggle(t.id)} onClick={(e) => e.stopPropagation()} aria-label="Выполнено" />
              <div className="grow">
                <div className="title">{t.name} {t.kappaRequired && <span className="badge">Каппа</span>}</div>
                <div className="muted small">{t.trader} · {t.map || 'любая карта'} · ур. {t.minPlayerLevel || 1}{t.experience ? ` · ${num(t.experience)} опыта` : ''}</div>
              </div>
            </div>
            {open === t.id && (
              <div className="details">
                <ol>{(t.objectives || []).map((o: any, i: number) => <li key={i}>{o.description}{o.optional ? ' (необязательно)' : ''}</li>)}</ol>
                {t.requires?.length > 0 && <div className="muted small">Сначала выполнить: {t.requires.join(', ')}</div>}
                {safeUrl(t.wikiLink) && <a className="link small" href={safeUrl(t.wikiLink)} target="_blank" rel="noreferrer">Подробный гайд в Wiki ↗</a>}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
