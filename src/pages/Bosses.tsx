import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import BodyMap from '../components/BodyMap';
import { PARTS, PART_RU, PMC, PMC_TOTAL, hpOf, ratio, colorFor, total } from '../health';
import { useData, State, Search, norm, Img } from '../ui';
import { num, rub, loadMaps, loadItems } from '../api';

// three.js тяжёлый — грузим его только на странице босса
const Boss3D = lazy(() => import('../components/Boss3D'));


// Короткие подсказки по главным боссам (ключ — часть normalizedName)
const NOTES: Record<string, string> = {
  reshala: 'Таможня: общежития и заправка. Охрана из 4 человек, сам Решала часто сидит в укрытии. Носит золотой ТТ.',
  killa: 'Развязка: центр ТЦ (ИДЕЯ, KIBA, ОЛИ). Тяжёлая броня и шлем — нужны бронебойные патроны или стрельба по ногам. Агрессивно идёт в лоб с подавлением.',
  glukhar: 'Резерв: казармы и здание штаба. Большая охрана (до 6), реагирует на шум. Опасен в ближнем бою.',
  shturman: 'Лес: лесопилка. Предпочитает дальнюю дистанцию, охрана из 2 человек. Держите дистанцию и укрытия.',
  sanitar: 'Берег: санаторий, причал, коттеджи. Лечит себя и охрану, использует стимуляторы. Ключ от личного сейфа часто у него.',
  tagilla: 'Завод: ходит с кувалдой и дробовиком, очень агрессивен. В ближнем бою не стойте на месте.',
  kaban: 'Улицы Таркова: автосервис Лексос. Пулемёты, турели и снайперы на крышах вокруг. Подход только через укрытия.',
  kollontay: 'Улицы Таркова. Дубинка и автомат, охрана из полицейских.',
  knight: 'Группа «Гонщиков»: Рыцарь, Птичий Глаз и Большая Труба. Бродят по нескольким картам — где именно, смотрите ниже в «Где искать». Работают слаженно — не воюйте в открытую.',
  birdeye: 'Снайпер группы Рыцаря. Использует камуфляж и дальние позиции.',
  'big-pipe': 'Гранатомётчик группы Рыцаря. Опасен подствольными гранатами на средней дистанции.',
  zryachiy: 'Маяк: остров. Снайпер с ПСО, атакует всех на подходе к острову. Подход по воде без экипировки — не вариант.',
  partisan: 'Партизан: ходит по Лесу, Таможне, Берегу, Маяку. Ставит растяжки и бьёт из засады — смотрите под ноги на тропах.',
  cultist: 'Культисты: ночью (Лес, Берег, Таможня, Ночной завод). Отравленные ножи, бесшумно подходят. Держите при себе антидот и обезболивающее.',
};
const NOTE_KEYS: Record<string, string> = { birdeye: 'birdeye', 'big-pipe': 'big-pipe', 'cultist-priest': 'cultist' };

// «Тактика боя»: общие советы по основным боссам. Снаряжение на странице берётся из данных tarkov.dev и меняется с патчами.
const TACTICS: Record<string, string[]> = {
  reshala: [
    'Охрана держится рядом с Решалой и идёт на шум. Сначала по одному выбивайте охранников из укрытий.',
    'Сам Решала обычно прячется за охраной и редко идёт первым — не бегите сразу к нему.',
    'В коридорах общежитий бой идёт в упор: берите гранаты и не заходите в узкие проходы без поддержки.',
  ],
  killa: [
    'Тяжёлая броня и шлем: берите бронебойные патроны или цельтесь в руки и ноги.',
    'Агрессивно сближается, стреляет на подавление и бросает гранаты. Меняйте позицию, не сидите в одной точке.',
    'В ТЦ используйте колонны и витрины, держите дистанцию — в упор он опаснее всего.',
  ],
  glukhar: [
    'Самая большая охрана из всех боссов. Выбирайте место, где противники будут выходить по одному.',
    'Быстро реагирует на шум — подходите тихо и не стреляйте без нужды по дороге.',
    'Охрана делится на штурмовиков, разведчиков и охрану: не ждите, что все пойдут в одну сторону.',
  ],
  shturman: [
    'Любит дальнюю дистанцию и укрытия лесопилки — берите оптику и пользуйтесь рельефом.',
    'Охрана из двух человек: сначала разберитесь с ними, потом с самим Штурманом.',
    'Не выходите на открытые места вокруг лесопилки — простреливаются с нескольких точек.',
  ],
  sanitar: [
    'Лечится и колет стимуляторы — добивайте быстро, иначе он восстановится.',
    'Может появиться в разных зонах Берега: слушайте стрельбу и ориентируйтесь по ней.',
    'Охрана тоже лечится — не давайте никому из группы уйти за укрытие раненым.',
  ],
  tagilla: [
    'Идёт на сближение с кувалдой. Стреляйте в ноги и отступайте между укрытиями, не давайте подойти вплотную.',
    'Сварочная маска частично закрывает голову — по ней пули могут не пройти.',
    'В цехах Завода работайте от углов и дверных проёмов, слушайте шаги.',
  ],
  kaban: [
    'Территорию прикрывают пулемёты и снайперы на крышах — сначала снимите поддержку.',
    'Сам Кабан сидит в укрытии со станковым оружием: не выходите на открытые места напротив.',
    'Охрана активно перемещается — следите за флангами.',
  ],
  kollontay: [
    'Охрана из полицейских, сам Колонтай в ближнем бою использует дубинку.',
    'В зданиях много коридоров и углов: гранаты и контроль углов сильно помогают.',
  ],
  knight: [
    'Трое действуют вместе: штурмовик (Рыцарь), снайпер (Птичий Глаз) и гранатомётчик (Большая Труба).',
    'Не принимайте бой на открытой местности. Постарайтесь разделить их и бить по одному.',
    'Группа ходит по нескольким картам — свежие отчёты игроков о её маршруте есть на tarkov.dev.',
  ],
  birdeye: ['Снайпер группы Рыцаря: держится на дальних позициях в маскировке. Двигайтесь от укрытия к укрытию.'],
  'big-pipe': ['Гранатомётчик группы Рыцаря: опасен на средней дистанции. Не стойте кучей и меняйте позицию после выстрела.'],
  zryachiy: [
    'Стреляет по всем, кто подходит к острову Маяка, издалека и точно.',
    'Не задерживайтесь на открытых участках дороги к острову. Атаковать его — большой риск.',
  ],
  cultist: [
    'Активны ночью, подходят бесшумно, удары ножом отравляют.',
    'Держите при себе антидот и обезболивающее, внимательно слушайте шаги.',
  ],
};
const tacticsFor = (n: string) => TACTICS[NOTE_KEYS[n] || n];

// Постоянное место босса. На время ивентов tarkov.dev может показывать другие карты
// (например, на Хэллоуин Завод занимают заражённые) — тогда постоянная карта показывается отдельно.
const HOME_MAP: Record<string, string> = {
  reshala: 'Таможня', killa: 'Развязка', glukhar: 'Резерв', shturman: 'Лес', sanitar: 'Берег',
  tagilla: 'Завод', kaban: 'Улицы Таркова', kollontay: 'Улицы Таркова', zryachiy: 'Маяк',
};
const missingHome = (b: any) => { const h = HOME_MAP[b.normalizedName]; return h && !b.spawns.some((s: any) => s.map === h) ? h : null; };

const SLOT_RU: Record<string, string> = {
  FirstPrimaryWeapon: 'Основное оружие', SecondPrimaryWeapon: 'Второе оружие', Holster: 'Пистолет', Scabbard: 'Нож',
  Headwear: 'Головной убор', FaceCover: 'Маска', Earpiece: 'Наушники', Eyewear: 'Очки',
  ArmorVest: 'Бронежилет', TacticalVest: 'Разгрузка', Backpack: 'Рюкзак',
};
const WEAPON_SLOTS = ['FirstPrimaryWeapon', 'SecondPrimaryWeapon', 'Holster', 'Scabbard'];

// Маршрут: #/bosses — список, #/bosses/<имя> — страница босса
const routeBoss = () => decodeURIComponent(location.hash.replace(/^#\/?/, '').split('/')[1] || '');
const noteFor = (n: string) => NOTES[NOTE_KEYS[n] || n];
// Порядок: сначала основные боссы (с подсказками), потом остальные по шансу
const MAIN = Object.keys(NOTES);


const rank = (b: any) => { const i = MAIN.indexOf(NOTE_KEYS[b.normalizedName] || b.normalizedName); return i < 0 ? 99 : i; };


function useBosses() {
  const { data, error, loading } = useData(loadMaps);
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
    return (data.bosses || [])
      .map((b: any) => ({ ...b, spawns: (spawns[b.normalizedName] || []).sort((x, y) => y.chance - x.chance), note: noteFor(b.normalizedName) }))
      .filter((b: any) => b.spawns.length > 0 || b.note)
      .sort((a: any, b: any) => rank(a) - rank(b) || (b.spawns[0]?.chance || 0) - (a.spawns[0]?.chance || 0));
  }, [data]);
  return { bosses, error, loading };
}

export default function Bosses() {
  const [slug, setSlug] = useState(routeBoss);
  useEffect(() => { const f = () => setSlug(routeBoss()); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  const { bosses, error, loading } = useBosses();
  const boss = slug ? bosses.find((b: any) => b.normalizedName === slug) : null;
  // Максимум по каждой части тела среди всех боссов — чтобы полосы можно было сравнивать между страницами
  const maxHp = useMemo(() => {
    const m: Record<string, number> = {};
    for (const id of PARTS) m[id] = Math.max(PMC[id], ...bosses.map((x: any) => hpOf(x.health || [], id)));
    return m;
  }, [bosses]);
  if (slug && boss) return <BossPage boss={boss} maxHp={maxHp} />;
  return <BossList bosses={bosses} error={error} loading={loading || (!!slug && !boss && !error && !bosses.length)} />;
}

function BossList({ bosses, error, loading }: { bosses: any[]; error: string | null; loading: boolean }) {
  const [q, setQ] = useState('');
  const nq = norm(q);
  const list = bosses.filter((b: any) => !nq || norm(b.name).includes(nq) || b.spawns.some((s: any) => norm(s.map).includes(nq)));
  return (
    <section>
      <h1>Боссы</h1>
      <p className="lead">Нажмите на босса, чтобы открыть его страницу: 3D-модель со снаряжением, здоровье по частям тела, оружие, лут и тактика боя.</p>
      <div className="toolbar"><Search value={q} onChange={setQ} placeholder="Имя босса или карта…" /></div>
      <State loading={loading} error={error} />
      <div className="cards">
        {list.map((b: any) => {
          const hp = total(b.health || []);
          return (
            <a key={b.normalizedName} href={`#/bosses/${encodeURIComponent(b.normalizedName)}`} className="card boss boss-link">
              <div className="row-main">
                {b.imagePortraitLink ? <img className="portrait" src={b.imagePortraitLink} alt={b.name} loading="lazy" /> : <div className="portrait ph">☠</div>}
                <div className="grow">
                  <div className="title">{b.name}</div>
                  {hp > 0 && <div className="muted small">Здоровье: {num(hp)}</div>}
                  {(b.spawns[0] || missingHome(b)) && <div className="muted small">{[missingHome(b) ? `${missingHome(b)} (обычно)` : '', ...b.spawns.slice(0, 3).map((s: any) => `${s.map} ${Math.round(s.chance * 100)}%`)].filter(Boolean).join(' · ')}</div>}
                </div>
              </div>
              {b.health?.length > 0 && <BodyMap health={b.health} />}
              <span className="link small">Открыть страницу босса →</span>
            </a>
          );
        })}
      </div>
    </section>
  );
}

function BossPage({ boss: b, maxHp }: { boss: any; maxHp: Record<string, number> }) {
  const { data: itemsData } = useData(loadItems);
  const items = useMemo(() => {
    const m = new Map<string, any>();
    for (const it of itemsData?.items || []) m.set(it.id, it);
    return m;
  }, [itemsData]);
  useEffect(() => { window.scrollTo(0, 0); }, [b.normalizedName]);

  // Для 3D: самый частый предмет в слоте, если он встречается хотя бы в четверти наборов
  const gear3d = useMemo(() => (b.gear || [])
    .filter((g: any) => g.items[0]?.share >= 0.25)
    .map((g: any) => ({ slot: g.slot, name: items.get(g.items[0].id)?.name || SLOT_RU[g.slot] || g.slot })), [b, items]);

  const weapons = (b.gear || []).filter((g: any) => WEAPON_SLOTS.includes(g.slot));
  const armor = (b.gear || []).filter((g: any) => !WEAPON_SLOTS.includes(g.slot));
  const tactics = tacticsFor(b.normalizedName);
  const hp = total(b.health || []);

  const GearBlock = ({ groups }: { groups: any[] }) => (
    <div className="gear-list">
      {groups.map((g: any) => (
        <div key={g.slot} className="gear-slot">
          <div className="gear-slot-name">{SLOT_RU[g.slot] || g.slot}</div>
          {g.items.map((x: any) => {
            const it = items.get(x.id);
            return (
              <div key={x.id} className="gear-item">
                <Img src={it?.iconLink} alt="" size={40} />
                <span className="grow">{it?.name || '…'}</span>
                <span className="muted small" title="В какой доле наборов встречается">{Math.round(x.share * 100)}%</span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );

  return (
    <section className="boss-page">
      <a href="#/bosses" className="link small">← Все боссы</a>
      <h1>{b.name}</h1>
      <div className="boss-sub muted">
        {hp > 0 && <><b className="accent">{num(hp)} HP</b> · в {(hp / PMC_TOTAL).toFixed(1)} раза больше ЧВК · </>}
        {[missingHome(b) ? `${missingHome(b)} (обычно)` : '', ...b.spawns.map((s: any) => `${s.map} ${Math.round(s.chance * 100)}%`)].filter(Boolean).join(' · ')}
      </div>

      <div className="boss-hero">
        <div className="card boss-poster">
          {b.imagePosterLink ? <img src={b.imagePosterLink} alt={b.name} loading="lazy" /> : <div className="portrait ph big">☠</div>}
        </div>
        <div className="card boss-hero-3d">
          {b.health?.length > 0 ? (
            <Suspense fallback={<div className="boss3d"><div className="state small"><span className="spinner" /> Загружаю 3D…</div></div>}>
              <Boss3D name={b.name} health={b.health} gear={gear3d} />
            </Suspense>
          ) : <div className="state">Данных о здоровье нет</div>}
        </div>
      </div>

      {b.health?.length > 0 && (
        <div className="card">
          <h3>Здоровье по частям тела</h3>
          <p className="muted small">Полная полоса — самый живучий босс по этой части тела.</p>
          <div className="hp-bars">
            {PARTS.map((id) => {
              const v = hpOf(b.health, id);
              const max = maxHp[id] || Math.max(v, PMC[id]);
              return (
                <div key={id} className="hp-row">
                  <span className="hp-name">{PART_RU[id]}</span>
                  <div className="hp-track">
                    <i className="hp-fill" style={{ width: `${(v / max) * 100}%`, background: colorFor(ratio(b.health, id)) }} />
                    <i className="hp-pmc" style={{ left: `${(PMC[id] / max) * 100}%` }} title={`ЧВК: ${PMC[id]}`} />
                  </div>
                  <b className="hp-val">{v}</b>
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
      )}

      <div className="boss-cols">
        <div className="card">
          <h3>Вооружение</h3>
          {weapons.length ? <GearBlock groups={weapons} /> : <div className="muted small">Нет данных</div>}
        </div>
        <div className="card">
          <h3>Броня и снаряжение</h3>
          {armor.length ? <GearBlock groups={armor} /> : <div className="muted small">Нет данных</div>}
        </div>
      </div>
      <p className="muted small">Процент — в какой доле наборов снаряжения босса встречается предмет. Набор выбирается случайно при появлении.</p>

      <div className="boss-cols">
        <div className="card">
          <h3>Тактика боя</h3>
          {b.note && <p className="note">{b.note}</p>}
          {tactics ? <ul className="tactics">{tactics.map((t, i) => <li key={i}>{t}</li>)}</ul> : !b.note && <div className="muted small">Советов пока нет.</div>}
          <h4>Где искать</h4>
          {missingHome(b) && (
            <div className="alert info small">Постоянное место — <b>{missingHome(b)}</b>. Сейчас tarkov.dev его не показывает: скорее всего, идёт ивент и босса временно заменили. Ниже — карты по текущим данным.</div>
          )}
          {b.spawns.map((s: any, i: number) => (
            <div key={i} className="spawn">
              <div className="kv"><span>{s.map}</span><b>{Math.round((s.chance || 0) * 100)}%</b></div>
              <div className="bar"><i style={{ width: `${Math.round((s.chance || 0) * 100)}%` }} /></div>
              {s.locs.length > 0 && <div className="muted small">Точки: {s.locs.map((l: any) => `${l.name}${l.chance ? ` (${Math.round(l.chance * 100)}%)` : ''}`).join(', ')}</div>}
              {s.escorts.length > 0 && <div className="muted small">Охрана: {s.escorts.map((e: any) => `${e.name}${e.count ? ` ×${e.count}` : ''}`).join(', ')}</div>}
            </div>
          ))}
        </div>
        <div className="card">
          <h3>Лут</h3>
          {b.loot?.length ? (
            <div className="loot-grid">
              {b.loot.map((x: any) => {
                const it = items.get(x.id);
                return (
                  <div key={x.id} className="loot-item" title={it?.name}>
                    <Img src={it?.iconLink} alt="" size={48} />
                    <div className="small loot-name">{it?.shortName || it?.name || '…'}</div>
                    <div className="small"><b>{x.chance >= 1 ? Math.round(x.chance) : x.chance.toFixed(1)}%</b>{it?.avg24hPrice ? <span className="muted"> · {rub(it.avg24hPrice)}</span> : null}</div>
                  </div>
                );
              })}
            </div>
          ) : <div className="muted small">Нет данных</div>}
          <p className="muted small">Шанс найти предмет у босса (карманы и рюкзак).</p>
        </div>
      </div>
    </section>
  );
}
