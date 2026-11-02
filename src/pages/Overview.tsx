import { useMemo, useState } from 'react';
import { useData, State, Img, safeUrl } from '../ui';
import { getGameMode, rub } from '../api';
import { useProgress } from '../progress';
import { loadQuestData, currentTasks, QuestData, QuestTask, Gunsmith } from '../questdata';

const levelKey = () => `playerLevel:${getGameMode()}`;
const readLevel = () => { try { return Number(localStorage.getItem(levelKey())) || 0; } catch { return 0; } };

const OBJ_ICON: Record<string, string> = {
  visit: '◎', mark: '⚑', plantItem: '⬇', plantQuestItem: '⬇', findQuestItem: '✋', findItem: '✋', giveItem: '⇄', giveQuestItem: '⇄',
  shoot: '⌖', extract: '⇲', buildWeapon: '⚙', useItem: '✱',
};

export default function Overview() {
  const mode = getGameMode();
  const { data, error, loading } = useData(loadQuestData);
  const progress = useProgress(mode);
  const [level, setLevelState] = useState(readLevel);
  const setLevel = (v: number) => { setLevelState(v); try { localStorage.setItem(levelKey(), String(v || '')); } catch { /* ignore */ } };

  const current = useMemo(() => (data ? currentTasks(data, progress.done, level || 999) : []), [data, progress.done, level]);

  return (
    <section>
      <h1>Обзор</h1>
      <p className="lead">Что сейчас в работе: текущие задания, куда идти, что взять с собой в рейд и какие собрать стволы для «Оружейника». Учитываются отмеченные выполненными квесты ({mode === 'pve' ? 'PvE' : 'PvP'}).</p>
      <div className="toolbar level-bar">
        <label className="small">Мой уровень:{' '}
          <input className="search level-input" type="number" min={1} max={79} value={level || ''} placeholder="любой"
            onChange={(e) => setLevel(Math.max(0, Math.min(79, Number(e.target.value) || 0)))} />
        </label>
        <span className="muted small">Текущие задания: те, что не выполнены и для которых выполнены все предыдущие{level ? ` и подходит уровень` : ''}. Уровень лояльности не учитывается.</span>
      </div>
      <State loading={loading || progress.loading} error={error} />
      {data && (
        <>
          <div className="ov-grid">
            <MapPriority data={data} current={current} />
            <GoonTracker data={data} />
          </div>
          <Gunsmiths data={data} current={current} />
          <RaidItems data={data} current={current} />
          <CurrentList data={data} current={current} />
        </>
      )}
    </section>
  );
}

// ---------- Приоритет карт ----------
function MapPriority({ data, current }: { data: QuestData; current: QuestTask[] }) {
  const rows = useMemo(() => {
    const per: Record<string, { tasks: Set<string>; objectives: number }> = {};
    for (const t of current) for (const o of t.objectives) {
      if (o.optional) continue;
      for (const m of new Set(o.maps)) {
        const r = (per[m] ||= { tasks: new Set(), objectives: 0 });
        r.tasks.add(t.id); r.objectives++;
      }
    }
    return Object.entries(per).map(([id, r]) => ({ id, name: data.mapNames[id] || id, tasks: r.tasks.size, objectives: r.objectives }))
      .filter((r) => r.name).sort((a, b) => b.tasks - a.tasks || b.objectives - a.objectives).slice(0, 10);
  }, [data, current]);
  const max = Math.max(1, ...rows.map((r) => r.tasks));
  return (
    <div className="card">
      <h3>Приоритет карт</h3>
      <p className="muted small">Где больше всего ваших текущих заданий.</p>
      {rows.length === 0 && <div className="muted small">Нет заданий, привязанных к картам.</div>}
      {rows.map((r, i) => (
        <a key={r.id} href={`#/maps`} onClick={() => { try { localStorage.setItem('mapById', r.id); } catch { /* ignore */ } }} className="prio-row">
          <span className="prio-n">{i + 1}</span>
          <span className="grow">{r.name}</span>
          <span className="prio-bar"><i style={{ width: `${(r.tasks / max) * 100}%` }} /></span>
          <b>{r.tasks}</b><span className="muted small"> зад.</span>
        </a>
      ))}
      {rows.length > 0 && <p className="muted small">Нажмите на карту — откроется схема с точками заданий.</p>}
    </div>
  );
}

// ---------- Гонщики ----------
function ago(t: number) {
  const min = Math.round((Date.now() - t) / 60000);
  if (min < 60) return `${Math.max(1, min)} мин назад`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} ч назад`;
  return `${Math.round(h / 24)} дн назад`;
}
function GoonTracker({ data }: { data: QuestData }) {
  const r = data.goonReports;
  const last = r[0];
  return (
    <div className="card">
      <h3>Отслеживание Кочевников</h3>
      <p className="muted small">Гонщики — Рыцарь, Птичий Глаз и Большая Труба — кочуют между картами. Последние сообщения игроков (данные tarkov.dev):</p>
      {last ? (
        <>
          <div className="goon-now">Последний раз: <b>{last.map}</b> · {ago(last.time)}</div>
          <ul className="plain goon-list">{r.slice(1, 8).map((x, i) => <li key={i}>{x.map} <span className="muted small">· {ago(x.time)}</span></li>)}</ul>
        </>
      ) : <div className="muted small">Свежих сообщений нет. В этом режиме игроки давно не отмечали Кочевников — проверьте позже или переключитесь на другой режим.</div>}
      <a className="link small" href="#/bosses/knight">Страница Рыцаря →</a>
    </div>
  );
}

// ---------- Оружейник ----------
function Gunsmiths({ data, current }: { data: QuestData; current: QuestTask[] }) {
  const [showAll, setShowAll] = useState(false);
  const curIds = new Set(current.map((t) => t.id));
  const names = new Map(data.tasks.map((t) => [t.id, t]));
  const list = data.gunsmith.filter((g) => showAll || curIds.has(g.taskId));
  return (
    <div className="card ov-block">
      <div className="ov-head">
        <h3>Оружейник</h3>
        <button className={showAll ? 'chip on' : 'chip'} onClick={() => setShowAll(!showAll)}>{showAll ? 'Показаны все части' : 'Показать все части'}</button>
      </div>
      {!showAll && list.length === 0 && <div className="muted small">Сейчас у вас нет взятых частей «Оружейника». Нажмите «Показать все части», чтобы посмотреть любую сборку.</div>}
      <div className="gs-list">
        {list.map((g, i) => <GunsmithCard key={g.taskId + g.weapon} g={g} data={data} task={names.get(g.taskId)} initiallyOpen={i === 0} />)}
      </div>
    </div>
  );
}

function ItemLine({ id, data, note }: { id: string; data: QuestData; note?: string }) {
  const it = data.items[id];
  if (!it) return null;
  return (
    <div className="gs-item">
      <Img src={it.icon} alt="" size={44} />
      <div className="grow">
        <div>{it.name}</div>
        {it.sellers.length > 0
          ? <div className="muted small">{it.sellers.slice(0, 3).join(' · ')}</div>
          : <div className="muted small">У торговцев нет{it.price ? ', только барахолка' : ''}</div>}
        {note && <div className="small gs-note">{note}</div>}
      </div>
      <b className="price">{rub(it.price)}</b>
    </div>
  );
}

function GunsmithCard({ g, data, task, initiallyOpen }: { g: Gunsmith; data: QuestData; task?: QuestTask; initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(!!initiallyOpen);
  const total = [g.weapon, ...g.parts].reduce((s, id) => s + (data.items[id]?.price || 0), 0);
  const opLabel = (op: string) => (op === '>=' ? 'не меньше' : op === '<=' ? 'не больше' : op === '>' ? 'больше' : op === '<' ? 'меньше' : op);
  return (
    <div className="gs-card">
      <button className="gs-title" onClick={() => setOpen(!open)}>
        <span className="grow">{task?.name || 'Оружейник'}</span>
        <span className="muted small">{task?.trader}{task && task.minPlayerLevel > 1 ? ` · ур. ${task.minPlayerLevel}` : ''}</span>
        <span>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="gs-body">
          <div className="gs-col">
            <h4>Основа</h4>
            <ItemLine id={g.weapon} data={data} />
            {g.parts.length > 0 && <h4>Обязательные детали</h4>}
            {g.parts.map((p) => <ItemLine key={p} id={p} data={data} note="Нужна именно эта деталь — замены нет" />)}
            {g.categories.map((c) => (
              <div key={c.id}>
                <h4>Любой модуль: {c.name.toLowerCase()}</h4>
                <div className="muted small">Подойдёт любой совместимый — вот самые дешёвые варианты, чем можно закрыть:</div>
                {c.options.length ? c.options.map((p) => <ItemLine key={p} id={p} data={data} />) : <div className="muted small">Совместимых вариантов не нашлось.</div>}
              </div>
            ))}
            <div className="gs-total">Основа и обязательные детали: <b>{rub(total)}</b></div>
          </div>
          <div className="gs-col">
            <h4>Нужные характеристики</h4>
            {g.reqs.length ? (
              <table className="table gs-reqs"><tbody>
                {g.reqs.map((r) => <tr key={r.key}><td>{r.label}</td><td className="muted">{opLabel(r.op)}</td><td><b>{r.value}{r.unit}</b></td></tr>)}
              </tbody></table>
            ) : <div className="muted small">Особых требований нет.</div>}
            <p className="muted small">Характеристики собранного оружия видно в игре при сборке у Механика. Эргономику поднимают рукоятки, приклады и цевья, отдачу снижают дульные устройства и приклады.</p>
            {safeUrl(task?.wikiLink) && <a className="link small" href={safeUrl(task?.wikiLink)} target="_blank" rel="noreferrer">Гайд по сборке в Wiki ↗</a>}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Что взять в рейд ----------
function RaidItems({ data, current }: { data: QuestData; current: QuestTask[] }) {
  const maps = useMemo(() => {
    const s = new Set<string>();
    current.forEach((t) => t.objectives.forEach((o) => o.maps.forEach((m) => s.add(m))));
    return [...s].filter((m) => data.mapNames[m]).sort((a, b) => data.mapNames[a].localeCompare(data.mapNames[b], 'ru'));
  }, [data, current]);
  const [map, setMap] = useState('');
  const rows = useMemo(() => {
    const keys: Record<string, string[]> = {}; const markers: Record<string, { n: number; tasks: string[] }> = {}; const plant: Record<string, { n: number; tasks: string[] }> = {};
    for (const t of current) for (const o of t.objectives) {
      if (map && !o.maps.includes(map)) continue;
      for (const alts of o.keys) { const k = alts.join('|'); (keys[k] ||= []).includes(t.name) || keys[k].push(t.name); }
      if (o.marker) { const r = (markers[o.marker] ||= { n: 0, tasks: [] }); r.n += o.count || 1; r.tasks.includes(t.name) || r.tasks.push(t.name); }
      for (const p of o.plant) { const r = (plant[p] ||= { n: 0, tasks: [] }); r.n += o.count || 1; r.tasks.includes(t.name) || r.tasks.push(t.name); }
    }
    return { keys, markers, plant };
  }, [current, map]);
  const empty = !Object.keys(rows.keys).length && !Object.keys(rows.markers).length && !Object.keys(rows.plant).length;
  const Row = ({ id, n, tasks }: { id: string; n?: number; tasks: string[] }) => {
    const it = data.items[id];
    return (
      <div className="raid-item">
        <Img src={it?.icon} alt="" size={40} />
        <div className="grow"><div>{it?.name || id}{n && n > 1 ? ` ×${n}` : ''}</div><div className="muted small">{tasks.join(', ')}</div></div>
        {it?.price ? <span className="muted small">{rub(it.price)}</span> : null}
      </div>
    );
  };
  return (
    <div className="card ov-block">
      <div className="ov-head">
        <h3>Что взять в рейд</h3>
        <select value={map} onChange={(e) => setMap(e.target.value)} aria-label="Карта">
          <option value="">Все карты</option>
          {maps.map((m) => <option key={m} value={m}>{data.mapNames[m]}</option>)}
        </select>
      </div>
      {empty && <div className="muted small">Для текущих заданий{map ? ' на этой карте' : ''} ничего особенного брать не нужно.</div>}
      <div className="raid-cols">
        {Object.keys(rows.keys).length > 0 && (
          <div><h4>Ключи</h4>
            {Object.entries(rows.keys).map(([k, tasks]) => {
              const alts = k.split('|');
              return <div key={k}><Row id={alts[0]} tasks={tasks} />{alts.length > 1 && <div className="muted small alt-keys">или: {alts.slice(1).map((a) => data.items[a]?.name || a).join(', ')}</div>}</div>;
            })}
          </div>
        )}
        {Object.keys(rows.markers).length > 0 && (
          <div><h4>Маркеры</h4>{Object.entries(rows.markers).map(([id, r]) => <Row key={id} id={id} n={r.n} tasks={r.tasks} />)}</div>
        )}
        {Object.keys(rows.plant).length > 0 && (
          <div><h4>Заложить</h4>{Object.entries(rows.plant).map(([id, r]) => <Row key={id} id={id} n={r.n} tasks={r.tasks} />)}</div>
        )}
      </div>
    </div>
  );
}

// ---------- Текущие задания ----------
function CurrentList({ data, current }: { data: QuestData; current: QuestTask[] }) {
  const groups = useMemo(() => {
    const g: Record<string, QuestTask[]> = {};
    for (const t of current) {
      const ms = [...new Set(t.objectives.filter((o) => !o.optional).flatMap((o) => o.maps))].filter((m) => data.mapNames[m]);
      const key = ms.length === 1 ? data.mapNames[ms[0]] : ms.length === 0 ? 'Любая карта' : 'Несколько карт';
      (g[key] ||= []).push(t);
    }
    return Object.entries(g).sort((a, b) => b[1].length - a[1].length);
  }, [data, current]);
  return (
    <div className="card ov-block">
      <h3>Текущие задания ({current.length})</h3>
      <p className="muted small">Отмечать выполненными — на странице <a className="link" href="#/quests">Квесты</a>. Точки заданий — на <a className="link" href="#/maps">Картах</a> (слой «Квесты»).</p>
      {groups.map(([name, list]) => (
        <details key={name} open={groups.length <= 3}>
          <summary><b>{name}</b> <span className="muted small">· {list.length}</span></summary>
          <div className="cur-list">
            {list.map((t) => (
              <div key={t.id} className="cur-task">
                <div className="title small">{t.name} <span className="muted">· {t.trader}{t.loyalty > 1 ? ` ЛЛ${t.loyalty}` : ''}</span></div>
                <ul className="plain small">
                  {t.objectives.filter((o) => !o.optional).map((o) => (
                    <li key={o.id}><span className="obj-ico">{OBJ_ICON[o.type] || '•'}</span>{o.description}{o.maps.length > 1 ? <span className="muted"> ({o.maps.map((m) => data.mapNames[m]).filter(Boolean).join(', ')})</span> : null}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}
