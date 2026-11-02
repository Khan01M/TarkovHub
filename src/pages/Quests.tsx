import { useEffect, useMemo, useState } from 'react';
import { useData, State, Search, norm, safeUrl } from '../ui';
import { num, loadTasks, getGameMode, GameMode } from '../api';
import { useProgress, readLegacy, archiveLegacy, addLocal, readLocal, uploadMarks } from '../progress';
import { signIn } from '../auth';

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
  const mode = getGameMode();
  const progress = useProgress(mode);
  const { done, toggle, unsaved } = progress;

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
  const modeLabel = mode === 'pve' ? 'PvE' : 'PvP';

  const card = (t: (typeof tasks)[number]) => (
    <div key={t.id} className={`card quest ${done[t.id] ? 'done' : ''}`}>
      <div className="row-main" onClick={() => setOpen(open === t.id ? null : t.id)}>
        <input type="checkbox" checked={!!done[t.id]} onChange={() => toggle(t.id)} onClick={(e) => e.stopPropagation()} aria-label="Выполнено" disabled={progress.loading} />
        <div className="grow">
          <div className="title">
            {t.name} {t.kappaRequired && <span className="badge">Каппа</span>}
            {!byLoyalty && t.loyalty > 1 && <span className="badge ll">ЛЛ{t.loyalty}</span>}
            {t.id in unsaved && <span className="badge bad">не сохранено</span>}
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
      <ProgressPanel progress={progress} mode={mode} />
      {tasks.length > 0 && (
        <div className="progress"><div className="bar"><i style={{ width: `${(doneCount / tasks.length) * 100}%` }} /></div><span className="small">{modeLabel}: выполнено {doneCount} из {tasks.length}</span></div>
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

type Progress = ReturnType<typeof useProgress>;

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
