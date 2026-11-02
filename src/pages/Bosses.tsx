import { useMemo, useState } from 'react';
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

const PART: Record<string, string> = {
  Head: 'Голова', Chest: 'Грудь', Stomach: 'Живот', LeftArm: 'Л. рука', RightArm: 'П. рука', LeftLeg: 'Л. нога', RightLeg: 'П. нога',
};

const rank = (b: any) => { const i = MAIN.indexOf(NOTE_KEYS[b.normalizedName] || b.normalizedName); return i < 0 ? 99 : i; };

export default function Bosses() {
  const { data, error, loading } = useData(loadMaps);
  const [q, setQ] = useState('');

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

  return (
    <section>
      <h1>Боссы</h1>
      <p className="lead">Где появляются, с каким шансом, сколько охраны и здоровья. Шанс спавна меняется с патчами — данные подтягиваются автоматически.</p>
      <div className="toolbar"><Search value={q} onChange={setQ} placeholder="Имя босса или карта…" /></div>
      <State loading={loading} error={error} />
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
                <details>
                  <summary>Здоровье по частям тела</summary>
                  {b.health.map((h: any) => <div key={h.id} className="kv small"><span>{PART[h.id] || h.id}</span><b>{h.max}</b></div>)}
                </details>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
