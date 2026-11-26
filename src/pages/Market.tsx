import { useMemo, useState } from 'react';
import { useData, State, Search, norm, Img } from '../ui';
import { rub, num, loadItems } from '../api';
import ItemModal, { traderSellOffers } from '../components/ItemModal';
import RefEmpty from '../components/RefEmpty';


const CATS: [string, string][] = [
  ['', 'Все'], ['barter', 'Бартер'], ['keys', 'Ключи'], ['ammo', 'Патроны'], ['gun', 'Оружие'],
  ['mods', 'Модули'], ['meds', 'Медицина'], ['provisions', 'Еда/вода'], ['armor', 'Броня'],
  ['helmet', 'Шлемы'], ['rig', 'Разгрузки'], ['backpack', 'Рюкзаки'], ['container', 'Контейнеры'],
];

const SORTS: [string, string][] = [
  ['flea', 'Цена на барахолке'], ['slot', 'Цена за клетку'], ['trader', 'Продажа торговцу'],
  ['change', 'Изменение за 48ч'], ['name', 'Название'],
];

export default function Market() {
  const { data, error, loading } = useData(loadItems);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [sort, setSort] = useState('flea');
  const [limit, setLimit] = useState(60);
  const [open, setOpen] = useState<any>(null);

  const rows = useMemo(() => {
    const items = (data?.items || []).map((it: any) => {
      const traders = traderSellOffers(it);
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

  const reset = () => { setQ(''); setCat(''); setLimit(60); };

  return (
    <section className="ref-page">
      <h1>Барахолка и цены</h1>
      <p className="lead">Сколько стоит лут и кому его выгоднее продать. Нажмите на предмет — откроются все цены.</p>
      <div className="toolbar">
        <Search value={q} onChange={(v) => { setQ(v); setLimit(60); }} placeholder="Например: Слоны, GPU, LEDX, ключ…" />
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Сортировка" title="Сортировка">
          {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <div className="chips">
        {CATS.map(([v, l]) => <button key={v} className={cat === v ? 'chip on' : 'chip'} onClick={() => { setCat(v); setLimit(60); }}>{l}</button>)}
      </div>
      <details className="ref-legend">
        <summary>Что значат цены</summary>
        <ul>
          <li><b className="accent">Крупная цена</b> — средняя на барахолке за последние 24 часа. ▲▼ — как она изменилась за 48 часов.</li>
          <li><b>Ниже</b> — сколько даст лучший торговец. <span className="ref-better">Зелёным</span> — когда торговцу продать не дешевле, чем на барахолке (и без комиссии).</li>
          <li><b>За клетку</b> — цена, делённая на размер предмета. Чем выше, тем выгоднее занимать им место в рюкзаке.</li>
          <li>«Нельзя на барахолке» — такой предмет можно продать только торговцу.</li>
          <li>В списке торговец сравнивается со средней ценой за 24 ч, а в окне предмета — с самым дешёвым лотом сейчас, поэтому вывод «где выгоднее» иногда отличается.</li>
        </ul>
      </details>
      <State loading={loading} error={error} />
      {data && rows.length > 0 && <div className="muted small">Найдено: {rows.length}</div>}
      {data && rows.length === 0 && (
        <RefEmpty text={q ? `По запросу «${q}» ничего нет` : 'В этой категории ничего нет'}
          hint="Попробуйте часть названия или короткое имя (GPU, LEDX, «Слоны») и категорию «Все»." onReset={reset} />
      )}
      <div className="list">
        {rows.slice(0, limit).map((it: any) => {
          const noFlea = it.types?.includes('noFlea');
          const traderBetter = !!it.best && it.best.priceRUB >= it.flea;
          return (
            <div key={it.id} className="row card" onClick={() => setOpen(it)}>
              <div className="row-main">
                <Img src={it.iconLink} alt={it.shortName} />
                <div className="grow">
                  <div className="title">{it.name}</div>
                  <div className="muted small">{it.slots} кл. · за клетку <b className="ref-num">{rub(it.perSlot)}</b></div>
                </div>
                <div className="prices">
                  {it.flea > 0
                    ? <div className="price" title="Средняя цена на барахолке за 24 часа">{rub(it.flea)}</div>
                    : <div className="small ref-noflea">{noFlea ? 'нельзя на барахолке' : 'нет цены барахолки'}</div>}
                  {it.changeLast48hPercent != null && it.changeLast48hPercent !== 0 && (
                    <div className={it.changeLast48hPercent > 0 ? 'up small' : 'down small'} title="Изменение цены за 48 часов">
                      {it.changeLast48hPercent > 0 ? '▲' : '▼'} {num(Math.abs(it.changeLast48hPercent), 1)}%
                    </div>
                  )}
                  <div className={`small ${traderBetter ? 'ref-better' : 'muted'}`} title="Лучшая цена продажи торговцу">
                    {it.best ? `${it.best.vendor.name}: ${rub(it.best.priceRUB)}` : 'торговцы не берут'}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {rows.length > limit && <button className="more" onClick={() => setLimit(limit + 60)}>Показать ещё</button>}
      {open && <ItemModal item={open} allItems={data?.items} onClose={() => setOpen(null)} onOpen={setOpen} />}
    </section>
  );
}
