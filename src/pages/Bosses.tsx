import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import BodyMap from '../components/BodyMap';
import { PARTS, PART_RU, PMC, PMC_TOTAL, hpOf, ratio, colorFor, total } from '../health';

// three.js тяжёлый — грузим его только на этой странице и только когда нужен
const Boss3D = lazy(() => import('../components/Boss3D'));
import { useData, State, Search, norm } from '../ui';
import { num, loadMaps } from '../api';


// Короткие подсказки по главным боссам (ключ — часть normalizedName)
const NOTES: Record<string, string> = {
  reshala: 'Таможня: общежития и заправка. Охрана из 4 человек, сам Решала часто сидит в укрытии. Носит золотой ТТ.',
  killa: 'Развязка: центр ТЦ (ИДЕЯ, KIBA, ОЛИ). Тяжёлая броня и шлем — нужны бронебойные патроны или стрельба по ногам. Агрессивно идёт в лоб с подавлением.',
  glukhar: 'Резерв: казармы и здание штаба. Большая охрана (до 6), реагирует на шум. Опасен в ближнем бою.',
  shturman: 'Лес: лесопилка. Предпочитает дальнюю дистанцию, охрана из 2 человек. Держите дистанцию и укрытия.',
  sanitar: 'Берег: санаторий, причал, коттеджи. Лечит себя и охрану, использует стимуляторы. Ключ от личного сейфа часто у него.',
  tagilla: 'Завод: ходит с кувалдой и дробовиком, очень агрессивен. Стреляйте в голову/ноги, в ближнем бою не стойте на месте.',
  kaban: 'Улицы Таркова: автосервис Лексос. Пулемёты, турели и снайперы на крышах вокруг. Подход только через укрытия.',
  kollontay: 'Улицы и Эпицентр: здание МВД/полиции. Дубинка и автомат, охрана из полицейских.',
  knight: 'Группа «Гонщиков»: Рыцарь, Птичий Глаз и Большая Труба. Бродят по нескольким картам (Лес, Берег, Маяк, Таможня). Работают слаженно — не воюйте в открытую.',
  birdeye: 'Снайпер группы Рыцаря. Использует камуфляж и дальние позиции.',
  'big-pipe': 'Гранатомётчик группы Рыцаря. Опасен подствольными гранатами на средней дистанции.',
  zryachiy: 'Маяк: остров. Снайпер с ПСО, атакует всех на подходе к острову. Подход по воде без экипировки — не вариант.',
  partisan: 'Партизан: ходит по Лесу, Таможне, Берегу, Маяку. Ставит растяжки и бьёт из засады — смотрите под ноги на тропах.',
  cultist: 'Культисты: ночью (Лес, Берег, Таможня, Ночной завод). Отравленные ножи, бесшумно подходят. Держите при себе антидот и обезболивающее.',
};
const NOTE_KEYS: Record<string, string> = { birdeye: 'birdeye', 'big-pipe': 'big-pipe', 'cultist-priest': 'cultist' };
const noteFor = (n: string) => NOTES[NOTE_KEYS[n] || n];
// Порядок: сначала основные боссы (с подсказками), потом остальные по шансу
const MAIN = Object.keys(NOTES);


const rank = (b: any) => { const i = MAIN.indexOf(NOTE_KEYS[b.normalizedName] || b.normalizedName); return i < 0 ? 99 : i; };

export default function Bosses() {
  const { data, error, loading } = useData(loadMaps);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string>('');

  const bosses = useMemo(() => {
    if (!data) return [];
    const spawns: Record<string, any[]> = {};
    for (const m of data.maps || []) for (const b of m.bosses || []) {
      const key = b.normalizedName; if (!key) continue;
      const list = (spawns[key] ||= []);
      // на одной карте босс может быть описан несколько раз — оставляем самый вероятный вариант
      const prev = list.find((x) => x.map === m.name);
      if (prev && prev.chance >= b.spawnChance) continue;
      if (prev) list.splice(list.indexOf(prev), 1);
      list.push({ map: m.name, chance: b.spawnChance, locs: b.spawnLocations || [], escorts: b.escorts || [] });
    }
    const nq = norm(q);
    return (data.bosses || [])
      .map((b: any) => ({ ...b, spawns: (spawns[b.normalizedName] || []).sort((x, y) => y.chance - x.chance), note: noteFor(b.normalizedName) }))
      .filter((b: any) => b.spawns.length > 0 || b.note)
      .filter((b: any) => !nq || norm(b.name).includes(nq) || b.spawns.some((s: any) => norm(s.map).includes(nq)))
      .sort((a: any, b: any) => rank(a) - rank(b) || (b.spawns[0]?.chance || 0) - (a.spawns[0]?.chance || 0));
  }, [data, q]);

  const withHealth = useMemo(() => bosses.filter((b: any) => b.health?.length), [bosses]);
  const current = withHealth.find((b: any) => b.normalizedName === sel) || withHealth[0];
  useEffect(() => { if (!sel && withHealth[0]) setSel(withHealth[0].normalizedName); }, [withHealth, sel]);

  const show3d = (n: string) => {
    setSel(n);
    document.getElementById('boss-3d')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <section>
      <h1>Боссы</h1>
      <p className="lead">Где появляются, с каким шансом, сколько охраны и здоровья. Шанс спавна меняется с патчами — данные подтягиваются автоматически.</p>
      <div className="toolbar"><Search value={q} onChange={setQ} placeholder="Имя босса или карта…" /></div>
      <State loading={loading} error={error} />
      {current && (
        <div className="card boss-viewer" id="boss-3d">
          <div className="boss-viewer-3d">
            <Suspense fallback={<div className="boss3d"><div className="state small"><span className="spinner" /> Загружаю 3D…</div></div>}>
              <Boss3D name={current.name} health={current.health} />
            </Suspense>
          </div>
          <div className="boss-viewer-info">
            <select value={current.normalizedName} onChange={(e) => setSel(e.target.value)} aria-label="Босс">
              {withHealth.map((b: any) => <option key={b.normalizedName} value={b.normalizedName}>{b.name}</option>)}
            </select>
            <div className="hp-total">
              <b>{num(total(current.health))}</b> HP
              <span className="muted small"> · у ЧВК {PMC_TOTAL} · в {(total(current.health) / PMC_TOTAL).toFixed(1)} раза больше</span>
            </div>
            <div className="hp-bars">
              {PARTS.map((id) => {
                const hp = hpOf(current.health, id);
                const max = Math.max(...withHealth.map((b: any) => hpOf(b.health, id)), PMC[id]);
                return (
                  <div key={id} className="hp-row">
                    <span className="hp-name">{PART_RU[id]}</span>
                    <div className="hp-track">
                      <i className="hp-fill" style={{ width: `${(hp / max) * 100}%`, background: colorFor(ratio(current.health, id)) }} />
                      <i className="hp-pmc" style={{ left: `${(PMC[id] / max) * 100}%` }} title={`ЧВК: ${PMC[id]}`} />
                    </div>
                    <b className="hp-val">{hp}</b>
                  </div>
                );
              })}
            </div>
            <div className="hp-legend small muted">
              Цвет — во сколько раз крепче обычного ЧВК:
              <span><i style={{ background: colorFor(1) }} />как ЧВК</span>
              <span><i style={{ background: colorFor(2) }} />×2</span>
              <span><i style={{ background: colorFor(3) }} />×3</span>
              <span><i style={{ background: colorFor(4) }} />×4+</span>
              <span><i className="pmc-mark" />уровень ЧВК</span>
            </div>
          </div>
        </div>
      )}
      <div className="cards">
        {bosses.map((b: any) => {
          const hp = (b.health || []).reduce((s: number, h: any) => s + (h.max || 0), 0);
          return (
            <div key={b.normalizedName} className="card boss">
              <div className="row-main">
                {b.imagePortraitLink ? <img className="portrait" src={b.imagePortraitLink} alt={b.name} loading="lazy" /> : <div className="portrait ph">☠</div>}
                <div className="grow">
                  <div className="title">{b.name}</div>
                  {hp > 0 && <div className="muted small">Здоровье: {num(hp)}</div>}
                </div>
              </div>
              {b.note && <p className="note">{b.note}</p>}
              {b.spawns.map((s: any, i: number) => (
                <div key={i} className="spawn">
                  <div className="kv"><span>{s.map}</span><b>{Math.round((s.chance || 0) * 100)}%</b></div>
                  <div className="bar"><i style={{ width: `${Math.round((s.chance || 0) * 100)}%` }} /></div>
                  {s.locs.length > 0 && (
                    <div className="muted small">Точки: {s.locs.map((l: any) => `${l.name}${l.chance ? ` (${Math.round(l.chance * 100)}%)` : ''}`).join(', ')}</div>
                  )}
                  {s.escorts.length > 0 && (
                    <div className="muted small">Охрана: {s.escorts.map((e: any) => `${e.name}${e.count ? ` ×${e.count}` : ''}`).join(', ')}</div>
                  )}
                </div>
              ))}
              {b.health?.length > 0 && (
                <>
                  <BodyMap health={b.health} />
                  <button className="btn ghost small" onClick={() => show3d(b.normalizedName)}>Показать в 3D</button>
                </>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
