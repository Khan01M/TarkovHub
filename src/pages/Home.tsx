import { useEffect, useMemo, useRef, useState } from 'react';
import { useData, Img } from '../ui';
import { rub, loadItems, getGameMode } from '../api';
import { useProgress } from '../progress';
import { hasTerminalProgress, personalSteps, summarize } from '../terminal';
import { desktop } from '../position';

const SECTIONS = [
  { href: '#/overview', title: 'Обзор', text: 'Текущие задания, приоритет карт, что взять в рейд, «Оружейник»', icon: '◉' },
  { href: '#/market', title: 'Барахолка', text: 'Цены за 24 часа, лучший торговец, цена за клетку', icon: '₽' },
  { href: '#/weapons', title: 'Оружие и патроны', text: 'Отдача, эргономика, пробитие патронов', icon: '⌖' },
  { href: '#/bosses', title: 'Боссы', text: 'Где появляются, шанс спавна, охрана', icon: '☠' },
  { href: '#/maps', title: 'Карты', text: 'Выходы, спавны, ваша позиция в рейде', icon: '◈' },
  { href: '#/quests', title: 'Квесты', text: 'Задания торговцев и трекер прогресса', icon: '✓' },
  { href: '#/hideout', title: 'Убежище', text: 'Уровни модулей и общий список предметов для квестов и убежища', icon: '▣' },
  { href: '#/terminal', title: 'Терминал', text: 'Финал сюжета: пропуск, переход с Берега, готовность команды', icon: '⚑' },
  { href: '#/promo', title: 'Промокоды', text: 'Рабочие коды на снаряжение и как их активировать', icon: '★' },
  { href: '#/guides', title: 'Гайды', text: 'Механики, заработок, лечение', icon: '☰' },
];


export default function Home() {
  const { data } = useData(loadItems);
  // Строка «До Терминала» — только по отметкам прогресса, без загрузки данных tarkov.dev
  const progress = useProgress(getGameMode());
  // Показываем, только когда прогресс точно загружен: иначе у вошедшего игрока сначала мелькнут локальные отметки
  const who = progress.source === 'account' ? 'a:' + progress.auth.userId : 'local';
  const sawLoading = useRef('');
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (progress.source !== 'account') { setReady(progress.auth.status !== 'loading'); return; }
    if (progress.loading) { sawLoading.current = who; setReady(false); return; }
    setReady(sawLoading.current === who && !progress.loadError);
  }, [who, progress.source, progress.loading, progress.loadError, progress.auth.status]);
  const term = useMemo(() => (ready && hasTerminalProgress(progress.done) ? summarize(personalSteps(progress.done)) : null), [ready, progress.done]);
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
            {s.href === '#/terminal' && term && <div className="small tm-home">До Терминала: {term.done} из {term.total}{term.next ? <>, дальше: {term.next.label}</> : ' — всё готово'}</div>}
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
