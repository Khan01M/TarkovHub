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
import { useAuth, signIn, signOut } from './auth';

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
        <AuthButton />
        <div className="mode" title="Режим игры: цены, квесты и прогресс отличаются">
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

function AuthButton() {
  const a = useAuth();
  if (a.status === 'off' || a.status === 'app') return null;
  if (a.status === 'loading') return <span className="auth muted small"><span className="spinner" /></span>;
  if (a.status === 'signedOut' || (a.status === 'error' && !a.userId)) {
    return <button className="btn small auth-btn" onClick={signIn} title={a.error || 'Вход для игроков из списка'}>Войти</button>;
  }
  return (
    <div className="auth" title={a.status === 'denied' ? 'У этого аккаунта нет доступа' : a.status === 'error' ? a.error : 'Вы вошли'}>
      {a.avatar && <img src={a.avatar} alt="" width={24} height={24} className="avatar" />}
      <span className="auth-name">{a.name}</span>
      {a.status === 'denied' && <span className="badge bad">нет доступа</span>}
      {a.status === 'error' && <span className="badge bad">ошибка</span>}
      <button className="linkbtn small" onClick={signOut}>Выйти</button>
    </div>
  );
}
