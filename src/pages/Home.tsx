import { useMemo } from 'react';
import { useData, Img } from '../ui';
import { rub, loadItems } from '../api';
import { desktop } from '../position';

const SECTIONS = [
  { href: '#/market', title: 'Барахолка', text: 'Цены за 24 часа, лучший торговец, цена за клетку', icon: '₽' },
  { href: '#/weapons', title: 'Оружие и патроны', text: 'Отдача, эргономика, пробитие патронов', icon: '⌖' },
  { href: '#/bosses', title: 'Боссы', text: 'Где появляются, шанс спавна, охрана', icon: '☠' },
  { href: '#/maps', title: 'Карты', text: 'Выходы, спавны, ваша позиция в рейде', icon: '◈' },
  { href: '#/quests', title: 'Квесты', text: 'Задания торговцев и трекер прогресса', icon: '✓' },
  { href: '#/promo', title: 'Промокоды', text: 'Рабочие коды на снаряжение и как их активировать', icon: '★' },
  { href: '#/guides', title: 'Гайды', text: 'Механики, заработок, лечение', icon: '☰' },
];


export default function Home() {
  const { data } = useData(loadItems);
  const top = useMemo(() => (data?.items || []).filter((i: any) => i.avg24hPrice && i.types.includes('barter')).sort((a: any, b: any) => b.avg24hPrice - a.avg24hPrice).slice(0, 6), [data]);
  return (
    <section>
      <div className="hero">
        <h1>Всё о Таркове в одном месте</h1>
        <p>Цены барахолки, оружие, боссы, карты с выходами и квесты — данные обновляются автоматически.
          {desktop ? ' Связь с игрой включена: позиция в рейде появится на карте после скриншота.' : ''}</p>
      </div>
      <div className="cards">
        {SECTIONS.map((s) => (
          <a key={s.href} href={s.href} className="card section-card">
            <span className="big-icon">{s.icon}</span>
            <div className="title">{s.title}</div>
            <div className="muted small">{s.text}</div>
          </a>
        ))}
      </div>
      {top.length > 0 && (
        <>
          <h2>Дорогой лут сейчас</h2>
          <div className="list">
            {top.map((i: any) => (
              <a key={i.id} href="#/market" className="row card"><div className="row-main"><Img src={i.iconLink} alt="" size={36} /><div className="grow title">{i.name}</div><div className="price">{rub(i.avg24hPrice)}</div></div></a>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
