import { useEffect, useState } from 'react';
import { getGameMode, setGameMode, GameMode } from './api';
import Home from './pages/Home';
import Market from './pages/Market';
import Weapons from './pages/Weapons';
import Bosses from './pages/Bosses';
import Maps from './pages/Maps';
import Quests from './pages/Quests';
import Guides from './pages/Guides';
import Promo from './pages/Promo';

const ROUTES: { id: string; label: string; short?: string; icon: string; el: () => JSX.Element }[] = [
  { id: 'home', label: 'Главная', icon: '⌂', el: Home },
  { id: 'market', label: 'Барахолка', icon: '₽', el: Market },
  { id: 'weapons', label: 'Оружие', icon: '⌖', el: Weapons },
  { id: 'bosses', label: 'Боссы', icon: '☠', el: Bosses },
  { id: 'maps', label: 'Карты', icon: '◈', el: Maps },
  { id: 'quests', label: 'Квесты', icon: '✓', el: Quests },
  { id: 'promo', label: 'Промокоды', short: 'Коды', icon: '★', el: Promo },
  { id: 'guides', label: 'Гайды', icon: '☰', el: Guides },
];

// Роутинг через #hash — работает и на сайте, и в EXE (file://), и в APK.
function useHash() {
  const read = () => (location.hash.replace(/^#\/?/, '').split('/')[0] || 'home');
  const [r, setR] = useState(read);
  useEffect(() => {
    const f = () => { setR(read()); window.scrollTo(0, 0); };
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);
  return r;
}

export default function App() {
  const route = useHash();
  const [mode, setMode] = useState<GameMode>(getGameMode());
  const current = ROUTES.find((r) => r.id === route) || ROUTES[0];
  const Page = current.el;

  const switchMode = (m: GameMode) => { setGameMode(m); setMode(m); };

  return (
    <div className="app">
      <header className="topbar">
        <a href="#/home" className="brand"><img src="./icon.svg" alt="" width={26} height={26} /> Tarkov Hub</a>
        <nav className="nav">
          {ROUTES.map((r) => (
            <a key={r.id} href={`#/${r.id}`} className={r.id === current.id ? 'active' : ''}>{r.label}</a>
          ))}
        </nav>
        <div className="mode" title="Режим игры: цены и данные отличаются">
          <button className={mode === 'regular' ? 'on' : ''} onClick={() => switchMode('regular')}>PvP</button>
          <button className={mode === 'pve' ? 'on' : ''} onClick={() => switchMode('pve')}>PvE</button>
        </div>
      </header>
      <main className="content" key={current.id + mode}>
        <Page />
      </main>
      <nav className="tabbar">
        {ROUTES.slice(1).map((r) => (
          <a key={r.id} href={`#/${r.id}`} className={r.id === current.id ? 'active' : ''}>
            <span className="ti">{r.icon}</span><span>{r.short || r.label}</span>
          </a>
        ))}
      </nav>
      <footer className="footer">
        Данные: <a href="https://tarkov.dev" target="_blank" rel="noreferrer">tarkov.dev</a> (открытый API).
        Неофициальный фан-проект, не связан с Battlestate Games.
      </footer>
    </div>
  );
}
