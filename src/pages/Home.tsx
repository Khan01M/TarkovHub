import { useEffect, useMemo, useRef, useState } from 'react';
import { useData, Img } from '../ui';
import { rub, loadItems, getGameMode } from '../api';
import { useProgress } from '../progress';
import { useAuth, signIn } from '../auth';
import { hasTerminalProgress, personalSteps, summarize } from '../terminal';
import { desktop } from '../position';

type Section = { href: string; title: string; text: string; icon: string };
const GROUPS: { title: string; text: string; items: Section[] }[] = [
  {
    title: 'Мои задания и прогресс', text: 'Отмечайте сделанное — сайт подскажет, что делать дальше',
    items: [
      { href: '#/overview', title: 'Обзор', text: 'Текущие задания: на какую карту идти и что взять с собой', icon: '◉' },
      { href: '#/quests', title: 'Квесты', text: 'Все задания торговцев. Здесь отмечаете выполненное', icon: '✓' },
      { href: '#/hideout', title: 'Убежище', text: 'Что нужно для улучшений — какие предметы не продавать', icon: '▣' },
      { href: '#/terminal', title: 'Терминал', text: 'Финал сюжета: пропуск, переход с Берега, готовность команды', icon: '⚑' },
    ],
  },
  {
    title: 'Перед рейдом', text: 'Справочник: карты, враги, снаряжение и цены',
    items: [
      { href: '#/maps', title: 'Карты', text: desktop ? 'Выходы, спавны, точки заданий и ваша позиция в рейде' : 'Выходы, спавны и точки заданий', icon: '◈' },
      { href: '#/bosses', title: 'Боссы', text: 'Где появляются, с каким шансом и какой охраной', icon: '☠' },
      { href: '#/weapons', title: 'Оружие и патроны', text: 'Какой патрон пробивает броню, отдача и эргономика стволов', icon: '⌖' },
      { href: '#/market', title: 'Барахолка', text: 'Сколько стоит предмет и кому его выгоднее продать', icon: '₽' },
    ],
  },
  {
    title: 'Полезное', text: '',
    items: [
      { href: '#/guides', title: 'Гайды', text: 'Механики, заработок, лечение — для новичков и не только', icon: '☰' },
      { href: '#/promo', title: 'Промокоды', text: 'Рабочие коды на снаряжение и как их активировать', icon: '★' },
    ],
  },
];

const START_KEY = 'nav:startHidden';
// Ответ Supabase с ошибкой signIn сам кладёт в состояние auth; исключение (например, не загрузился модуль) — только в консоль
const login = () => { signIn().catch((e) => console.warn('signIn:', e)); };

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
  const [hideStart, setHideStart] = useState(() => { try { return localStorage.getItem(START_KEY) === '1'; } catch { return false; } });
  const toggleStart = (v: boolean) => { setHideStart(v); try { if (v) localStorage.setItem(START_KEY, '1'); else localStorage.removeItem(START_KEY); } catch { /* ignore */ } };

  return (
    <section>
      <div className="hero">
        <h1>Справочник по Таркову на русском</h1>
        <p>Квесты с трекером прогресса для вас и друзей, карты с выходами, боссы, оружие и цены барахолки. Данные обновляются автоматически.
          {desktop ? ' Связь с игрой включена: позиция в рейде появится на карте после скриншота.' : ''}</p>
        {hideStart && <button className="linkbtn small nav-start-show" onClick={() => toggleStart(false)}>С чего начать?</button>}
      </div>
      {!hideStart && <StartSteps onHide={() => toggleStart(true)} />}
      {GROUPS.map((g) => (
        <div key={g.title} className="nav-group">
          <h2>{g.title}{g.text && <span className="muted small nav-group-sub">{g.text}</span>}</h2>
          <div className="cards">
            {g.items.map((s) => (
              <a key={s.href} href={s.href} className="card section-card">
                <span className="big-icon" aria-hidden="true">{s.icon}</span>
                <div className="title">{s.title}</div>
                <div className="muted small">{s.text}</div>
                {s.href === '#/terminal' && term && <div className="small tm-home">До Терминала: {term.done} из {term.total}{term.next ? <>, дальше: {term.next.label}</> : ' — всё готово'}</div>}
              </a>
            ))}
          </div>
        </div>
      ))}
      {top.length > 0 && (
        <>
          <h2>Дорогой лут сейчас <span className="muted small nav-group-sub">что ценнее всего нести из рейда</span></h2>
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

/** Первые шаги для новичка: режим, вход, отметки, план на рейд */
function StartSteps({ onHide }: { onHide: () => void }) {
  const a = useAuth();
  const mode = getGameMode() === 'pve' ? 'PvE' : 'PvP';
  const signedIn = a.status === 'allowed';
  const canSignIn = a.status === 'signedOut' || (a.status === 'error' && !a.userId);
  return (
    <div className="card nav-start">
      <div className="ov-head">
        <h2 className="nav-start-title">С чего начать</h2>
        <button className="linkbtn small" onClick={onHide}>Скрыть</button>
      </div>
      <ol className="nav-steps">
        <li>
          <b>Выберите режим: PvP или PvE.</b> Сейчас — <b>{mode}</b>. Переключатель вверху экрана.
          <span className="muted"> PvP — обычный онлайн с живыми игроками, PvE — против ботов. Цены, квесты и отметки у режимов свои.</span>
        </li>
        <li className={signedIn ? 'done' : ''}>
          {a.status === 'off' || a.status === 'app' ? (
            <><b>Отметки хранятся на этом устройстве.</b><span className="muted"> Вход через Discord и общий прогресс с командой — на сайте.</span></>
          ) : signedIn ? (
            <><b>Вы вошли как {a.name}.</b><span className="muted"> Отметки сохраняются в аккаунте, друзья из команды видят ваш прогресс в квестах.</span></>
          ) : a.status === 'denied' ? (
            <><b>Вы вошли, но этого аккаунта нет в списке игроков.</b><span className="muted"> Попросите того, кто ведёт сайт, добавить вас. Пока отметки хранятся только на этом устройстве.</span></>
          ) : a.status === 'loading' ? (
            <><b>Проверяем вход…</b><span className="muted"> Вход через Discord сохраняет отметки в аккаунте и показывает ваш прогресс друзьям по команде.</span></>
          ) : a.status === 'error' && a.userId ? (
            <><b>Не удалось проверить доступ.</b><span className="muted"> Проверьте интернет и обновите страницу. Пока отметки хранятся только на этом устройстве.</span></>
          ) : (
            <>
              <b>Войдите через Discord</b> — отметки сохранятся в аккаунте, а друзья по команде увидят, какие квесты у вас уже сделаны.
              <span className="muted"> Без входа всё работает, но отметки остаются только на этом устройстве.</span>
              {canSignIn && <><br /><button className="btn small" onClick={login}>Войти через Discord</button></>}
            </>
          )}
        </li>
        <li>
          <b>Отметьте, что уже сделано,</b> в <a className="link nav-inline" href="#/quests">Квестах</a>: уровень и выполненные задания.
          <span className="muted"> Тогда сайт поймёт, какие задания открыты у вас сейчас.</span>
        </li>
        <li>
          <b>Перед рейдом откройте <a className="link nav-inline" href="#/overview">Обзор</a>:</b> на какую карту идти и какие ключи и маркеры взять.
          <span className="muted"> Выходы и точки заданий — на <a className="link nav-inline" href="#/maps">Картах</a>.</span>
        </li>
      </ol>
    </div>
  );
}
