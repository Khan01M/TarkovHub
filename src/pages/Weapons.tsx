import { useMemo, useState } from 'react';
import { useGql, State, Search, norm, Img, safeUrl } from '../ui';
import { rub, num } from '../api';

const QW = `{ items(type: gun, lang: ru{MODE}) {
  id name shortName iconLink wikiLink avg24hPrice
  buyFor { priceRUB vendor { name } }
  properties { ... on ItemPropertiesWeapon {
    caliber fireRate ergonomics recoilVertical recoilHorizontal effectiveDistance
    defaultAmmo { name }
  } }
} }`;
const QW_FB = `{ items(type: gun, lang: ru{MODE}) {
  id name shortName iconLink wikiLink avg24hPrice
  properties { ... on ItemPropertiesWeapon { caliber fireRate ergonomics recoilVertical recoilHorizontal } }
} }`;

const QA = `{ ammo(lang: ru{MODE}) {
  caliber damage penetrationPower armorDamage initialSpeed fragmentationChance tracer
  item { id name shortName iconLink avg24hPrice }
} }`;

// "Caliber556x45NATO" → "5.56x45 NATO"
export function caliberName(c?: string) {
  if (!c) return '—';
  const s = c.replace(/^Caliber/, '');
  if (s === '366TKM') return '.366 ТКМ';
  const m = s.match(/^(\d+)x(\d+)(.*)$/);
  if (m) {
    const special: Record<string, string> = { '127': '12.7', '46': '4.6', '57': '5.7', '86': '8.6', '68': '6.8', '93': '9.3', '1143': '11.43' };
    const d = special[m[1]] || (m[1].length === 3 ? `${m[1][0]}.${m[1].slice(1)}` : m[1]);
    return `${d}x${m[2]}${m[3] ? ' ' + m[3] : ''}`;
  }
  return s.replace(/^(\d+)g$/, '$1 калибр');
}

// Класс брони, который патрон уверенно пробивает (ориентир: пробитие / 10)
const penClass = (p: number) => Math.min(6, Math.max(0, Math.floor(p / 10)));

export default function Weapons() {
  const [tab, setTab] = useState<'guns' | 'ammo'>('guns');
  return (
    <section>
      <h1>Оружие и патроны</h1>
      <div className="tabs">
        <button className={tab === 'guns' ? 'on' : ''} onClick={() => setTab('guns')}>Оружие</button>
        <button className={tab === 'ammo' ? 'on' : ''} onClick={() => setTab('ammo')}>Патроны</button>
      </div>
      {tab === 'guns' ? <Guns /> : <Ammo />}
    </section>
  );
}

function Guns() {
  const { data, error, loading } = useGql('guns', QW, QW_FB);
  const [q, setQ] = useState('');
  const [cal, setCal] = useState('');
  const [sort, setSort] = useState('recoil');
  const guns = useMemo(() => {
    const nq = norm(q);
    const list = (data?.items || []).filter((g: any) => g.properties?.caliber &&
      (!cal || g.properties.caliber === cal) && (!nq || norm(g.name).includes(nq) || norm(g.shortName).includes(nq)));
    const by: Record<string, (a: any, b: any) => number> = {
      recoil: (a, b) => (a.properties.recoilVertical || 0) - (b.properties.recoilVertical || 0),
      ergo: (a, b) => (b.properties.ergonomics || 0) - (a.properties.ergonomics || 0),
      rate: (a, b) => (b.properties.fireRate || 0) - (a.properties.fireRate || 0),
      price: (a, b) => (a.avg24hPrice || 9e9) - (b.avg24hPrice || 9e9),
    };
    return list.sort(by[sort]);
  }, [data, q, cal, sort]);
  const calibers = useMemo(() => Array.from(new Set((data?.items || []).map((g: any) => g.properties?.caliber).filter(Boolean))).sort() as string[], [data]);

  return (
    <>
      <div className="toolbar">
        <Search value={q} onChange={setQ} placeholder="АК-74М, M4A1, MP-153…" />
        <select value={cal} onChange={(e) => setCal(e.target.value)}>
          <option value="">Все калибры</option>
          {calibers.map((c) => <option key={c} value={c}>{caliberName(c)}</option>)}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="recoil">Меньше отдача</option>
          <option value="ergo">Больше эргономика</option>
          <option value="rate">Скорострельность</option>
          <option value="price">Дешевле</option>
        </select>
      </div>
      <State loading={loading} error={error} />
      <div className="cards">
        {guns.map((g: any) => {
          const p = g.properties;
          const trader = (g.buyFor || []).filter((b: any) => !/flea|барахол/i.test(b.vendor?.name || '')).sort((a: any, b: any) => a.priceRUB - b.priceRUB)[0];
          return (
            <div key={g.id} className="card gun">
              <div className="row-main">
                <Img src={g.iconLink} alt={g.shortName} size={64} />
                <div className="grow">
                  <div className="title">{g.name}</div>
                  <div className="tag">{caliberName(p.caliber)}</div>
                </div>
              </div>
              <div className="stats">
                <Stat label="Отдача верт." value={num(p.recoilVertical)} />
                <Stat label="Отдача гор." value={num(p.recoilHorizontal)} />
                <Stat label="Эргономика" value={num(p.ergonomics)} />
                <Stat label="Выстр./мин" value={num(p.fireRate)} />
              </div>
              <div className="kv"><span>Барахолка</span><b>{rub(g.avg24hPrice)}</b></div>
              {trader && <div className="kv"><span>{trader.vendor.name}</span><b>{rub(trader.priceRUB)}</b></div>}
              {p.defaultAmmo?.name && <div className="muted small">Патрон по умолчанию: {p.defaultAmmo.name}</div>}
              {safeUrl(g.wikiLink) && <a className="link small" href={safeUrl(g.wikiLink)} target="_blank" rel="noreferrer">Wiki ↗</a>}
            </div>
          );
        })}
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="stat"><b>{value}</b><span>{label}</span></div>;
}

function Ammo() {
  const { data, error, loading } = useGql('ammo', QA);
  const [cal, setCal] = useState('');
  const [q, setQ] = useState('');
  const calibers = useMemo(() => Array.from(new Set((data?.ammo || []).map((a: any) => a.caliber).filter(Boolean))).sort() as string[], [data]);
  const list = useMemo(() => {
    const nq = norm(q);
    return (data?.ammo || [])
      .filter((a: any) => a.item && (!cal || a.caliber === cal) && (!nq || norm(a.item.name).includes(nq)))
      .sort((a: any, b: any) => b.penetrationPower - a.penetrationPower);
  }, [data, cal, q]);

  return (
    <>
      <p className="lead">Главное в патроне — пробитие. Ориентир: пробитие ≥ 10 × класс брони противника. Цветом показан класс, который патрон уверенно пробивает.</p>
      <div className="toolbar">
        <Search value={q} onChange={setQ} placeholder="M995, BS, ПС…" />
        <select value={cal} onChange={(e) => setCal(e.target.value)}>
          <option value="">Все калибры</option>
          {calibers.map((c) => <option key={c} value={c}>{caliberName(c)}</option>)}
        </select>
      </div>
      <State loading={loading} error={error} />
      {data && (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Патрон</th><th>Калибр</th><th>Урон</th><th>Пробитие</th><th>Урон броне</th><th>Скорость</th><th>Цена</th></tr></thead>
            <tbody>
              {list.map((a: any) => (
                <tr key={a.item.id}>
                  <td><div className="cell-item"><Img src={a.item.iconLink} alt="" size={28} />{a.item.shortName || a.item.name}</div></td>
                  <td className="muted">{caliberName(a.caliber)}</td>
                  <td>{a.damage}</td>
                  <td><span className={`pen pen${penClass(a.penetrationPower)}`}>{a.penetrationPower}</span></td>
                  <td>{a.armorDamage}%</td>
                  <td>{a.initialSpeed} м/с</td>
                  <td>{rub(a.item.avg24hPrice)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
