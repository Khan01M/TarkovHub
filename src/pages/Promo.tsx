import { useEffect, useMemo, useState } from 'react';
import bundled from '../../public/promocodes.json';

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
    fetch(url, { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: unknown) => {
        const clean = cleanPromo(d);
        // Если с сайта пришёл мусор без единого годного кода — остаёмся на встроенной копии
        if (clean && (clean.codes.length > 0 || (d as any).codes.length === 0)) { setData(clean); setLive(true); }
      })
      .catch(() => { /* остаёмся на встроенной копии */ });
  }, []);
  return { data, live };
}

function useUsed() {
  const [used, setUsed] = useState<Record<string, boolean>>(() => { try { return JSON.parse(localStorage.getItem('usedCodes') || '{}') || {}; } catch { return {}; } });
  const toggle = (c: string) => setUsed((u) => {
    const n = { ...u, [c]: !u[c] };
    try { localStorage.setItem('usedCodes', JSON.stringify(n)); } catch { /* ignore */ }
    return n;
  });
  return [used, toggle] as const;
}

const dateRu = (s?: string) => {
  if (!s) return '';
  const d = new Date(s + 'T00:00:00');
  return isNaN(+d) ? s : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
};

export default function Promo() {
  const { data, live } = usePromo();
  const [used, toggleUsed] = useUsed();
  const [mode, setMode] = useState<'' | Code['mode']>('');
  const [hideUsed, setHideUsed] = useState(false);
  const [copied, setCopied] = useState('');

  const codes = useMemo(() => data.codes
    .filter((c) => c.status !== 'expired')
    .filter((c) => !mode || c.mode === mode || c.mode === 'unknown')
    .filter((c) => !hideUsed || !used[c.code])
    .sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1) || (b.added || '').localeCompare(a.added || '')),
  [data, mode, hideUsed, used]);
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
    <section>
      <h1>Промокоды</h1>
      <p className="lead">
        Бесплатное снаряжение от Battlestate Games. Обновлено {dateRu(data.updated)}{live ? '' : ' (без сети показана сохранённая копия)'}.
      </p>

      <details className="card howto">
        <summary><b>Как активировать</b></summary>
        <ol>
          <li>Откройте лаунчер Battlestate Games (или Steam-версию).</li>
          <li>Справа вверху нажмите на своё имя или статус «Online» — откроется меню.</li>
          <li>Выберите «Активировать промокод» и вставьте код. Регистр букв важен.</li>
          <li>Предметы придут в игре в том режиме, который указан у кода (PvE, PvP-сезон или обычный PvP).</li>
        </ol>
        <p className="muted small">Код можно активировать на сайте escapefromtarkov.com в личном кабинете — результат тот же.</p>
      </details>

      <div className="chips">
        {([['', 'Все'], ['pve', 'PvE'], ['season', 'PvP-сезон'], ['pvp', 'PvP']] as const).map(([v, l]) => (
          <button key={v} className={mode === v ? 'chip on' : 'chip'} onClick={() => setMode(v)}>{l}</button>
        ))}
        <button className={hideUsed ? 'chip on' : 'chip'} onClick={() => setHideUsed(!hideUsed)}>Скрыть активированные</button>
      </div>

      <div className="cards">
        {codes.map((c) => (
          <div key={c.code} className={`card promo ${used[c.code] ? 'used' : ''}`}>
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
              <input type="checkbox" checked={!!used[c.code]} onChange={() => toggleUsed(c.code)} /> Я уже активировал
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
