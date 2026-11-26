import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import bundled from '../../public/promocodes.json';
import { uploadMarks, useProgress } from '../progress';
import {
  migrateUsedCodes, mirrorLocal, promoChanges, promoKey, promoProgressMode, readOwner, readUsedLocal, sameMarks, usedInAccount, writeUsedLocal,
} from '../promo';

// Список промокодов живёт в public/promocodes.json.
// Сайт и приложения (EXE, APK) берут свежую версию с сайта, поэтому для
// обновления кодов достаточно поправить этот файл и сделать push — переустанавливать ничего не нужно.
// Без сети показывается копия, встроенная в приложение при сборке.
const LIVE_URL = 'https://khan01m.github.io/TarkovHub/promocodes.json';

type Code = {
  code: string; mode: 'pve' | 'season' | 'pvp' | 'unknown'; status: 'active' | 'check' | 'expired';
  added?: string; event?: string; rewards: string; noteText?: string;
};
type PromoFile = { updated: string; note: string; codes: Code[] };

const MODE: Record<Code['mode'], string> = {
  pve: 'PvE', season: 'PvP-сезон', pvp: 'PvP', unknown: 'режим уточняется',
};
const STATUS: Record<Code['status'], { label: string; cls: string }> = {
  active: { label: 'Работает', cls: 'ok' },
  check: { label: 'Проверьте', cls: 'warn' },
  expired: { label: 'Истёк', cls: 'bad' },
};

// Файл с сайта читают все установленные EXE/APK, поэтому доверять ему нельзя:
// берём только записи с понятными полями, остальные молча отбрасываем.
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const has = (o: object, k: unknown) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
function cleanCode(x: any): Code | null {
  if (!x || typeof x !== 'object') return null;
  const code = str(x.code)?.trim();
  if (!code) return null;
  if (!has(STATUS, x.status) || !has(MODE, x.mode)) return null;
  return {
    code, mode: x.mode, status: x.status, rewards: str(x.rewards) || '',
    added: str(x.added), event: str(x.event), noteText: str(x.noteText),
  };
}
function cleanPromo(d: any): PromoFile | null {
  if (!d || typeof d !== 'object' || !Array.isArray(d.codes)) return null;
  const seen = new Set<string>();
  const codes = (d.codes as unknown[]).map(cleanCode).filter((c): c is Code => {
    if (!c || seen.has(c.code)) return false; // повтор кода сломал бы key в списке
    seen.add(c.code); return true;
  });
  return { updated: str(d.updated) || '', note: str(d.note) || '', codes };
}

function usePromo() {
  const [data, setData] = useState<PromoFile>(() => cleanPromo(bundled) || { updated: '', note: '', codes: [] });
  const [live, setLive] = useState(false);
  useEffect(() => {
    const url = location.hostname.endsWith('github.io') ? './promocodes.json' : LIVE_URL;
    let saved = false; // X-TH-Cache: 1 — без сети ответил service worker своей копией (public/sw.js)
    fetch(url, { cache: 'no-cache' })
      .then((r) => (r.ok ? ((saved = r.headers.get('X-TH-Cache') === '1'), r.json()) : Promise.reject()))
      .then((d: unknown) => {
        const clean = cleanPromo(d);
        // Если с сайта пришёл мусор без единого годного кода — остаёмся на встроенной копии
        if (clean && (clean.codes.length > 0 || (d as any).codes.length === 0)) { setData(clean); setLive(!saved); }
      })
      .catch(() => { /* остаёмся на встроенной копии */ });
  }, []);
  return { data, live };
}

const noop = () => { /* ошибку показывает saveError */ };

/** Отметки «Я уже активировал»: без входа — в браузере, у игрока из списка — в аккаунте (см. promo.ts) */
function useUsed(codes: Code[]) {
  const regular = useProgress('regular');
  const pve = useProgress('pve');
  const auth = regular.auth;
  const account = regular.source === 'account' && pve.source === 'account' ? auth.userId || null : null;
  // Аккаунт «прочитан», когда оба режима прошли загрузку после входа. Сразу после входа useProgress
  // ещё на кадр отдаёт локальные отметки с loading=false — поэтому ждём, пока загрузка начнётся и кончится.
  const sawLoading = useRef('');
  if (account && (regular.loading || pve.loading)) sawLoading.current = account;
  const settled = !!account && sawLoading.current === account && !regular.loading && !pve.loading;
  const ready = settled && regular.canEdit && pve.canEdit;
  const [local, setLocal] = useState(readUsedLocal);

  const modeOf = useMemo(() => {
    const m = new Map(codes.map((c) => [c.code, c.mode]));
    return (code: string) => promoProgressMode(m.get(code));
  }, [codes]);

  // usedCodes этого устройства — отметки его хозяина (первого вошедшего); у других аккаунтов их не показываем
  const owner = readOwner();
  const mine = !!account && (!owner || owner === account);

  // Однократный перенос отметок из браузера в аккаунт хозяина
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [migratedFor, setMigratedFor] = useState('');
  const started = useRef('');
  useEffect(() => {
    if (!ready || !account || started.current === account) return;
    started.current = account;
    setSyncing(true); setSyncError(null);
    migrateUsedCodes(account, modeOf, uploadMarks)
      // Перенесли — перечитываем аккаунт и только потом убираем «идёт перенос», чтобы галочки не мигали
      .then((n) => (n ? Promise.all([regular.reload(), pve.reload()]) : undefined))
      .then(() => setMigratedFor(account))
      .catch((e: any) => { started.current = ''; setSyncError(e?.message || String(e)); })
      .finally(() => setSyncing(false));
  }, [ready, account]); // eslint-disable-line react-hooks/exhaustive-deps

  // После переноса usedCodes хозяина повторяют аккаунт: после выхода браузер показывает то же, что было в аккаунте
  useEffect(() => {
    if (!ready || syncing || !account || migratedFor !== account || readOwner() !== account) return;
    const n = mirrorLocal(local, regular.done, pve.done);
    if (!sameMarks(local, n)) { writeUsedLocal(n); setLocal(n); }
  }, [ready, syncing, account, migratedFor, local, regular.done, pve.done]);

  const inAccount = (code: string) => !!account && !!promoKey(code);
  // Пока аккаунт грузится или перенос не закончен, хозяину показываем и отметки из браузера, чтобы галочки не мигали
  const showLocal = mine && (!ready || syncing || migratedFor !== account);
  const isUsed = useCallback((code: string) => (!!account && !!promoKey(code)
    ? usedInAccount(code, regular.done, pve.done) || (showLocal && !!local[code])
    : !!local[code]), [account, showLocal, local, regular.done, pve.done]);
  const canToggle = (code: string) => !inAccount(code) || (ready && !syncing);

  const toggle = (c: Code) => {
    if (inAccount(c.code)) {
      if (!canToggle(c.code)) return;
      const ch = promoChanges(c.code, promoProgressMode(c.mode), !isUsed(c.code), regular.done, pve.done);
      if (Object.keys(ch.regular).length) regular.setMarks(ch.regular).catch(noop);
      if (Object.keys(ch.pve).length) pve.setMarks(ch.pve).catch(noop);
      return;
    }
    setLocal((u) => {
      const n = { ...u };
      if (n[c.code]) delete n[c.code]; else n[c.code] = true;
      writeUsedLocal(n);
      return n;
    });
  };

  const loadError = account ? regular.loadError || pve.loadError : null;
  const saveError = account ? regular.saveError || pve.saveError : null;
  const retry = () => {
    if (regular.loadError) regular.reload(); else regular.retry();
    if (pve.loadError) pve.reload(); else pve.retry();
  };
  // Где хранятся отметки — пишем, только когда это уже известно точно
  const where: 'account' | 'local' | null = auth.status === 'loading' ? null : account ? (settled ? 'account' : null) : 'local';
  return { isUsed, canToggle, toggle, where, authStatus: auth.status, loadError, saveError, syncError, retry };
}

const dateRu = (s?: string) => {
  if (!s) return '';
  const d = new Date(s + 'T00:00:00');
  return isNaN(+d) ? s : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
};

export default function Promo() {
  const { data, live } = usePromo();
  const used = useUsed(data.codes);
  const [mode, setMode] = useState<'' | Code['mode']>('');
  const [hideUsed, setHideUsed] = useState(false);
  const [copied, setCopied] = useState('');
  // «Как активировать» раскрыта только при первом заходе — дальше не занимает первый экран
  const [howtoOpen] = useState(() => { try { return !localStorage.getItem('promoHowtoSeen'); } catch { return true; } });
  useEffect(() => { try { localStorage.setItem('promoHowtoSeen', '1'); } catch { /* ignore */ } }, []);

  // Рабочие коды выбранного режима — без учёта «Скрыть активированные»
  const forMode = useMemo(() => data.codes
    .filter((c) => c.status !== 'expired')
    .filter((c) => !mode || c.mode === mode || c.mode === 'unknown'), [data, mode]);
  const codes = useMemo(() => forMode
    .filter((c) => !hideUsed || !used.isUsed(c.code))
    .sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1) || (b.added || '').localeCompare(a.added || '')),
  [forMode, hideUsed, used.isUsed]);
  const expired = data.codes.filter((c) => c.status === 'expired');

  const copy = async (code: string) => {
    try { await navigator.clipboard.writeText(code); } catch {
      // запасной вариант для старых WebView
      const t = document.createElement('textarea'); t.value = code; document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); } catch { /* ignore */ }
      t.remove();
    }
    setCopied(code); setTimeout(() => setCopied(''), 1500);
  };

  return (
    <section className="ref-page">
      <h1>Промокоды</h1>
      <p className="lead">
        Бесплатное снаряжение от Battlestate Games. Обновлено {dateRu(data.updated)}{live ? '' : ' (без сети показана сохранённая копия)'}.
      </p>

      <details className="card howto" open={howtoOpen}>
        <summary><b>Как активировать</b></summary>
        <ol>
          <li>Нажмите «Копировать» у нужного кода.</li>
          <li>Откройте лаунчер Battlestate Games (или Steam-версию).</li>
          <li>Справа вверху нажмите на своё имя или статус «Online» — откроется меню.</li>
          <li>Выберите «Активировать промокод» и вставьте код. Регистр букв важен.</li>
          <li>Предметы придут в игре в том режиме, который указан у кода (PvE, PvP-сезон или обычный PvP). Ищите их во внутриигровых сообщениях.</li>
        </ol>
        <p className="muted small">Код можно активировать на сайте escapefromtarkov.com в личном кабинете — результат тот же. «Проверьте» — код мог закончиться: просто попробуйте.</p>
      </details>

      <div className="chips">
        {([['', 'Все'], ['pve', 'PvE'], ['season', 'PvP-сезон'], ['pvp', 'PvP']] as const).map(([v, l]) => (
          <button key={v} className={mode === v ? 'chip on' : 'chip'} onClick={() => setMode(v)}>{l}</button>
        ))}
        <button className={hideUsed ? 'chip on' : 'chip'} onClick={() => setHideUsed(!hideUsed)}>Скрыть активированные</button>
      </div>
      {used.where && (
        <p className="muted small">
          {used.where === 'account'
            ? 'Отметки «Я уже активировал» хранятся в аккаунте — видны на всех ваших устройствах.'
            : `Отметки «Я уже активировал» хранятся только ${used.authStatus === 'app' ? 'на этом устройстве' : 'в этом браузере'}.`
              + (used.authStatus === 'signedOut' ? ' Войдите через Discord (кнопка «Войти» вверху), чтобы они сохранялись в аккаунте.' : '')}
        </p>
      )}
      {used.loadError && (
        <div className="alert">Не удалось загрузить отметки из аккаунта — пока их нельзя менять. ({used.loadError}) <button className="btn small" onClick={used.retry}>Повторить</button></div>
      )}
      {used.saveError && !used.loadError && (
        <div className="alert">Отметка не сохранилась в аккаунт. ({used.saveError}) <button className="btn small" onClick={used.retry}>Повторить</button></div>
      )}
      {used.syncError && (
        <div className="alert">Не удалось перенести отметки из браузера в аккаунт — попробуем при следующем заходе. ({used.syncError})</div>
      )}

      {codes.length === 0 && (
        <div className="ref-empty">
          <b>{hideUsed && forMode.length > 0 ? 'Все коды здесь вы уже активировали' : 'Рабочих кодов для этого режима сейчас нет'}</b>
          <div className="muted small">Новые коды обычно выходят к ивентам и патчам — загляните позже.</div>
          <button className="btn ghost small" onClick={() => { setMode(''); setHideUsed(false); }}>Показать все коды</button>
        </div>
      )}
      <div className="cards">
        {codes.map((c) => (
          <div key={c.code} className={`card promo ${used.isUsed(c.code) ? 'used' : ''}`}>
            <div className="promo-top">
              <code className="promo-code">{c.code}</code>
              <button className="btn small" onClick={() => copy(c.code)}>{copied === c.code ? 'Скопировано ✓' : 'Копировать'}</button>
            </div>
            <div className="promo-tags">
              <span className={`badge ${(STATUS[c.status] ?? STATUS.check).cls}`}>{(STATUS[c.status] ?? STATUS.check).label}</span>
              <span className="tag">{MODE[c.mode] ?? MODE.unknown}</span>
              {c.event && <span className="badge ll">{c.event}</span>}
            </div>
            <div className="small">{c.rewards}</div>
            {c.noteText && <div className="muted small">{c.noteText}</div>}
            <label className="small used-check">
              <input type="checkbox" checked={used.isUsed(c.code)} disabled={!used.canToggle(c.code)} onChange={() => used.toggle(c)} /> Я уже активировал
            </label>
          </div>
        ))}
      </div>

      <h2>Промокоды и ивенты</h2>
      <div className="card">
        <ul className="plain">
          <li>Каждый код активируется на аккаунте <b>один раз</b>. Повторно, в том числе на новом ивенте, он уже не сработает.</li>
          <li>На ивенты, вайпы и крупные патчи разработчики обычно выпускают <b>новые коды</b>: например, UNDEADTARKOV вышел к ивенту с зомби. Они появятся в этом списке.</li>
          <li>Многие коды живут недолго, иногда сутки, или ограничены числом активаций — активируйте сразу.</li>
          <li>Предметы из кода нельзя перенести в другой режим: PvE-код даёт снаряжение только в PvE.</li>
        </ul>
        <p className="muted small">{data.note}</p>
      </div>

      {expired.length > 0 && (
        <details>
          <summary>Истёкшие коды ({expired.length})</summary>
          <p className="small muted">{expired.map((c) => c.code).join(', ')}</p>
        </details>
      )}
    </section>
  );
}
