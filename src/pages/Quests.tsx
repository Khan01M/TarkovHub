import { useEffect, useMemo, useState } from 'react';
import { useData, State, Search, norm, safeUrl } from '../ui';
import { num, loadTasks, getGameMode, GameMode } from '../api';
import { useProgress, useTeam, Teammate, readLegacy, archiveLegacy, addLocal, readLocal, uploadMarks } from '../progress';
import { signIn } from '../auth';
import { questAvailability, guessLevel, guessLoyalty, storedLevel, storedLL, levelChanges, llChanges } from '../questAvail';
import { parseLogs, marksFromLogs, LogResult, saveRaids } from '../logimport';
import type { Task } from '../api';

function useStored(key: string, initial: string) {
  const [v, setV] = useState<string>(() => { try { return localStorage.getItem(key) || initial; } catch { return initial; } });
  const set = (x: string) => { setV(x); try { localStorage.setItem(key, x); } catch { /* ignore */ } };
  return [v, set] as const;
}

const fmt = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(n);

export default function Quests() {
  const { data, error, loading } = useData(loadTasks);
  const [view, setView] = useStored('questsView', 'loyalty');
  // open — только открытые сейчас (как у торговцев в игре), all — все квесты
  const [scope, setScope] = useStored('questsScope', 'open');
  const [q, setQ] = useState('');
  const [trader, setTrader] = useStored('questsTrader', '');
  const [mapF, setMapF] = useState('');
  const [kappa, setKappa] = useState(false);
  const [hideDone, setHideDone] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const mode = getGameMode();
  const progress = useProgress(mode);
  const { toggle, unsaved } = progress;
  const myDone = progress.done;
  const a = progress.auth;
  const team = useTeam(mode, progress.source === 'account', a.userId, a.name, a.avatar, myDone);
  // Чей прогресс смотрим: '' — свой, иначе id товарища (только просмотр)
  const [viewing, setViewing] = useState('');
  const viewed: Teammate | undefined = viewing ? team.team.find((t) => t.userId === viewing) : undefined;
  const readOnly = !!viewed && !viewed.me;
  const done: Record<string, boolean> = useMemo(() => {
    if (!readOnly) return myDone;
    const o: Record<string, boolean> = {};
    viewed!.done.forEach((id) => { o[id] = true; });
    return o;
  }, [readOnly, viewed, myDone]);
  const others = team.team.filter((t) => t.userId !== (readOnly ? viewed!.userId : a.userId));

  // Уровень ЧВК и лояльность: свои — из настроек (или по выполненным квестам), у товарища — только по его квестам

  const [faction, setFaction] = useStored('questsFaction', '');

  // Квесты только для другой фракции (BEAR/USEC) прячем, если фракция выбрана
  const tasks = useMemo(() => (data?.tasks || []).filter((t) => !faction || !t.faction || t.faction === faction), [data, faction]);
  // Указанные уровень/ЛЛ сохраняются с прогрессом; у товарища видны его значения
  const setByUser = storedLevel(done);
  const level = setByUser || guessLevel(tasks, done);
  const llOf = (tr: string) => storedLL(done, tr) || guessLoyalty(tasks, done, tr);
  const setLevel = (n: number) => progress.setMarks(levelChanges(myDone, n));
  const setLL = (tr: string, n: number) => progress.setMarks(llChanges(myDone, tr, n));
  const avail = useMemo(() => questAvailability(tasks, done, level, llOf), [tasks, done, level]); // eslint-disable-line react-hooks/exhaustive-deps
  const onlyOpen = scope === 'open';
  // Торговцы в игровом порядке, только те, у кого есть квесты
  const traderInfo = useMemo(() => (data?.traders || []).filter((t) => tasks.some((x) => x.trader === t.name)), [data]);
  const traders = traderInfo.map((t) => t.name);
  const maps = useMemo(() => Array.from(new Set(tasks.map((t) => t.map).filter(Boolean))).sort() as string[], [tasks]);

  // В режиме «по лояльности» всегда выбран один торговец
  // В режиме «по лояльности» всегда выбран один торговец; в «открытых» можно выбрать и «все»
  const byLoyalty = !onlyOpen && view === 'loyalty';
  const activeTrader = byLoyalty ? (traders.includes(trader) ? trader : traders[0] || '') : (traders.includes(trader) ? trader : '');
  const openCount = (tr: string) => tasks.filter((t) => (!tr || t.trader === tr) && avail[t.id]?.state === 'open').length;

  const list = useMemo(() => {
    const nq = norm(q);
    return tasks
      .filter((t) => (!activeTrader || t.trader === activeTrader) && (!mapF || t.map === mapF) && (!kappa || t.kappaRequired) && (!hideDone || !done[t.id]))
      .filter((t) => !onlyOpen || avail[t.id]?.state === 'open')
      .filter((t) => !nq || norm(t.name).includes(nq) || t.objectives.some((o) => norm(o.description).includes(nq)))
      .sort((a, b) => (onlyOpen ? Number(!!avail[b.id]?.active) - Number(!!avail[a.id]?.active) : 0) || a.loyalty - b.loyalty || a.minPlayerLevel - b.minPlayerLevel || a.name.localeCompare(b.name, 'ru'));
  }, [tasks, q, activeTrader, mapF, kappa, hideDone, done, onlyOpen, avail]);

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
  const modeLabel = mode === 'pve' ? 'PvE' : 'PvP';

  const objDone = (t: (typeof tasks)[number]) => t.objectives.filter((o) => done['o:' + o.id]).length;

  const card = (t: (typeof tasks)[number]) => (
    <div key={t.id} className={`card quest ${done[t.id] ? 'done' : ''}`}>
      <div className="row-main" onClick={() => setOpen(open === t.id ? null : t.id)}>
        <input type="checkbox" checked={!!done[t.id]} onChange={() => !readOnly && toggle(t.id)} onClick={(e) => e.stopPropagation()} aria-label="Выполнено" disabled={progress.loading || readOnly} />
        <div className="grow">
          <div className="title">
            {t.name} {t.kappaRequired && <span className="badge">Каппа</span>}
            {!byLoyalty && t.loyalty > 1 && <span className="badge ll">ЛЛ{t.loyalty}</span>}
            {t.id in unsaved && <span className="badge bad">не сохранено</span>}
            {avail[t.id]?.active && <span className="badge open">взят</span>}
            {!onlyOpen && avail[t.id]?.state === 'open' && !avail[t.id]?.active && <span className="badge open">открыт</span>}
            {!onlyOpen && avail[t.id]?.state === 'locked' && <span className="badge lock" title={avail[t.id].why.join('; ')}>🔒 закрыт</span>}
          </div>
          {others.some((o) => o.done.has(t.id)) && (
            <div className="also">
              {others.filter((o) => o.done.has(t.id)).map((o) => <Avatar key={o.userId} p={o} small />)}
              <span className="muted small">{others.filter((o) => o.done.has(t.id)).map((o) => o.name).join(', ')} {readOnly ? '' : 'уже выполнил(и)'}</span>
            </div>
          )}
          <div className="muted small">
            {!done[t.id] && objDone(t) > 0 && t.objectives.length > 1 && <span className="obj-count">целей {objDone(t)}/{t.objectives.length} · </span>}
            {byLoyalty ? '' : `${t.trader} · `}{t.map || 'любая карта'} · ур. {t.minPlayerLevel}{t.experience ? ` · ${num(t.experience)} опыта` : ''}
          </div>
        </div>
      </div>
      {open === t.id && (
        <div className="details">
          <ul className="objs">
            {t.objectives.map((o) => {
              const k = 'o:' + o.id;
              const on = !!done[t.id] || !!done[k];
              return (
                <li key={o.id} className={on ? 'on' : ''}>
                  <label>
                    <input type="checkbox" checked={on} disabled={progress.loading || readOnly || !!done[t.id]} onChange={() => toggle(k)} />
                    <span>{o.description}{o.optional ? ' (необязательно)' : ''}{o.give?.fir ? <span className="badge fir" title="Только найденное в рейде">FiR</span> : null}</span>
                  </label>
                  {k in unsaved && <span className="badge bad">не сохранено</span>}
                </li>
              );
            })}
          </ul>
          {!done[t.id] && !readOnly && t.objectives.length > 1 && <div className="muted small">Отмечайте цели по мере выполнения — квест целиком отмечается галочкой в заголовке.</div>}
          {t.loyalty > 1 && <div className="muted small">Нужен уровень лояльности {t.loyalty} у торговца {t.trader}</div>}
          {t.traderReqs.length > 0 && <div className="muted small">Ещё нужно: {t.traderReqs.join(', ')}</div>}
          {t.requires.length > 0 && <div className="muted small">Сначала выполнить: {t.requires.join(', ')}</div>}
          {avail[t.id]?.state === 'locked' && <div className="small lock-why">🔒 Пока закрыт: {avail[t.id].why.join('; ')}{avail[t.id].estimated ? ' (оценка)' : ''}</div>}
          {avail[t.id]?.estimated && avail[t.id].state === 'open' && <div className="small lock-why">Открытие по пачкам квестов (с патча 1.1.0) — сайт оценивает его по выполненным квестам торговца.</div>}
          {safeUrl(t.wikiLink) && <a className="link small" href={safeUrl(t.wikiLink)} target="_blank" rel="noreferrer">Подробный гайд в Wiki ↗</a>}
        </div>
      )}
    </div>
  );

  return (
    <section>
      <h1>Квесты</h1>
      <p className="lead">Что нужно сделать и где. Отмечайте выполненные квесты.</p>
      <ProgressPanel progress={progress} mode={mode} />
      {!readOnly && data && <LogImport progress={progress} tasks={data.tasks} mode={mode} />}
      {team.team.length > 1 && (
        <TeamBar team={team.team} tasks={tasks.map((t) => t.id)} viewing={viewed?.userId || a.userId || ''} onPick={(id) => setViewing(id === a.userId ? '' : id)} onRefresh={team.reload} loading={team.loading} />
      )}
      {team.error && <div className="alert">Не удалось загрузить прогресс команды: {team.error} <button className="btn small" onClick={team.reload}>Повторить</button></div>}
      {readOnly && (
        <div className="alert info">Вы смотрите прогресс игрока <b>{viewed!.name}</b> — только просмотр.{' '}
          <button className="btn small" onClick={() => setViewing('')}>Вернуться к своему</button></div>
      )}
      {tasks.length > 0 && (
        <div className="progress"><div className="bar"><i style={{ width: `${(doneCount / tasks.length) * 100}%` }} /></div><span className="small">{readOnly ? `${viewed!.name}, ` : ''}{modeLabel}: выполнено {doneCount} из {tasks.length}</span></div>
      )}
      <div className="seg scope">
        <button className={onlyOpen ? 'on' : ''} onClick={() => setScope('open')}>Открытые сейчас <b>{openCount('')}</b></button>
        <button className={!onlyOpen ? 'on' : ''} onClick={() => setScope('all')}>Все квесты <b>{tasks.length}</b></button>
      </div>
      {onlyOpen ? (
        <>
          <div className="muted small">Как во вкладке «Задания» у торговцев: квесты, которые можно взять прямо сейчас, — по уровню ЧВК, лояльности и выполненным квестам.</div>
          <div className="me-stats">
            <label>Уровень ЧВК
              <input type="number" min={1} max={79} value={level} disabled={readOnly} onChange={(e) => setLevel(Math.max(1, Math.min(79, Number(e.target.value) || 1)))} />
            </label>
            {activeTrader && (
              <span className="ll-pick">ЛЛ у торговца {activeTrader}:
                {[1, 2, 3, 4].map((n) => <button key={n} disabled={readOnly} className={llOf(activeTrader) === n ? 'on' : ''} onClick={() => setLL(activeTrader, n)}>{n}</button>)}
              </span>
            )}
          </div>
          <div className="me-stats">
            <span className="ll-pick">Фракция:
              {[['', 'обе'], ['BEAR', 'BEAR'], ['USEC', 'USEC']].map(([v, l]) => <button key={v} className={faction === v ? 'on wide' : 'wide'} onClick={() => setFaction(v)}>{l}</button>)}
            </span>
          </div>
          {!readOnly && !setByUser && <div className="muted small">Уровень и лояльность подобраны по выполненным и взятым квестам (минимум, который у вас точно есть) — поправьте, если в игре они выше.</div>}
          <div className="chips">
            <button className={!activeTrader ? 'chip on' : 'chip'} onClick={() => setTrader('')}>Все <b>{openCount('')}</b></button>
            {traders.map((t) => <button key={t} className={t === activeTrader ? 'chip on' : 'chip'} onClick={() => setTrader(t)}>{t} <b>{openCount(t)}</b></button>)}
          </div>
        </>
      ) : (
        <>
          <div className="tabs">
            <button className={byLoyalty ? 'on' : ''} onClick={() => setView('loyalty')}>По уровням лояльности</button>
            <button className={!byLoyalty ? 'on' : ''} onClick={() => setView('list')}>Списком</button>
          </div>
          {byLoyalty && traders.length > 0 && (
            <div className="chips">
              {traders.map((t) => <button key={t} className={t === activeTrader ? 'chip on' : 'chip'} onClick={() => setTrader(t)}>{t}</button>)}
            </div>
          )}
        </>
      )}
      <div className="toolbar">
        <Search value={q} onChange={setQ} placeholder="Название квеста или предмет…" />
        {!byLoyalty && !onlyOpen && (
          <select value={trader} onChange={(e) => setTrader(e.target.value)}><option value="">Все торговцы</option>{traders.map((t) => <option key={t}>{t}</option>)}</select>
        )}
        <select value={mapF} onChange={(e) => setMapF(e.target.value)}><option value="">Все карты</option>{maps.map((m) => <option key={m}>{m}</option>)}</select>
      </div>
      <div className="chips">
        <button className={kappa ? 'chip on' : 'chip'} onClick={() => setKappa(!kappa)}>Нужны для Каппы</button>
        {!onlyOpen && <button className={hideDone ? 'chip on' : 'chip'} onClick={() => setHideDone(!hideDone)}>Скрыть выполненные</button>}
      </div>
      <State loading={loading} error={error} />
      {data && list.length === 0 && <div className="state">{onlyOpen ? 'Открытых квестов нет — проверьте уровень и лояльность или откройте «Все квесты»' : 'Ничего не найдено'}</div>}
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

type Progress = ReturnType<typeof useProgress>;

/** Импорт выполненных квестов из папки Logs игры */
function LogImport({ progress, tasks, mode }: { progress: Progress; tasks: Task[]; mode: GameMode }) {
  const [res, setRes] = useState<LogResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const names = useMemo(() => Object.fromEntries(tasks.map((t) => [t.id, t.name])), [tasks]);
  const { auth, source } = progress;
  const date = (s: number) => new Date(s * 1000).toLocaleDateString('ru-RU');

  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    setBusy(true); setMsg(null); setRes(null);
    try {
      const r = await parseLogs(files);
      if (!r.length) setMsg('В выбранной папке не нашлось сообщений о квестах. Выберите папку Logs в папке Escape from Tarkov.');
      setRes(r);
    } catch (err: any) { setMsg('Не удалось прочитать логи: ' + (err?.message || err)); } finally { setBusy(false); }
  };

  // Применяем всё, что есть в логах, к текущему режиму: выполненные (+ предыдущие по цепочкам),
  // взятые сейчас («a:»), проваленные («f:»), а историю рейдов — на это устройство
  const apply = async (r: LogResult, ids: string[]) => {
    setBusy(true); setMsg(null);
    try {
      const ch: Record<string, boolean> = {};
      for (const id of ids) ch[id] = true;
      for (const id of r.finished) { ch['a:' + id] = false; ch['f:' + id] = false; }
      for (const id of r.started) if (names[id] && !ch[id]) { ch['a:' + id] = true; ch['f:' + id] = false; }
      for (const id of r.failed) if (names[id]) { ch['f:' + id] = true; ch['a:' + id] = false; }
      progress.setMarks(ch);
      const raids = r.raids.length ? saveRaids(r.mode, r.raids) : 0;
      setMsg(`Готово (${r.mode === 'pve' ? 'PvE' : 'PvP'}): выполнено ${ids.length}, взято ${r.started.filter((id) => names[id]).length}, провалено ${r.failed.filter((id) => names[id]).length}` +
        (raids ? `, рейдов в истории: ${raids} (см. Обзор)` : '') + '.');
      setRes(null);
    } catch (err: any) { setMsg('Не удалось сохранить: ' + (err?.message || err) + '. Попробуйте ещё раз.'); } finally { setBusy(false); }
  };

  return (
    <div className="log-import">
      <label className="btn small">
        {busy ? 'Читаю логи…' : 'Импорт из логов игры'}
        <input type="file" multiple hidden disabled={busy} onChange={pick} {...({ webkitdirectory: '', directory: '' } as any)} />
      </label>
      <span className="muted small"> Выберите папку <b>Logs</b> в папке игры (например, D:\Battlestate Games\Escape from Tarkov\Logs) — сайт отметит выполненные квесты. Файлы никуда не отправляются.</span>
      {msg && <div className="alert info">{msg}</div>}
      {res?.map((r) => {
        const m = marksFromLogs(r, tasks);
        const fresh = [...m.fromLog, ...m.inferred].filter((id) => !(r.mode === mode && progress.done[id]));
        return (
          <div key={r.mode} className="alert info">
            <b>{r.mode === 'pve' ? 'PvE' : 'PvP'}</b>: логи с {date(r.from)} по {date(r.to)}, игровых сессий: {r.sessions}.
            Выполнено по логам: <b>{m.fromLog.length}</b>, взято сейчас: {r.started.filter((id) => names[id]).length}{r.failed.length > 0 && <>, провалено: {r.failed.filter((id) => names[id]).length}</>}, рейдов: {r.raids.length}
            {m.inferred.length > 0 && <>, предыдущих квестов по цепочкам: <b>{m.inferred.length}</b></>}.
            {m.unknown > 0 && <span className="muted"> Ивентовых и сюжетных сообщений без квеста в справочнике: {m.unknown}.</span>}
            <details>
              <summary>Что будет отмечено ({fresh.length})</summary>
              <ul className="plain small">
                {m.fromLog.map((id) => <li key={id}>✓ {names[id]}</li>)}
                {m.inferred.map((id) => <li key={id} className="muted">↳ {names[id]} (нужен для следующих)</li>)}
              </ul>
              {r.started.length > 0 && <div className="small muted">Взяты, но не выполнены: {r.started.map((id) => names[id]).filter(Boolean).join(', ')}</div>}
            </details>
            <div className="muted small">Будет обновлено: выполненные квесты (с предыдущими по цепочкам), взятые и проваленные квесты, история рейдов. В логах есть только то, что было за эти даты — более ранние квесты отметьте вручную. Уровень ЧВК, лояльность и убежище игра в логи не пишет — их задайте сами.</div>
            <div>
              {r.mode !== mode ? (
                <span className="small"><b>Переключите режим на {r.mode === 'pve' ? 'PvE' : 'PvP'}</b> вверху страницы и выберите папку ещё раз.</span>
              ) : (
                <button className="btn small" disabled={busy} onClick={() => apply(r, fresh)}>Применить к {r.mode === 'pve' ? 'PvE' : 'PvP'}</button>
              )}
              <button className="btn ghost small" disabled={busy} onClick={() => setRes(null)}>Отмена</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Где хранится прогресс, перенос старых отметок и ошибки сохранения. */
function ProgressPanel({ progress, mode }: { progress: Progress; mode: GameMode }) {
  const { auth, source } = progress;
  const [legacy, setLegacy] = useState(() => readLegacy());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const syncedKey = auth.userId ? `synced:${auth.userId}` : '';
  const [synced, setSynced] = useState(() => { try { return !!syncedKey && !!localStorage.getItem(syncedKey); } catch { return false; } });
  useEffect(() => { try { setSynced(!!syncedKey && !!localStorage.getItem(syncedKey)); } catch { /* ignore */ } }, [syncedKey]);

  const local = { regular: Object.keys(readLocal('regular')), pve: Object.keys(readLocal('pve')) };
  const offerSync = source === 'account' && !synced && legacy.length === 0 && (local.regular.length + local.pve.length) > 0;

  // Старые общие отметки → выбранный режим
  const moveLegacy = async (target: GameMode | null) => {
    setBusy(true); setMsg(null);
    try {
      if (target) {
        if (source === 'account' && auth.userId) await uploadMarks(target, auth.userId, legacy);
        else addLocal(target, legacy);
      }
      archiveLegacy();
      setLegacy([]);
      if (target) setMsg(`Перенесено отметок: ${legacy.length} (${target === 'pve' ? 'PvE' : 'PvP'}).`);
      progress.reload();
    } catch (e: any) {
      setMsg('Не удалось перенести: ' + (e?.message || e) + '. Попробуйте ещё раз.');
    } finally { setBusy(false); }
  };

  // Отметки с этого устройства → аккаунт
  const syncDevice = async (yes: boolean) => {
    setBusy(true); setMsg(null);
    try {
      if (yes && auth.userId) {
        await uploadMarks('regular', auth.userId, local.regular);
        await uploadMarks('pve', auth.userId, local.pve);
        setMsg('Отметки с этого устройства перенесены в аккаунт.');
      }
      try { localStorage.setItem(syncedKey, '1'); } catch { /* ignore */ }
      setSynced(true);
      progress.reload();
    } catch (e: any) {
      setMsg('Не удалось перенести: ' + (e?.message || e) + '. Попробуйте ещё раз.');
    } finally { setBusy(false); }
  };

  return (
    <div className="progress-panel">
      <div className="small muted">
        {source === 'account' && <>Прогресс сохраняется в аккаунте <b>{auth.name}</b> и виден на всех ваших устройствах.</>}
        {source === 'local' && auth.status === 'signedOut' && <>Прогресс сохраняется только на этом устройстве. <button className="linkbtn" onClick={signIn}>Войдите через Discord</button>, чтобы он был виден и на телефоне, и на компьютере.</>}
        {source === 'local' && auth.status === 'denied' && <>У аккаунта <b>{auth.name}</b> нет доступа: вход только для игроков из списка. Прогресс сохраняется на этом устройстве.</>}
        {source === 'local' && auth.status === 'app' && <>Прогресс сохраняется на этом устройстве. Вход в аккаунт доступен на сайте khan01m.github.io/TarkovHub.</>}
        {source === 'local' && (auth.status === 'off' || auth.status === 'loading') && <>Прогресс сохраняется на этом устройстве.</>}
        {source === 'local' && auth.status === 'error' && <>Вход не удался: {auth.error}. Прогресс сохраняется на этом устройстве.</>}
      </div>

      {progress.loading && <div className="state small"><span className="spinner" /> Загружаю прогресс из аккаунта…</div>}
      {progress.loadError && (
        <div className="alert">Не удалось загрузить прогресс из аккаунта: {progress.loadError}
          <button className="btn small" onClick={progress.reload}>Повторить</button></div>
      )}
      {progress.saveError && (
        <div className="alert">Не удалось сохранить отметок: {Object.keys(progress.unsaved).length}. Они остались на экране, но в аккаунт не попали. ({progress.saveError})
          <button className="btn small" onClick={progress.retry}>Повторить</button></div>
      )}

      {legacy.length > 0 && !progress.loading && (auth.status !== 'loading') && (
        <div className="alert info">
          Найдено отметок из прошлой версии сайта: <b>{legacy.length}</b>. Тогда они были общими для PvP и PvE.
          К какому режиму их отнести{source === 'account' ? ' (они сохранятся в аккаунт)' : ''}?
          <div>
            <button className="btn small" disabled={busy} onClick={() => moveLegacy('regular')}>PvP</button>
            <button className="btn small" disabled={busy} onClick={() => moveLegacy('pve')}>PvE</button>
            <button className="btn ghost small" disabled={busy} onClick={() => moveLegacy(null)}>Не переносить</button>
          </div>
        </div>
      )}

      {offerSync && !progress.loading && (
        <div className="alert info">
          На этом устройстве есть отметки: PvP — {local.regular.length}, PvE — {local.pve.length}. Перенести их в аккаунт?
          Уже отмеченные в аккаунте квесты не задвоятся.
          <div>
            <button className="btn small" disabled={busy} onClick={() => syncDevice(true)}>Перенести</button>
            <button className="btn ghost small" disabled={busy} onClick={() => syncDevice(false)}>Не переносить</button>
          </div>
        </div>
      )}
      {msg && <div className="small">{msg}</div>}
    </div>
  );
}

function Avatar({ p, small }: { p: Teammate; small?: boolean }) {
  const size = small ? 18 : 24;
  return p.avatar
    ? <img className="avatar" src={p.avatar} alt="" width={size} height={size} title={p.name} />
    : <span className="avatar ph" style={{ width: size, height: size }} title={p.name}>{p.name.slice(0, 1).toUpperCase()}</span>;
}

/** Команда: кто сколько выполнил в этом режиме; нажатие открывает его список квестов. */
function TeamBar({ team, tasks, viewing, onPick, onRefresh, loading }: {
  team: Teammate[]; tasks: string[]; viewing: string; onPick: (id: string) => void; onRefresh: () => void; loading: boolean;
}) {
  const ids = new Set(tasks);
  return (
    <div className="teambar">
      <span className="small muted">Команда:</span>
      {team.map((t) => {
        const n = [...t.done].filter((id) => ids.has(id)).length;
        return (
          <button key={t.userId} className={`team-chip ${t.userId === viewing ? 'on' : ''}`} onClick={() => onPick(t.userId)} title={t.me ? 'Мой прогресс' : `Посмотреть прогресс: ${t.name}`}>
            <Avatar p={t} />
            <span>{t.me ? 'Я' : t.name}</span>
            <b>{n}</b>
          </button>
        );
      })}
      <button className="linkbtn small" onClick={onRefresh} disabled={loading}>{loading ? 'Обновляю…' : 'Обновить'}</button>
    </div>
  );
}
