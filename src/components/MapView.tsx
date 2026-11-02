// Карта местности: SVG-карты tarkov.dev (автор — Shebuka, github.com/the-hideout/tarkov-dev-svg-maps,
// лицензия CC BY-NC-SA 4.0 — только некоммерческое использование, с указанием автора).
// Поверх карты — выходы, спавны, точки квестов и ваша позиция. Колёсиком/щипком — масштаб, перетаскиванием — сдвиг.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Pos } from '../position';
import { PinMark, QuestPin } from './Pin';

type MapImage = {
  svg: string;              // файл в https://assets.tarkov.dev/maps/svg/
  base: string;             // основной слой (id группы в SVG)
  rotation: number;         // поворот координат, как в tarkov.dev
  bounds: [[number, number], [number, number]]; // [[x1, z1], [x2, z2]] — какие игровые координаты покрывает картинка
  floors?: { id: string; name: string }[];
};

// Параметры взяты из открытого репозитория tarkov.dev (src/data/maps.json)
const IMAGES: Record<string, MapImage> = {
  customs: { svg: 'Customs.svg', base: 'Ground_Level', rotation: 180, bounds: [[698, -307], [-372, 237]],
    floors: [{ id: 'Underground_Level', name: 'Подвалы' }, { id: 'First_Floor', name: '2 этаж' }, { id: 'Second_Floor', name: '3 этаж' }, { id: 'Third_Floor', name: '4 этаж' }] },
  factory: { svg: 'Factory.svg', base: 'Ground_Floor', rotation: 90, bounds: [[77, -64.5], [-65.5, 67.4]],
    floors: [{ id: 'Basement', name: 'Подвал' }, { id: 'Second_Floor', name: '2 этаж' }, { id: 'Third_Floor', name: '3 этаж' }] },
  'ground-zero': { svg: 'GroundZero.svg', base: 'Ground_Level', rotation: 180, bounds: [[249, -124], [-99, 364]],
    floors: [{ id: 'Underground_Level', name: 'Подземный уровень' }, { id: 'First_Floor', name: '2 этаж' }, { id: 'Second_Floor', name: '3 этаж' }, { id: 'Third_Floor', name: '4 этаж' }] },
  interchange: { svg: 'Interchange.svg', base: 'Ground_Level', rotation: 180, bounds: [[598, -442], [-433, 426]],
    floors: [{ id: 'First_Floor', name: '2 этаж' }, { id: 'Second_Floor', name: '3 этаж' }] },
  lighthouse: { svg: 'Lighthouse.svg', base: 'Ground_Level', rotation: 180, bounds: [[515, -998], [-545, 725]] },
  reserve: { svg: 'Reserve.svg', base: 'Ground_Level', rotation: 180, bounds: [[289, -274], [-303, 272]],
    floors: [{ id: 'Bunkers', name: 'Бункеры' }] },
  shoreline: { svg: 'Shoreline.svg', base: 'Ground_Level', rotation: 180, bounds: [[504, -415], [-1056, 618]],
    floors: [{ id: 'Underground_Level', name: 'Подвалы' }, { id: 'First_Floor', name: '2 этаж' }, { id: 'Second_Floor', name: '3 этаж' }, { id: 'Third_Floor', name: '4 этаж' }] },
  'streets-of-tarkov': { svg: 'StreetsOfTarkov.svg', base: 'Ground_Level', rotation: 180, bounds: [[323, -295], [-280, 532]],
    floors: [{ id: 'Underground_Level', name: 'Подземный уровень' }, { id: 'First_Floor', name: '2 этаж' }, { id: 'Second_Floor', name: '3 этаж' }, { id: 'Third_Floor', name: '4 этаж' }, { id: 'Fourth_Floor', name: '5 этаж' }, { id: 'Fifth_Floor', name: '6 этаж' }] },
  terminal: { svg: 'Terminal.svg', base: 'Ground_Level', rotation: 180, bounds: [[463, -580], [-433, 475]],
    floors: [{ id: 'First_Floor', name: '2 этаж' }] },
  woods: { svg: 'Woods.svg', base: 'Ground_Level', rotation: 180, bounds: [[646, -914], [-761, 442]] },
};
// Варианты карт, у которых та же местность
const ALIAS: Record<string, string> = { 'night-factory': 'factory', 'infected-factory': 'factory', 'ground-zero-21': 'ground-zero' };

export function hasMapImage(normalizedName: string) { return !!IMAGES[ALIAS[normalizedName] || normalizedName]; }

// ---------- загрузка SVG ----------
const svgText = new Map<string, Promise<string>>();
function fetchSvg(file: string) {
  if (!svgText.has(file)) {
    const p = fetch('https://assets.tarkov.dev/maps/svg/' + file).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.text(); });
    p.catch(() => svgText.delete(file));
    svgText.set(file, p);
  }
  return svgText.get(file)!;
}

/**
 * Оставляет в SVG только основной слой и выбранный этаж (группы верхнего уровня с id).
 * Работаем со строкой, а не через DOMParser: так браузер не применяет к разбору правила CSP страницы.
 * Картинка показывается через <image>, где скрипты не выполняются; на всякий случай вырезаем их и обработчики.
 */
function keepLayers(svg: string, keep: string[]): string {
  let s = svg.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, '');
  const re = /<(\/?)(svg|g)\b[^>]*?(\/?)>/gi;
  const cut: [number, number][] = [];
  let depth = 0; let start = -1; let drop = false; let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const closing = m[1] === '/', selfClose = m[3] === '/', tag = m[2].toLowerCase();
    if (!closing) {
      if (tag === 'g' && depth === 1) {
        const id = /\sid="([^"]*)"/.exec(m[0])?.[1];
        drop = !!id && !keep.includes(id); start = m.index;
        if (selfClose) { if (drop) cut.push([start, re.lastIndex]); continue; }
      }
      if (!selfClose) depth++;
    } else {
      depth--;
      if (tag === 'g' && depth === 1 && drop) { cut.push([start, re.lastIndex]); drop = false; }
    }
  }
  for (let i = cut.length - 1; i >= 0; i--) s = s.slice(0, cut[i][0]) + s.slice(cut[i][1]);
  return s;
}

/** Готовит картинку карты и отдаёт blob-ссылку для <image>. */
function useMapImage(cfg: MapImage | undefined, floor: string) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!cfg) return;
    let alive = true; let made: string | null = null;
    setUrl(null); setFailed(false);
    fetchSvg(cfg.svg).then((text) => {
      if (!alive) return;
      const out = keepLayers(text, [cfg.base, floor]);
      made = URL.createObjectURL(new Blob([out], { type: 'image/svg+xml' }));
      setUrl(made);
    }).catch(() => alive && setFailed(true));
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [cfg, floor]);
  return { url, failed };
}

const FACTION: Record<string, string> = { pmc: '#5fbf6a', scav: '#d9b84a', shared: '#4fa3d9' };


export default function MapView({ map, track, show, quests = [], selected, onSelect, focus }: {
  map: any; track: Pos[]; show: Record<string, boolean>; quests?: QuestPin[];
  selected?: string | null; onSelect?: (id: string | null) => void; focus?: { n: number; pts: [number, number][] } | null;
}) {
  const cfg = IMAGES[ALIAS[map.normalizedName] || map.normalizedName];
  const [floor, setFloor] = useState('');
  useEffect(() => setFloor(''), [map.id]);
  const { url, failed } = useMapImage(cfg, floor);

  // Проекция игровых координат на картинку (как в tarkov.dev: поворот, затем «север вверх»)
  const project = useMemo(() => {
    const a = ((cfg?.rotation || 0) * Math.PI) / 180;
    const cos = Math.round(Math.cos(a)), sin = Math.round(Math.sin(a));
    return (x: number, z: number): [number, number] => [x * cos - z * sin, -(x * sin + z * cos)];
  }, [cfg]);
  const rect = useMemo(() => {
    if (!cfg) return { x: 0, y: 0, w: 1, h: 1 };
    const [p1, p2] = [project(cfg.bounds[0][0], cfg.bounds[0][1]), project(cfg.bounds[1][0], cfg.bounds[1][1])];
    const x = Math.min(p1[0], p2[0]), y = Math.min(p1[1], p2[1]);
    return { x, y, w: Math.abs(p1[0] - p2[0]), h: Math.abs(p1[1] - p2[1]) };
  }, [cfg, project]);

  // Масштаб и сдвиг через viewBox
  const full = useMemo(() => ({ x: rect.x, y: rect.y, w: rect.w, h: rect.h }), [rect]);
  const [vb, setVb] = useState(full);
  useEffect(() => setVb(full), [full]);
  const svgRef = useRef<SVGSVGElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const dragged = useRef(false);
  const downAt = useRef<{ x: number; y: number } | null>(null);
  const k = vb.w / full.w; // 1 — вся карта; меньше — приближено

  const zoomAt = (factor: number, cx?: number, cy?: number) => {
    setVb((v) => {
      const w = Math.min(full.w * 1.2, Math.max(full.w / 12, v.w * factor));
      const h = (w / v.w) * v.h;
      const px = cx ?? v.x + v.w / 2, py = cy ?? v.y + v.h / 2;
      return { x: px - ((px - v.x) * w) / v.w, y: py - ((py - v.y) * h) / v.h, w, h };
    });
  };
  const toWorld = (clientX: number, clientY: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    // preserveAspectRatio="xMidYMid meet": учитываем поля
    const s = Math.min(r.width / vb.w, r.height / vb.h);
    const ox = (r.width - vb.w * s) / 2, oy = (r.height - vb.h * s) / 2;
    return [vb.x + (clientX - r.left - ox) / s, vb.y + (clientY - r.top - oy) / s];
  };
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => { e.preventDefault(); const [wx, wy] = toWorld(e.clientX, e.clientY); zoomAt(e.deltaY > 0 ? 1.2 : 1 / 1.2, wx, wy); };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });
  const onDown = (e: React.PointerEvent) => { pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); dragged.current = false; downAt.current = { x: e.clientX, y: e.clientY }; };
  const onUp = (e: React.PointerEvent) => { pointers.current.delete(e.pointerId); };
  const onMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    if (downAt.current && Math.hypot(e.clientX - downAt.current.x, e.clientY - downAt.current.y) > 5) {
      if (!dragged.current) svgRef.current?.setPointerCapture?.(e.pointerId);
      dragged.current = true;
    }
    if (!dragged.current && pointers.current.size === 1) return;
    const r = svgRef.current!.getBoundingClientRect();
    const s = Math.min(r.width / vb.w, r.height / vb.h);
    if (pointers.current.size === 1) {
      const dx = (e.clientX - prev.x) / s, dy = (e.clientY - prev.y) / s;
      setVb((v) => ({ ...v, x: v.x - dx, y: v.y - dy }));
    } else if (pointers.current.size === 2) {
      const other = [...pointers.current.entries()].find(([id]) => id !== e.pointerId)![1];
      const d0 = Math.hypot(prev.x - other.x, prev.y - other.y), d1 = Math.hypot(e.clientX - other.x, e.clientY - other.y);
      if (d0 > 0 && d1 > 0) { const [wx, wy] = toWorld((e.clientX + other.x) / 2, (e.clientY + other.y) / 2); zoomAt(d0 / d1, wx, wy); }
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };

  // Показать точки выбранного квеста: приближаем так, чтобы все поместились
  useEffect(() => {
    if (!focus?.pts.length) return;
    const pr = focus.pts.map(([x, z]) => project(x, z));
    const minX = Math.min(...pr.map((p) => p[0])), maxX = Math.max(...pr.map((p) => p[0]));
    const minY = Math.min(...pr.map((p) => p[1])), maxY = Math.max(...pr.map((p) => p[1]));
    const aspect = full.h / full.w;
    let w = Math.max(full.w / 4, (maxX - minX) * 1.6, ((maxY - minY) * 1.6) / aspect);
    w = Math.min(w, full.w);
    const h = w * aspect;
    setVb({ x: (minX + maxX) / 2 - w / 2, y: (minY + maxY) / 2 - h / 2, w, h });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.n]);

  const extracts = (map.extracts || []).filter((e: any) => e.position && show[e.faction] !== false);
  const spawns = show.spawns ? (map.spawns || []).filter((s: any) => s.position) : [];
  const last = track[track.length - 1];
  // Размеры значков постоянны на экране: компенсируем масштаб
  const u = (full.w / 800) * k;

  return (
    <div className="map-wrap">
      <svg ref={svgRef} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} className="map-svg map-real" role="img" aria-label={`Карта ${map.name}`}
        onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={onUp} onPointerMove={onMove}
        onClick={() => { if (!dragged.current && selected) onSelect?.(null); }}>
        <rect x={rect.x - rect.w} y={rect.y - rect.h} width={rect.w * 3} height={rect.h * 3} className="map-sea" />
        {url && <image href={url} x={rect.x} y={rect.y} width={rect.w} height={rect.h} preserveAspectRatio="none" />}
        {spawns.map((s: any, i: number) => { const [x, y] = project(s.position.x, s.position.z); return <circle key={'s' + i} cx={x} cy={y} r={3 * u} fill="#bbb" opacity={0.75} />; })}
        {extracts.map((e: any, i: number) => {
          const [x, y] = project(e.position.x, e.position.z);
          return (
            <g key={'e' + i}>
              <circle cx={x} cy={y} r={6 * u} fill={FACTION[e.faction] || '#ccc'} stroke="#0f1110" strokeWidth={2 * u} />
              <text x={x + 9 * u} y={y + 4 * u} className="map-label" style={{ fontSize: 12 * u, strokeWidth: 3 * u }}>{e.name}</text>
            </g>
          );
        })}
        {/* Выбранный квест рисуем последним, чтобы его булавки были сверху */}
        {[...quests].sort((a, b) => (a.taskId === selected ? 1 : 0) - (b.taskId === selected ? 1 : 0)).map((q, i) => {
          const [x, y] = project(q.x, q.z);
          return <PinMark key={'q' + i} q={q} x={x} y={y} u={u} selected={selected} onSelect={(id) => { if (!dragged.current) onSelect?.(id); }} />;
        })}
        {track.length > 1 && <polyline fill="none" stroke="#d9573b" strokeOpacity={0.6} strokeDasharray={`${4 * u} ${4 * u}`} strokeWidth={2 * u}
          points={track.map((p) => project(p.x, p.z).join(',')).join(' ')} />}
        {last && (() => {
          const [x, y] = project(last.x, last.z);
          let arrow = null;
          if (last.yaw != null) {
            const [ax, ay] = project(last.x + Math.sin(last.yaw) * 10, last.z + Math.cos(last.yaw) * 10);
            const dx = ax - x, dy = ay - y, len = Math.hypot(dx, dy) || 1;
            arrow = <line x1={x} y1={y} x2={x + (dx / len) * 24 * u} y2={y + (dy / len) * 24 * u} stroke="#d9573b" strokeWidth={4 * u} strokeLinecap="round" />;
          }
          return <g>{arrow}<circle cx={x} cy={y} r={14 * u} fill="#d9573b" opacity={0.25} /><circle cx={x} cy={y} r={7 * u} fill="#d9573b" stroke="#fff" strokeWidth={2 * u} /></g>;
        })()}
      </svg>
      {!url && !failed && <div className="map-loading small"><span className="spinner" /> Загружаю карту…</div>}
      {failed && <div className="map-loading small">Не удалось загрузить карту местности — показаны только точки.</div>}
      <div className="map-tools">
        <button className="btn ghost small" onClick={() => zoomAt(1 / 1.5)} aria-label="Приблизить">＋</button>
        <button className="btn ghost small" onClick={() => zoomAt(1.5)} aria-label="Отдалить">－</button>
        <button className="btn ghost small" onClick={() => setVb(full)} aria-label="Вся карта">⤢</button>
      </div>
      {cfg?.floors && (
        <div className="map-floors">
          <select value={floor} onChange={(e) => setFloor(e.target.value)} aria-label="Этаж">
            <option value="">Уровень земли</option>
            {cfg.floors.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </div>
      )}
      <div className="muted small">
        Колёсико или два пальца — масштаб, перетаскивание — сдвиг. Карта: Shebuka / tarkov.dev, лицензия CC BY-NC-SA 4.0.
      </div>
    </div>
  );
}
