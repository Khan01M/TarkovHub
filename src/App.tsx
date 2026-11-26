import { useEffect, useRef, useState } from 'react';
import { getGameMode, setGameMode, GameMode } from './api';
import Home from './pages/Home';
import Market from './pages/Market';
import Weapons from './pages/Weapons';
import Bosses from './pages/Bosses';
import Maps from './pages/Maps';
import Quests from './pages/Quests';
import Guides from './pages/Guides';
import Promo from './pages/Promo';
import Overview from './pages/Overview';
import Hideout from './pages/Hideout';
import Terminal from './pages/Terminal';
import ErrorBoundary from './components/ErrorBoundary';
import { useAuth, signIn, signOut } from './auth';
import { THEMES, getTheme, setTheme, ThemeId } from './theme';

// top — в верхнем меню на компьютере, tab — в нижней панели на телефоне; остальное — в «Ещё»
type Route = { id: string; label: string; short?: string; icon: string; hint: string; el: () => JSX.Element; top?: boolean; tab?: boolean };
const ROUTES: Route[] = [
  { id: 'home', label: 'Главная', icon: '⌂', hint: 'С чего начать и все разделы', el: Home, top: true, tab: true },
  { id: 'overview', label: 'Обзор', icon: '◉', hint: 'Мои текущие задания и что взять в рейд', el: Overview, top: true, tab: true },
  { id: 'quests', label: 'Квесты', icon: '✓', hint: 'Задания торговцев, отметки выполненного', el: Quests, top: true, tab: true },
  { id: 'maps', label: 'Карты', icon: '◈', hint: 'Выходы, спавны, точки заданий', el: Maps, top: true, tab: true },
  { id: 'market', label: 'Барахолка', short: 'Цены', icon: '₽', hint: 'Цены и кому выгоднее продать', el: Market, top: true, tab: true },
  { id: 'weapons', label: 'Оружие', icon: '⌖', hint: 'Стволы и пробитие патронов', el: Weapons, top: true },
  { id: 'bosses', label: 'Боссы', icon: '☠', hint: 'Где появляются и с какой охраной', el: Bosses, top: true },
  { id: 'hideout', label: 'Убежище', icon: '▣', hint: 'Что нужно для улучшений', el: Hideout, top: true },
  { id: 'terminal', label: 'Терминал', icon: '⚑', hint: 'Финал сюжета: готовность команды', el: Terminal },
  { id: 'promo', label: 'Промокоды', icon: '★', hint: 'Рабочие коды на снаряжение', el: Promo },
  { id: 'guides', label: 'Гайды', icon: '☰', hint: 'Механики, заработок, лечение', el: Guides },
];
const MODE_NAME: Record<GameMode, string> = { regular: 'PvP', pve: 'PvE' };

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
  const [modeNote, setModeNote] = useState(false);
  const current = ROUTES.find((r) => r.id === route) || ROUTES[0];
  const Page = current.el;

  useEffect(() => {
    if (!modeNote) return;
    const t = setTimeout(() => setModeNote(false), 4000);
    return () => clearTimeout(t);
  }, [modeNote, mode]);
  const switchMode = (m: GameMode) => {
    if (m === mode) return;
    setGameMode(m); setMode(m); setModeNote(true);
  };

  return (
    <div className="app">
      <header className="topbar">
        <a href="#/home" className="brand" title="На главную"><img src="./icon.svg" alt="" width={26} height={26} /> <span className="nav-brand-text">Tarkov Hub</span></a>
        <nav className="nav" aria-label="Разделы">
          {ROUTES.filter((r) => r.top).map((r) => (
            <a key={r.id} href={`#/${r.id}`} className={r.id === current.id ? 'active' : ''} aria-current={r.id === current.id ? 'page' : undefined}>{r.label}</a>
          ))}
        </nav>
        <MoreMenu variant="top" current={current.id} />
        <AuthButton />
        <ThemeButton />
        <div className="mode" role="group" aria-label="Режим игры"
          title="Режим игры. PvP — обычный онлайн, PvE — против ботов. У каждого режима свои цены, квесты и отметки прогресса">
          {(['regular', 'pve'] as GameMode[]).map((m) => (
            <button key={m} className={mode === m ? 'on' : ''} aria-pressed={mode === m} onClick={() => switchMode(m)}>{MODE_NAME[m]}</button>
          ))}
        </div>
      </header>
      {/* Контейнер живёт всегда, меняется только текст — иначе скринридеры не озвучат подсказку */}
      <div className={`nav-toast${modeNote ? ' on' : ''}`} role="status">
        {modeNote ? `Режим ${MODE_NAME[mode]}: цены, квесты и отметки прогресса — для ${MODE_NAME[mode]}.` : ''}
      </div>
      <main className="content" key={current.id + mode}>
        <ErrorBoundary key={current.id + mode}>
          <Page />
        </ErrorBoundary>
      </main>
      <nav className="tabbar" aria-label="Разделы">
        {ROUTES.filter((r) => r.tab).map((r) => (
          <a key={r.id} href={`#/${r.id}`} className={r.id === current.id ? 'active' : ''} aria-current={r.id === current.id ? 'page' : undefined}>
            <span className="ti" aria-hidden="true">{r.icon}</span><span>{r.short || r.label}</span>
          </a>
        ))}
        <MoreMenu variant="tab" current={current.id} />
      </nav>
      <footer className="footer">
        Данные: <a href="https://tarkov.dev" target="_blank" rel="noreferrer">tarkov.dev</a> (открытый API).
        Неофициальный фан-проект, не связан с Battlestate Games.
      </footer>
    </div>
  );
}

/** «Ещё»: на компьютере — выпадающий список у меню, на телефоне — панель над нижними вкладками */
function MoreMenu({ variant, current }: { variant: 'top' | 'tab'; current: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const items = ROUTES.filter((r) => (variant === 'top' ? !r.top : !r.tab));
  const inside = items.find((r) => r.id === current);
  useEffect(() => { setOpen(false); }, [current]);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const link = (r: Route) => (
    <a key={r.id} href={`#/${r.id}`} className={`nav-more-item${r.id === current ? ' on' : ''}`} aria-current={r.id === current ? 'page' : undefined}
      onClick={() => setOpen(false)}>
      <span className="nav-more-ico" aria-hidden="true">{r.icon}</span>
      <span className="grow"><b>{r.label}</b><span className="muted small">{r.hint}</span></span>
    </a>
  );
  return (
    <div className={`nav-more nav-more-${variant}`} ref={ref}>
      <button className={`nav-more-btn${inside ? ' active' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open}
        aria-label={`Ещё разделы${inside ? `, открыт: ${inside.label}` : ''}`}>
        {variant === 'tab'
          ? <><span className="ti" aria-hidden="true">⋯</span><span>{inside ? inside.label : 'Ещё'}</span></>
          : <>{inside ? inside.label : 'Ещё'} <span aria-hidden="true">▾</span></>}
      </button>
      {open && (
        <>
          {variant === 'tab' && <div className="nav-more-backdrop" aria-hidden="true" onClick={() => setOpen(false)} />}
          <div className="nav-more-menu">
            {variant === 'tab' && <div className="nav-more-cap muted small">Ещё разделы</div>}
            {items.map(link)}
          </div>
        </>
      )}
    </div>
  );
}

function AuthButton() {
  const a = useAuth();
  if (a.status === 'off' || a.status === 'app') return null;
  if (a.status === 'loading') return <span className="auth muted small" role="status"><span className="spinner" aria-hidden="true" /><span className="nav-sr">Проверяем вход</span></span>;
  if (a.status === 'signedOut' || (a.status === 'error' && !a.userId)) {
    return (
      <button className="btn small auth-btn nav-login" onClick={() => { signIn().catch((e) => console.warn('signIn:', e)); }}
        title={a.error ? `Ошибка входа: ${a.error}` : 'Вход через Discord: отметки квестов сохранятся в аккаунте и будут видны вашей команде'}>
        Войти<span className="nav-wide"> через Discord</span>
      </button>
    );
  }
  const why = a.status === 'denied' ? 'Этого аккаунта нет в списке игроков — отметки хранятся только на этом устройстве'
    : a.status === 'error' ? `Не удалось проверить доступ: ${a.error}` : `Вы вошли как ${a.name}. Отметки сохраняются в аккаунте`;
  return (
    <div className="auth" title={why}>
      {a.avatar && <img src={a.avatar} alt="" width={24} height={24} className="avatar" />}
      <span className="auth-name">{a.name}</span>
      {a.status === 'denied' && <span className="badge bad">нет доступа</span>}
      {a.status === 'error' && <span className="badge bad">ошибка</span>}
      <button className="linkbtn small nav-logout" onClick={signOut} aria-label={`Выйти из аккаунта ${a.name || ''}`.trim()}>Выйти</button>
    </div>
  );
}

function ThemeButton() {
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState<ThemeId>(getTheme());
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const pick = (id: ThemeId) => { setTheme(id); setCur(id); setOpen(false); };
  return (
    <div className="theme" ref={ref}>
      <button className="theme-btn" onClick={() => setOpen(!open)} aria-haspopup="true" aria-expanded={open}
        title={`Оформление: ${THEMES.find((t) => t.id === cur)?.name}`} aria-label="Сменить оформление">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.9 1.8-1.8 0-.5-.2-.9-.5-1.3-.3-.3-.5-.8-.5-1.2 0-1 .8-1.7 1.8-1.7H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3Z" />
          <circle cx="7.5" cy="11" r="1.2" fill="currentColor" /><circle cx="10.5" cy="7.2" r="1.2" fill="currentColor" />
          <circle cx="15" cy="7.5" r="1.2" fill="currentColor" />
        </svg>
      </button>
      {open && (
        <div className="theme-menu" role="menu">
          {THEMES.map((t) => (
            <button key={t.id} role="menuitemradio" aria-checked={t.id === cur} className={`theme-item ${t.id === cur ? 'on' : ''}`} onClick={() => pick(t.id)}>
              <span className={`theme-swatch sw-${t.id}`} />{t.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
