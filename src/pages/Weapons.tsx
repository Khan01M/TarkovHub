import { useMemo, useState } from 'react';
import { useData, State, Search, norm, Img } from '../ui';
import { rub, num, loadItems } from '../api';
import type { Item } from '../api';
import ItemModal, { rowImage } from '../components/ItemModal';


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
export const penClass = (p: number) => Math.min(6, Math.max(0, Math.floor(p / 10)));

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
  const { data, error, loading } = useData(loadItems);
  const [q, setQ] = useState('');
  const [cal, setCal] = useState('');
  const [sort, setSort] = useState('recoil');
  const [open, setOpen] = useState<Item | null>(null);
  const guns = useMemo(() => {
    const nq = norm(q);
    const list = (data?.items || []).filter((g: any) => g.gun?.caliber &&
      (!cal || g.gun.caliber === cal) && (!nq || norm(g.name).includes(nq) || norm(g.shortName).includes(nq)));
    const by: Record<string, (a: any, b: any) => number> = {
      recoil: (a, b) => (a.gun.recoilVertical || 0) - (b.gun.recoilVertical || 0),
      ergo: (a, b) => (b.gun.ergonomics || 0) - (a.gun.ergonomics || 0),
      rate: (a, b) => (b.gun.fireRate || 0) - (a.gun.fireRate || 0),
      price: (a, b) => (a.avg24hPrice || 9e9) - (b.avg24hPrice || 9e9),
    };
    return list.sort(by[sort]);
  }, [data, q, cal, sort]);
  const calibers = useMemo(() => Array.from(new Set((data?.items || []).map((g: any) => g.gun?.caliber).filter(Boolean))).sort() as string[], [data]);

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
      {data && <div className="muted small">Найдено: {guns.length} · нажмите на оружие, чтобы открыть карточку</div>}
      <div className="glist">
        {guns.map((g: any) => {
          const p = g.gun;
          const price = g.avg24hPrice || [...(g.buyFor || [])].sort((a: any, b: any) => a.priceRUB - b.priceRUB)[0]?.priceRUB;
          return (
            <button key={g.id} className="grow-row card" onClick={() => setOpen(g)}>
              <div className="gimg"><GunThumb it={g} /></div>
              <div className="ginfo">
                <div className="title">{g.name}</div>
                <div className="gmeta">
                  <span className="tag">{caliberName(p.caliber)}</span>
                  <span>Отдача <b>{num(p.recoilVertical)}</b>/<b>{num(p.recoilHorizontal)}</b></span>
                  <span>Эрго <b>{num(p.ergonomics)}</b></span>
                  <span><b>{num(p.fireRate)}</b> выстр./мин</span>
                </div>
              </div>
              <div className="gprice">{rub(price)}</div>
            </button>
          );
        })}
      </div>
      {open && <ItemModal item={open} allItems={data?.items} onClose={() => setOpen(null)} onOpen={setOpen} />}
    </>
  );
}

function GunThumb({ it }: { it: Item }) {
  const [bad, setBad] = useState(false);
  const src = rowImage(it);
  if (!src || bad) return <Img src={it.iconLink} alt={it.shortName} size={64} />;
  return <img src={src} alt={it.shortName} loading="lazy" onError={() => setBad(true)} />;
}

// Цена патрона: средняя на барахолке, а если там его нет — самая дешёвая у торговцев
const ammoPrice = (it: any) => {
  if (it.avg24hPrice) return it.avg24hPrice;
  const p = (it.buyFor || []).map((o: any) => o.priceRUB).filter((x: number) => x > 0);
  return p.length ? Math.min(...p) : null;
};

function Ammo() {
  const { data, error, loading } = useData(loadItems);
  const [cal, setCal] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Item | null>(null);
  const ammo = useMemo(() => (data?.items || []).filter((i: any) => i.ammo).map((i: any) => ({ ...i.ammo, item: i })), [data]);
  const calibers = useMemo(() => Array.from(new Set(ammo.map((a: any) => a.caliber).filter(Boolean))).sort() as string[], [ammo]);
  const list = useMemo(() => {
    const nq = norm(q);
    return ammo
      .filter((a: any) => (!cal || a.caliber === cal) && (!nq || norm(a.item.name).includes(nq)))
      .sort((a: any, b: any) => b.penetrationPower - a.penetrationPower);
  }, [ammo, cal, q]);

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
                <tr key={a.item.id} className="click" onClick={() => setOpen(a.item)}>
                  <td><div className="cell-item"><Img src={a.item.iconLink} alt="" size={28} />{a.item.shortName || a.item.name}</div></td>
                  <td className="muted">{caliberName(a.caliber)}</td>
                  <td>{a.projectileCount > 1 ? `${a.damage}×${a.projectileCount}` : a.damage}</td>
                  <td><span className={`pen pen${penClass(a.penetrationPower)}`}>{a.penetrationPower}</span></td>
                  <td>{a.armorDamage}%</td>
                  <td>{a.initialSpeed} м/с</td>
                  <td>{rub(ammoPrice(a.item))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && <ItemModal item={open} allItems={data?.items} onClose={() => setOpen(null)} onOpen={setOpen} />}
    </>
  );
}
