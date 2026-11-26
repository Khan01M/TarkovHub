import { useMemo, useState } from 'react';
import { useData, State, Img, safeUrl } from '../ui';
import { getGameMode, rub } from '../api';
import { storedLevel, levelChanges } from '../questAvail';
import { readRaids, locName } from '../logimport';
import { useProgress, useLazyNumber } from '../progress';
import { loadQuestData, useOpenTaskIds, QuestData, QuestTask, Gunsmith } from '../questdata';


const OBJ_ICON: Record<string, string> = {
  visit: '◎', mark: '⚑', plantItem: '⬇', plantQuestItem: '⬇', findQuestItem: '✋', findItem: '✋', giveItem: '⇄', giveQuestItem: '⇄',
  shoot: '⌖', extract: '⇲', buildWeapon: '⚙', useItem: '✱',
};

export default function Overview() {
  const mode = getGameMode();
  const { data, error, loading } = useData(loadQuestData);
  const progress = useProgress(mode);
  // Уровень и лояльность — общие со страницей «Квесты» (хранятся вместе с прогрессом)
  const level = storedLevel(progress.done);
  // Пустое поле — «любой» (уровень оценивается по квестам); сохраняем по уходу с поля, Enter или паузе
  const levelInput = useLazyNumber(level, (s) => {
    const v = s.trim() === '' ? 0 : Math.max(0, Math.min(79, Math.floor(Number(s)) || 0));
    if (v !== storedLevel(progress.done)) progress.setMarks((cur) => levelChanges(cur, v)).catch(() => { /* saveError */ });
  }, 600, !progress.canEdit);

  // Текущие = открытые сейчас у торговцев (то же правило, что на странице «Квесты»)
  const open = useOpenTaskIds(progress.done);
  const openIds = open.ids;
  const current = useMemo(() => (data && openIds ? data.tasks.filter((t) => openIds.has(t.id)) : []), [data, openIds]);

  return (
    <section>
      <h1>Обзор</h1>
      <p className="lead">Что сейчас в работе: текущие задания, куда идти, что взять с собой в рейд и какие собрать стволы для «Оружейника». Учитываются отмеченные выполненными квесты ({mode === 'pve' ? 'PvE' : 'PvP'}).</p>
      <div className="toolbar level-bar">
        <label className="small">Мой уровень:{' '}
          <input className="search level-input" type="number" min={1} max={79} placeholder="любой" disabled={!progress.canEdit} {...levelInput} />
        </label>
        <span className="muted small">Текущие задания — те, что открыты сейчас у торговцев: по уровню, лояльности и выполненным квестам. Лояльность и фракция задаются на странице <a className="link" href="#/quests">Квесты</a>.</span>
      </div>
      {progress.loadError && (
        <div className="alert">Не удалось загрузить прогресс из аккаунта: {progress.loadError}. Текущие задания могут быть неточными.
          <button className="btn small" onClick={progress.reload}>Повторить</button></div>
      )}
      <State loading={loading || progress.loading || open.loading} error={error || (open.error && `список квестов не загрузился (${open.error}) — текущие задания не посчитать`)} />
      {data && (
        <>
          <div className="ov-grid">
            {openIds && <MapPriority data={data} current={current} />}
            <GoonTracker data={data} />
          </div>
          <RaidHistory mode={mode} />
          {openIds && (
            <>
              <Gunsmiths data={data} current={current} />
              <RaidItems data={data} current={current} done={progress.done} />
              <CurrentList data={data} current={current} />
            </>
          )}
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
type Need = { id: string; n: number; alts?: string[] };
type TaskNeeds = { task: QuestTask; maps: string[]; keys: Need[]; markers: Need[]; plant: Need[] };

/** Что нужно взять под каждое текущее задание, с картами. Выполненные цели не учитываются. */
function taskNeeds(data: QuestData, current: QuestTask[], done: Record<string, boolean>): TaskNeeds[] {
  const out: TaskNeeds[] = [];
  for (const t of current) {
    const r: TaskNeeds = { task: t, maps: [], keys: [], markers: [], plant: [] };
    const add = (list: Need[], id: string, n: number, alts?: string[]) => {
      const x = list.find((y) => y.id === id);
      if (x) x.n += n; else list.push({ id, n, alts });
    };
    for (const o of t.objectives) {
      if (done['o:' + o.id]) continue;
      const before = r.keys.length + r.markers.length + r.plant.length;
      for (const alts of o.keys) if (!r.keys.some((k) => k.id === alts[0])) r.keys.push({ id: alts[0], n: 1, alts: alts.slice(1) });
      if (o.marker) add(r.markers, o.marker, o.count || 1);
      for (const p of o.plant) add(r.plant, p, o.count || 1);
      if (r.keys.length + r.markers.length + r.plant.length > before) for (const m of o.maps) if (data.mapNames[m] && !r.maps.includes(m)) r.maps.push(m);
    }
    if (r.keys.length || r.markers.length || r.plant.length) out.push(r);
  }
  return out;
}

function RaidItems({ data, current, done }: { data: QuestData; current: QuestTask[]; done: Record<string, boolean> }) {
  const [by, setBy] = useState<'map' | 'quest'>(() => { try { return (localStorage.getItem('raidBy') as 'map' | 'quest') || 'map'; } catch { return 'map'; } });
  const setByS = (v: 'map' | 'quest') => { setBy(v); try { localStorage.setItem('raidBy', v); } catch { /* ignore */ } };
  const needs = useMemo(() => taskNeeds(data, current, done), [data, current, done]);
  const ANY = '*';
  // Карты с числом заданий, которым что-то нужно; «*» — задания без конкретной карты
  const maps = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of needs) for (const m of r.maps.length ? r.maps : [ANY]) c[m] = (c[m] || 0) + 1;
    return Object.entries(c).sort((a, b) => b[1] - a[1] || (data.mapNames[a[0]] || 'я').localeCompare(data.mapNames[b[0]] || 'я', 'ru'));
  }, [needs, data]);
  const [map, setMap] = useState('');
  const activeMap = maps.some(([m]) => m === map) ? map : maps[0]?.[0] || '';
  const mapName = (m: string) => (m === ANY ? 'Любая карта' : data.mapNames[m] || m);
  const onMap = needs.filter((r) => (r.maps.length ? r.maps.includes(activeMap) : activeMap === ANY));
  const [openQ, setOpenQ] = useState<string | null>(null);

  // Итого на один рейд: ключи без повторов, маркеры и закладки суммой
  const total = useMemo(() => {
    const keys: Record<string, { alts?: string[]; tasks: string[] }> = {}, cnt: Record<string, { n: number; tasks: string[] }> = {};
    for (const r of onMap) {
      for (const k of r.keys) { const x = (keys[k.id] ||= { alts: k.alts, tasks: [] }); x.tasks.push(r.task.name); }
      for (const k of [...r.markers, ...r.plant]) { const x = (cnt[k.id] ||= { n: 0, tasks: [] }); x.n += k.n; x.tasks.push(r.task.name); }
    }
    return { keys, cnt };
  }, [onMap]);

  const Row = ({ id, n, note, alts }: { id: string; n?: number; note?: string; alts?: string[] }) => {
    const it = data.items[id];
    return (
      <div className="raid-item">
        <Img src={it?.icon} alt="" size={36} />
        <div className="grow">
          <div>{it?.name || id}{n && n > 1 ? <b> ×{n}</b> : ''}</div>
          {alts && alts.length > 0 && <div className="muted small">или: {alts.map((a) => data.items[a]?.name || a).join(', ')}</div>}
          {note && <div className="muted small">{note}</div>}
        </div>
        {it?.price ? <span className="muted small">{rub(it.price)}</span> : null}
      </div>
    );
  };
  const Items = ({ r }: { r: TaskNeeds }) => (
    <>
      {r.keys.map((k) => <Row key={'k' + k.id} id={k.id} alts={k.alts} note="ключ" />)}
      {r.markers.map((k) => <Row key={'m' + k.id} id={k.id} n={k.n} note="маркер" />)}
      {r.plant.map((k) => <Row key={'p' + k.id} id={k.id} n={k.n} note="заложить" />)}
    </>
  );

  return (
    <div className="card ov-block">
      <div className="ov-head">
        <h3>Что взять в рейд</h3>
        <div className="seg small-seg">
          <button className={by === 'map' ? 'on' : ''} onClick={() => setByS('map')}>По локациям</button>
          <button className={by === 'quest' ? 'on' : ''} onClick={() => setByS('quest')}>По квестам</button>
        </div>
      </div>
      {needs.length === 0 && <div className="muted small">Для текущих заданий ключи, маркеры и закладки не нужны.</div>}

      {by === 'map' && needs.length > 0 && (
        <>
          <div className="chips">
            {maps.map(([m, n]) => <button key={m} className={m === activeMap ? 'chip on' : 'chip'} onClick={() => setMap(m)}>{mapName(m)} <b>{n}</b></button>)}
          </div>
          <div className="raid-total">
            <h4>Взять на {mapName(activeMap)}</h4>
            {Object.entries(total.keys).map(([id, x]) => <Row key={'k' + id} id={id} alts={x.alts} note={`ключ · ${x.tasks.join(', ')}`} />)}
            {Object.entries(total.cnt).map(([id, x]) => <Row key={'c' + id} id={id} n={x.n} note={x.tasks.join(', ')} />)}
          </div>
          <h4>По заданиям на этой карте</h4>
          <div className="raid-tasks">
            {onMap.map((r) => (
              <details key={r.task.id} className="raid-task">
                <summary><b>{r.task.name}</b> <span className="muted small">· {r.task.trader} · {r.keys.length + r.markers.length + r.plant.length} предм.</span></summary>
                <Items r={r} />
              </details>
            ))}
          </div>
        </>
      )}

      {by === 'quest' && needs.length > 0 && (
        <div className="raid-tasks">
          {needs.map((r) => (
            <div key={r.task.id} className="raid-task">
              <button className="raid-q" onClick={() => setOpenQ(openQ === r.task.id ? null : r.task.id)} aria-expanded={openQ === r.task.id}>
                <span className="grow"><b>{r.task.name}</b> <span className="muted small">· {r.task.trader}</span></span>
                <span className="muted small">{r.maps.length ? r.maps.map(mapName).join(', ') : 'любая карта'}</span>
                <span className="small">{openQ === r.task.id ? '▲' : '▼'}</span>
              </button>
              {openQ === r.task.id && <Items r={r} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Мои рейды (из логов игры) ----------
function RaidHistory({ mode }: { mode: string }) {
  const raids = useMemo(() => readRaids(mode as any), [mode]);
  if (!raids.length) return (
    <div className="card ov-block">
      <h3>Мои рейды</h3>
      <div className="muted small">Пока пусто. Импортируйте логи игры на странице <a className="link" href="#/quests">Квесты</a> — здесь появится история рейдов по картам.</div>
    </div>
  );
  const byMap: Record<string, number> = {};
  for (const r of raids) byMap[locName(r.map)] = (byMap[locName(r.map)] || 0) + 1;
  const week = raids.filter((r) => r.t > Date.now() - 7 * 864e5).length;
  const fmt = (t: number) => new Date(t).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  return (
    <div className="card ov-block">
      <h3>Мои рейды <span className="muted small">· всего {raids.length}, за неделю {week}</span></h3>
      <div className="chips">
        {Object.entries(byMap).sort((a, b) => b[1] - a[1]).map(([m, n]) => <span key={m} className="chip">{m} <b>{n}</b></span>)}
      </div>
      <div className="raid-hist">
        {raids.slice(0, 8).map((r) => <div key={r.id} className="kv"><span>{locName(r.map)}</span><span className="muted small">{fmt(r.t)}</span></div>)}
      </div>
      <div className="muted small">По логам игры, хранится на этом устройстве. Обновляется при импорте логов.</div>
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
