import { useEffect, useMemo, useState } from 'react';
import { useGql, State, safeUrl } from '../ui';
import { desktop, parseScreenshotName, Pos } from '../position';

const Q = `{ maps(lang: ru{MODE}) {
  id name normalizedName nameId description raidDuration players enemies wiki
  bosses { boss { name } spawnChance }
  extracts { name faction position { x y z } }
  spawns { position { x y z } sides categories }
} }`;
const FB = `{ maps(lang: ru{MODE}) {
  id name normalizedName description raidDuration players enemies wiki
  bosses { boss { name } spawnChance }
} }`;

const FACTION: Record<string, { label: string; color: string }> = {
  pmc: { label: 'ЧВК', color: '#5fbf6a' },
  scav: { label: 'Дикий', color: '#d9b84a' },
  shared: { label: 'Общий', color: '#4fa3d9' },
};

type View = { rot: number; flip: boolean };
const loadView = (id: string): View => { try { return JSON.parse(localStorage.getItem('view:' + id) || '') } catch { return { rot: 0, flip: false }; } };

export default function Maps() {
  const { data, error, loading } = useGql('maps', Q, FB);
  const maps = useMemo(() => (data?.maps || []).filter((m: any) => m.name).sort((a: any, b: any) => a.name.localeCompare(b.name, 'ru')), [data]);
  const [sel, setSel] = useState<string>(() => localStorage.getItem('map') || '');
  const map = maps.find((m: any) => m.normalizedName === sel) || maps[0];
  const [track, setTrack] = useState<Pos[]>([]);
  const [manual, setManual] = useState('');
  const [hint, setHint] = useState('');
  const [show, setShow] = useState({ pmc: true, scav: true, shared: true, spawns: false });

  const pick = (n: string) => { setSel(n); localStorage.setItem('map', n); setTrack([]); };

  // Интеграция с игрой (только в версии для ПК)
  useEffect(() => {
    if (!desktop) return;
    const off1 = desktop.onPosition((p) => setTrack((t) => [...t.slice(-19), p]));
    const off2 = desktop.onMapDetected?.((nameId) => {
      const m = maps.find((x: any) => x.nameId?.toLowerCase() === nameId.toLowerCase());
      if (m) { pick(m.normalizedName); setHint(`Игра загрузила карту: ${m.name}`); }
    });
    return () => { off1?.(); off2?.(); };
  }, [maps]);

  const addManual = () => {
    const p = parseScreenshotName(manual.trim());
    if (!p) { setHint('Не нашёл координаты. Вставьте имя скриншота целиком или «x, y, z».'); return; }
    setTrack((t) => [...t.slice(-19), p]); setManual(''); setHint('Позиция отмечена на карте.');
  };

  return (
    <section>
      <h1>Карты локаций</h1>
      <State loading={loading} error={error} />
      {map && (
        <>
          <div className="chips">
            {maps.map((m: any) => <button key={m.id} className={m.id === map.id ? 'chip on' : 'chip'} onClick={() => pick(m.normalizedName)}>{m.name}</button>)}
          </div>
          <div className="map-layout">
            <div className="card">
              <MapCanvas map={map} track={track} show={show} />
              <div className="legend">
                {(['pmc', 'scav', 'shared'] as const).map((f) => (
                  <label key={f}><input type="checkbox" checked={show[f]} onChange={(e) => setShow({ ...show, [f]: e.target.checked })} />
                    <i style={{ background: FACTION[f].color }} /> Выходы: {FACTION[f].label}</label>
                ))}
                <label><input type="checkbox" checked={show.spawns} onChange={(e) => setShow({ ...show, spawns: e.target.checked })} /><i style={{ background: '#888' }} /> Точки спавна</label>
                <label><i className="me" /> Вы</label>
              </div>
            </div>
            <div className="side">
              <div className="card">
                <h3>{map.name}</h3>
                {map.description && <p className="muted small">{map.description}</p>}
                <div className="kv"><span>Длительность рейда</span><b>{map.raidDuration ? `${map.raidDuration} мин` : '—'}</b></div>
                <div className="kv"><span>Игроков</span><b>{map.players || '—'}</b></div>
                {map.bosses?.length > 0 && (
                  <>
                    <h4>Боссы</h4>
                    {dedupe(map.bosses).map((b: any) => (
                      <div key={b.name} className="kv"><span>{b.name}</span><b>{Math.round(b.chance * 100)}%</b></div>
                    ))}
                  </>
                )}
                <div className="links">
                  <a className="link" href={`https://tarkov.dev/map/${encodeURIComponent(map.normalizedName)}`} target="_blank" rel="noreferrer">Подробная интерактивная карта ↗</a>
                  {safeUrl(map.wiki) && <a className="link" href={safeUrl(map.wiki)} target="_blank" rel="noreferrer">Wiki ↗</a>}
                </div>
              </div>

              <div className="card">
                <h3>Где я? {desktop ? <span className="badge ok">связь с игрой</span> : null}</h3>
                {desktop ? (
                  <p className="small">Сделайте скриншот в игре (клавиша <kbd>PrtSc</kbd>) — точка появится на карте автоматически. Карта переключается сама при загрузке рейда, если указана папка игры в настройках.</p>
                ) : (
                  <p className="small">В версии для ПК позиция определяется автоматически по скриншотам. Здесь можно вставить имя файла скриншота из папки «Документы\Escape from Tarkov\Screenshots».</p>
                )}
                <div className="toolbar">
                  <input className="search" value={manual} onChange={(e) => setManual(e.target.value)} placeholder="2025-01-08[20-17]_-198.7, 2.5, -73.9_…png" onKeyDown={(e) => e.key === 'Enter' && addManual()} />
                  <button className="btn" onClick={addManual}>Отметить</button>
                </div>
                {hint && <div className="muted small">{hint}</div>}
                {track.length > 0 && (
                  <div className="small">
                    Последняя точка: x {track[track.length - 1].x.toFixed(1)}, z {track[track.length - 1].z.toFixed(1)}, высота {track[track.length - 1].y.toFixed(1)}
                    <button className="btn ghost small" onClick={() => setTrack([])}>Очистить</button>
                  </div>
                )}
                {desktop && <DesktopSettings />}
              </div>

              {map.extracts?.length > 0 && (
                <div className="card">
                  <h3>Выходы</h3>
                  {(['pmc', 'shared', 'scav'] as const).map((f) => {
                    const list = map.extracts.filter((e: any) => e.faction === f);
                    if (!list.length) return null;
                    return (
                      <div key={f}>
                        <h4 style={{ color: FACTION[f].color }}>{FACTION[f].label}</h4>
                        <ul className="plain">{list.map((e: any, i: number) => <li key={i}>{e.name}</li>)}</ul>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function dedupe(bosses: any[]) {
  const m = new Map<string, number>();
  for (const b of bosses) { const n = b.boss?.name; if (n) m.set(n, Math.max(m.get(n) || 0, b.spawnChance || 0)); }
  return [...m].map(([name, chance]) => ({ name, chance })).sort((a, b) => b.chance - a.chance);
}

function MapCanvas({ map, track, show }: { map: any; track: Pos[]; show: Record<string, boolean> }) {
  const [view, setView] = useState<View>(() => loadView(map.id));
  useEffect(() => setView(loadView(map.id)), [map.id]);
  const save = (v: View) => { setView(v); localStorage.setItem('view:' + map.id, JSON.stringify(v)); };

  const extracts = (map.extracts || []).filter((e: any) => e.position && show[e.faction] !== false);
  const spawns = show.spawns ? (map.spawns || []).filter((s: any) => s.position) : [];
  const pts = [...(map.extracts || []), ...(map.spawns || [])].map((p: any) => p.position).filter(Boolean).concat(track);

  if (pts.length === 0) {
    return <div className="map-empty">Координаты для этой карты пока недоступны в API. Используйте подробную карту по ссылке справа.</div>;
  }

  // Игровые координаты: x и z — горизонталь, y — высота
  const tr = (x: number, z: number): [number, number] => {
    let u = view.flip ? -x : x, v = -z; // север вверх
    for (let i = 0; i < view.rot / 90; i++) [u, v] = [-v, u];
    return [u, v];
  };
  const proj = pts.map((p: any) => tr(p.x, p.z));
  const minU = Math.min(...proj.map((p) => p[0])), maxU = Math.max(...proj.map((p) => p[0]));
  const minV = Math.min(...proj.map((p) => p[1])), maxV = Math.max(...proj.map((p) => p[1]));
  const pad = 40, W = 800, H = 600;
  const scale = Math.min((W - pad * 2) / Math.max(1, maxU - minU), (H - pad * 2) / Math.max(1, maxV - minV));
  const S = (x: number, z: number) => {
    const [u, v] = tr(x, z);
    return [pad + (u - minU) * scale + ((W - pad * 2) - (maxU - minU) * scale) / 2, pad + (v - minV) * scale + ((H - pad * 2) - (maxV - minV) * scale) / 2];
  };
  const last = track[track.length - 1];

  return (
    <div className="map-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="map-svg" role="img" aria-label={`Схема карты ${map.name}`}>
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="rgba(255,255,255,.05)" /></pattern>
        </defs>
        <rect width={W} height={H} fill="url(#grid)" />
        {spawns.map((s: any, i: number) => { const [x, y] = S(s.position.x, s.position.z); return <circle key={'s' + i} cx={x} cy={y} r={3} fill="#888" opacity={0.6} />; })}
        {extracts.map((e: any, i: number) => {
          const [x, y] = S(e.position.x, e.position.z);
          const c = FACTION[e.faction]?.color || '#ccc';
          return (
            <g key={'e' + i}>
              <circle cx={x} cy={y} r={7} fill={c} stroke="#0f1110" strokeWidth={2} />
              <text x={x > W * 0.7 ? x - 10 : x + 10} y={y + 4} textAnchor={x > W * 0.7 ? 'end' : 'start'} className="map-label">{e.name}</text>
            </g>
          );
        })}
        {track.length > 1 && (
          <polyline fill="none" stroke="#d9573b" strokeOpacity={0.5} strokeDasharray="4 4" strokeWidth={2}
            points={track.map((p) => S(p.x, p.z).join(',')).join(' ')} />
        )}
        {last && (() => {
          const [x, y] = S(last.x, last.z);
          let arrow = null;
          if (last.yaw != null) {
            const [ax, ay] = S(last.x + Math.sin(last.yaw) * 30, last.z + Math.cos(last.yaw) * 30);
            const dx = ax - x, dy = ay - y, len = Math.hypot(dx, dy) || 1;
            arrow = <line x1={x} y1={y} x2={x + dx / len * 26} y2={y + dy / len * 26} stroke="#d9573b" strokeWidth={4} strokeLinecap="round" />;
          }
          return <g>{arrow}<circle cx={x} cy={y} r={14} fill="#d9573b" opacity={0.25}><animate attributeName="r" values="10;20;10" dur="2s" repeatCount="indefinite" /></circle><circle cx={x} cy={y} r={7} fill="#d9573b" stroke="#fff" strokeWidth={2} /></g>;
        })()}
      </svg>
      <div className="map-tools">
        <button className="btn ghost small" onClick={() => save({ ...view, rot: (view.rot + 90) % 360 })} title="Повернуть">⟳ 90°</button>
        <button className="btn ghost small" onClick={() => save({ ...view, flip: !view.flip })} title="Отразить">⇋ Отразить</button>
      </div>
      <div className="muted small">Схема построена по игровым координатам. Если ориентация не совпадает с привычной картой — поверните или отразите её, настройка запомнится.</div>
    </div>
  );
}

function DesktopSettings() {
  const [dir, setDir] = useState('');
  useEffect(() => { desktop?.getScreenshotsDir().then(setDir); }, []);
  return (
    <div className="small settings">
      <div className="muted">Папка скриншотов: {dir || '—'}</div>
      <button className="btn ghost small" onClick={async () => { const d = await desktop?.chooseScreenshotsDir(); if (d) setDir(d); }}>Изменить папку…</button>
      <GameDirSetting />
    </div>
  );
}

function GameDirSetting() {
  const api: any = desktop;
  const [dir, setDir] = useState('');
  useEffect(() => { api?.getGameDir?.().then((d: string) => setDir(d || '')); }, []);
  if (!api?.getGameDir) return null;
  return (
    <>
      <div className="muted">Папка игры (для автоопределения карты): {dir || 'не найдена'}</div>
      <button className="btn ghost small" onClick={async () => { const d = await api.chooseGameDir(); if (d) setDir(d); }}>Указать папку игры…</button>
    </>
  );
}
