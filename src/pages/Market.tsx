import { useMemo, useState } from 'react';
import { useData, State, Search, norm, Img, safeUrl } from '../ui';
import { rub, num, loadItems } from '../api';


const CATS: [string, string][] = [
  ['', 'Все'], ['barter', 'Бартер'], ['keys', 'Ключи'], ['ammo', 'Патроны'], ['gun', 'Оружие'],
  ['mods', 'Модули'], ['meds', 'Медицина'], ['provisions', 'Еда/вода'], ['armor', 'Броня'],
  ['helmet', 'Шлемы'], ['rig', 'Разгрузки'], ['backpack', 'Рюкзаки'], ['container', 'Контейнеры'],
];

const SORTS: [string, string][] = [
  ['flea', 'Цена на барахолке'], ['slot', 'Цена за клетку'], ['trader', 'Продажа торговцу'],
  ['change', 'Изменение за 48ч'], ['name', 'Название'],
];

const FLEA = 'Барахолка';
const isFlea = (v?: string) => !!v && (v === 'Flea Market' || v === 'FleaMarket' || norm(v).includes('барахолк'));

export default function Market() {
  const { data, error, loading } = useData(loadItems);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [sort, setSort] = useState('flea');
  const [limit, setLimit] = useState(60);
  const [open, setOpen] = useState<string | null>(null);

  const rows = useMemo(() => {
    const items = (data?.items || []).map((it: any) => {
      const traders = [...(it.sellFor || [])].filter((s: any) => !isFlea(s.vendor?.name));
      const best = traders.sort((a: any, b: any) => b.priceRUB - a.priceRUB)[0];
      const flea = it.avg24hPrice || it.lastLowPrice || 0;
      const slots = Math.max(1, (it.width || 1) * (it.height || 1));
      return { ...it, best, flea, perSlot: Math.max(flea, best?.priceRUB || 0) / slots, slots };
    });
    const nq = norm(q);
    let r = items.filter((it: any) =>
      !it.types?.includes('preset') && (!cat || it.types?.includes(cat)) &&
      (!nq || norm(it.name).includes(nq) || norm(it.shortName).includes(nq)));
    const by: Record<string, (a: any, b: any) => number> = {
      flea: (a, b) => b.flea - a.flea,
      slot: (a, b) => b.perSlot - a.perSlot,
      trader: (a, b) => (b.best?.priceRUB || 0) - (a.best?.priceRUB || 0),
      change: (a, b) => (b.changeLast48hPercent || 0) - (a.changeLast48hPercent || 0),
      name: (a, b) => a.name.localeCompare(b.name, 'ru'),
    };
    return r.sort(by[sort]);
  }, [data, q, cat, sort]);

  return (
    <section>
      <h1>Барахолка и цены</h1>
      <p className="lead">Средняя цена за 24 часа, лучший торговец для продажи и цена за клетку — чтобы понимать, что тащить из рейда.</p>
      <div className="toolbar">
        <Search value={q} onChange={(v) => { setQ(v); setLimit(60); }} placeholder="Например: Слоны, GPU, LEDX, ключ…" />
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <div className="chips">
        {CATS.map(([v, l]) => <button key={v} className={cat === v ? 'chip on' : 'chip'} onClick={() => { setCat(v); setLimit(60); }}>{l}</button>)}
      </div>
      <State loading={loading} error={error} />
      {data && <div className="muted small">Найдено: {rows.length}</div>}
      <div className="list">
        {rows.slice(0, limit).map((it: any) => (
          <div key={it.id} className="row card" onClick={() => setOpen(open === it.id ? null : it.id)}>
            <div className="row-main">
              <Img src={it.iconLink} alt={it.shortName} />
              <div className="grow">
                <div className="title">{it.name}</div>
                <div className="muted small">
                  {it.types?.includes('noFlea') ? 'Нельзя продать на барахолке · ' : ''}
                  {it.slots} кл. · за клетку {rub(it.perSlot)}
                </div>
              </div>
              <div className="prices">
                <div className="price">{rub(it.flea)}</div>
                {it.changeLast48hPercent != null && it.changeLast48hPercent !== 0 && (
                  <div className={it.changeLast48hPercent > 0 ? 'up small' : 'down small'}>
                    {it.changeLast48hPercent > 0 ? '▲' : '▼'} {num(Math.abs(it.changeLast48hPercent), 1)}%
                  </div>
                )}
                <div className="muted small">{it.best ? `${it.best.vendor.name}: ${rub(it.best.priceRUB)}` : 'торговцы не берут'}</div>
              </div>
            </div>
            {open === it.id && (
              <div className="details" onClick={(e) => e.stopPropagation()}>
                <div className="grid2">
                  <div>
                    <h4>Продать</h4>
                    {[...(it.sellFor || [])].sort((a: any, b: any) => b.priceRUB - a.priceRUB).map((s: any, i: number) => (
                      <div key={i} className="kv"><span>{isFlea(s.vendor?.name) ? FLEA : s.vendor?.name}</span><b>{rub(s.priceRUB)}</b></div>
                    ))}
                  </div>
                  <div>
                    <h4>Купить</h4>
                    {(it.buyFor || []).length === 0 && <div className="muted small">Не продаётся</div>}
                    {[...(it.buyFor || [])].sort((a: any, b: any) => a.priceRUB - b.priceRUB).map((s: any, i: number) => (
                      <div key={i} className="kv"><span>{isFlea(s.vendor?.name) ? FLEA : s.vendor?.name}</span><b>{rub(s.priceRUB)}</b></div>
                    ))}
                  </div>
                </div>
                <div className="kv"><span>Минимум за 24ч</span><b>{rub(it.low24hPrice)}</b></div>
                <div className="kv"><span>Последняя цена</span><b>{rub(it.lastLowPrice)}</b></div>
                {safeUrl(it.wikiLink) && <a className="link" href={safeUrl(it.wikiLink)} target="_blank" rel="noreferrer">Открыть в Wiki ↗</a>}
              </div>
            )}
          </div>
        ))}
      </div>
      {rows.length > limit && <button className="more" onClick={() => setLimit(limit + 60)}>Показать ещё</button>}
    </section>
  );
}
