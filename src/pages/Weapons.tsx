import { useMemo, useState } from 'react';
import { useData, State, Search, norm, Img } from '../ui';
import { rub, num, loadItems } from '../api';
import type { Item } from '../api';
import ItemModal, { rowImage, buyPrice } from '../components/ItemModal';
import RefEmpty from '../components/RefEmpty';


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

// Класс брони, который патрон пробивает с хорошим шансом (ориентир: пробитие / 10).
// На самой границе шанс заметно ниже 100%: чем больше запас пробития, тем надёжнее.
export const penClass = (p: number) => Math.min(6, Math.max(0, Math.floor(p / 10)));

/** Цветная шкала: какой класс брони патрон пробивает с хорошим шансом */
export function PenLegend() {
  return (
    <div className="ref-pen-legend small" role="group" aria-label="Цвет пробития — класс брони">
      <span className="muted">С хорошим шансом пробивает класс брони:</span>
      {[1, 2, 3, 4, 5, 6].map((c) => <span key={c} className={`pen pen${c}`} title={`Пробитие ${c * 10}+ — с хорошим шансом пробивает броню ${c} класса; чем больше запас, тем надёжнее`}>{c}</span>)}
    </div>
  );
}

export default function Weapons() {
  const [tab, setTab] = useState<'guns' | 'ammo'>('guns');
  return (
    <section className="ref-page">
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
      price: (a, b) => (buyPrice(a) || 9e9) - (buyPrice(b) || 9e9),
    };
    return list.sort(by[sort]);
  }, [data, q, cal, sort]);
  const calibers = useMemo(() => Array.from(new Set((data?.items || []).map((g: any) => g.gun?.caliber).filter(Boolean))).sort() as string[], [data]);

  return (
    <>
      <div className="toolbar">
        <Search value={q} onChange={setQ} placeholder="АК-74М, M4A1, MP-153…" />
        <select value={cal} onChange={(e) => setCal(e.target.value)} aria-label="Калибр" title="Калибр">
          <option value="">Все калибры</option>
          {calibers.map((c) => <option key={c} value={c}>{caliberName(c)}</option>)}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Сортировка" title="Сортировка">
          <option value="recoil">Сначала меньше отдача</option>
          <option value="ergo">Сначала больше эргономика</option>
          <option value="rate">Сначала скорострельные</option>
          <option value="price">Сначала дешёвые</option>
        </select>
      </div>
      <details className="ref-legend">
        <summary>Что значат цифры</summary>
        <ul>
          <li><b>Отдача 42/246</b> — вертикальная / горизонтальная. Меньше — легче попасть очередью.</li>
          <li><b>Эрго</b> (эргономика) — насколько быстро целиться и как долго можно держать прицел. Больше — лучше.</li>
          <li><b>Выстр./мин</b> — скорострельность.</li>
          <li><b>Цена</b> — дешевле всего купить: на барахолке или у торговца. Цифры — для базовой сборки; обвес их меняет.</li>
        </ul>
      </details>
      <State loading={loading} error={error} />
      {data && guns.length > 0 && <div className="muted small">Найдено: {guns.length} · нажмите на оружие, чтобы открыть карточку</div>}
      {data && guns.length === 0 && (
        <RefEmpty text="Такого оружия не нашлось" hint="Попробуйте часть названия (например, «АК» или «M4») и «Все калибры»."
          onReset={() => { setQ(''); setCal(''); }} />
      )}
      <div className="glist">
        {guns.map((g: any) => {
          const p = g.gun;
          const price = buyPrice(g);
          return (
            <button key={g.id} className="grow-row card" onClick={() => setOpen(g)}>
              <div className="gimg"><GunThumb it={g} /></div>
              <div className="ginfo">
                <div className="title">{g.name}</div>
                <div className="gmeta">
                  <span className="tag" title="Калибр">{caliberName(p.caliber)}</span>
                  <span title="Отдача: вертикальная / горизонтальная. Меньше — лучше">Отдача <b>{num(p.recoilVertical)}</b>/<b>{num(p.recoilHorizontal)}</b></span>
                  <span title="Эргономика: больше — лучше">Эрго <b>{num(p.ergonomics)}</b></span>
                  <span title="Скорострельность"><b>{num(p.fireRate)}</b> выстр./мин</span>
                </div>
              </div>
              <div className="gprice" title="Дешевле всего купить">{price ? <><span className="ref-cap">купить</span>{rub(price)}</> : <span className="ref-cap">не продаётся</span>}</div>
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

function Ammo() {
  const { data, error, loading } = useData(loadItems);
  const [cal, setCal] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('pen');
  const [open, setOpen] = useState<Item | null>(null);
  const ammo = useMemo(() => (data?.items || []).filter((i: any) => i.ammo).map((i: any) => ({ ...i.ammo, item: i, price: buyPrice(i) })), [data]);
  const calibers = useMemo(() => Array.from(new Set(ammo.map((a: any) => a.caliber).filter(Boolean))).sort() as string[], [ammo]);
  const list = useMemo(() => {
    const nq = norm(q);
    const by: Record<string, (a: any, b: any) => number> = {
      pen: (a, b) => b.penetrationPower - a.penetrationPower,
      dmg: (a, b) => b.damage * b.projectileCount - a.damage * a.projectileCount,
      armor: (a, b) => b.armorDamage - a.armorDamage,
      price: (a, b) => (a.price || 9e9) - (b.price || 9e9),
    };
    return ammo
      .filter((a: any) => (!cal || a.caliber === cal) && (!nq || norm(a.item.name).includes(nq) || norm(a.item.shortName).includes(nq)))
      .sort(by[sort]);
  }, [ammo, cal, q, sort]);

  return (
    <>
      <p className="lead">Главное в патроне — пробитие: оно решает, пробьёт ли пуля бронежилет и шлем. Ориентир: пробитие ≥ 10 × класс брони противника.</p>
      <PenLegend />
      <div className="toolbar">
        <Search value={q} onChange={setQ} placeholder="M995, BS, ПС…" />
        <select value={cal} onChange={(e) => setCal(e.target.value)} aria-label="Калибр" title="Калибр">
          <option value="">Все калибры</option>
          {calibers.map((c) => <option key={c} value={c}>{caliberName(c)}</option>)}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Сортировка" title="Сортировка">
          <option value="pen">Сначала большее пробитие</option>
          <option value="dmg">Сначала больший урон</option>
          <option value="armor">Сначала больший урон броне</option>
          <option value="price">Сначала дешёвые</option>
        </select>
      </div>
      <details className="ref-legend">
        <summary>Что значат колонки</summary>
        <ul>
          <li><b>Пробитие</b> — главное. Цвет показывает класс брони, который патрон пробивает с хорошим шансом (шкала выше). Чем больше запас пробития над классом × 10, тем надёжнее.</li>
          <li><b>Урон</b> — по телу без брони. У дроби «25×8» — урон одной дробинки × их число.</li>
          <li><b>Урон броне</b> — насколько быстро патрон ломает броню.</li>
          <li><b>Цена</b> — дешевле всего купить; «—» — купить нельзя, только найти или скрафтить.</li>
        </ul>
      </details>
      <State loading={loading} error={error} />
      {data && list.length === 0 && (
        <RefEmpty text="Такого патрона не нашлось" hint="Попробуйте короткое название (BS, ПС, M995) и «Все калибры»."
          onReset={() => { setQ(''); setCal(''); }} />
      )}
      {data && list.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Патрон</th><th title="Цвет — класс брони, который патрон пробивает с хорошим шансом">Пробитие</th><th>Урон</th><th>Урон броне</th><th>Цена</th><th>Калибр</th><th>Скорость</th></tr></thead>
            <tbody>
              {list.map((a: any) => (
                <tr key={a.item.id} className="click" onClick={() => setOpen(a.item)}>
                  <td><div className="cell-item"><Img src={a.item.iconLink} alt="" size={28} />{a.item.shortName || a.item.name}</div></td>
                  <td><span className={`pen pen${penClass(a.penetrationPower)}`} title={penClass(a.penetrationPower) ? `С хорошим шансом пробивает броню до ${penClass(a.penetrationPower)} класса; чем больше запас, тем надёжнее` : 'Против брони слабый'}>{a.penetrationPower}</span></td>
                  <td>{a.projectileCount > 1 ? `${a.damage}×${a.projectileCount}` : a.damage}</td>
                  <td>{a.armorDamage}%</td>
                  <td>{rub(a.price)}</td>
                  <td className="muted">{caliberName(a.caliber)}</td>
                  <td>{a.initialSpeed} м/с</td>
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
