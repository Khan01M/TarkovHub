// Терминал — финал сюжета 1.0: как попасть, пропуска, убежище, главы и готовность команды.
// Логика и разбор данных — в ../terminal.ts. Отметки игрока — в общем прогрессе (ключи «t:…»).
import { useState } from 'react';
import { useData, State, Img, safeUrl } from '../ui';
import { getGameMode, rub } from '../api';
import { useProgress, useTeam } from '../progress';
import { signIn } from '../auth';
import { STORY_CHAPTERS } from '../guides';
import {
  loadTerminal, SHORELINE_MAP_ID, HIDEOUT_REQS, ROUTES, PASS_KEY, chapterKey, routeOf, routeChanges, chaptersDone,
  personalSteps, summarize, teamReadiness, stationOrFallback, builtLevel, hoursText, chaptersBeforeText, groupIds, inGroup,
  type TerminalData, type PassRule, type RouteId, type Member,
} from '../terminal';

const SOURCES: [string, string][] = [
  ['Timesaver: карта Терминал — как попасть', 'https://timesaver.gg/blog/tarkov-terminal-map-escape-guide'],
  ['Timesaver: глава The Ticket', 'https://timesaver.gg/blog/tarkov-the-ticket-quest-guide'],
  ['SenseOS: как открыть карты', 'https://senseos.gg/guides/escape-from-tarkov/how-to-unlock-maps/'],
  ['Aquapado: The Ticket', 'https://tarkov.aquapado.com/guide/en/story/the-ticket/'],
];

/** Пометка «не подтверждено данными игры» */
function Unverified({ text = 'по гайдам, проверьте в игре' }: { text?: string }) {
  return <span className="badge warn tm-unv" title="Сведения из сторонних гайдов, данными игры не подтверждены">⚠ {text}</span>;
}

function usePassRule() {
  const [v, setV] = useState<PassRule>(() => { try { return localStorage.getItem('terminalPassRule') === 'one' ? 'one' : 'each'; } catch { return 'each'; } });
  const set = (x: PassRule) => { setV(x); try { localStorage.setItem('terminalPassRule', x); } catch { /* ignore */ } };
  return [v, set] as const;
}

const ROUTE_TEXT: Record<RouteId, string> = {
  savior: 'Согласиться на предложение Кермана и искать улики TerraGroup. Нужны Разведцентр 3, 8 из 9 главных улик, репутация у Скупщика выше 4.0, солнечная батарея 1 и флешка Кермана. На вход — защищённый контейнер «Альфа-1» с уликами.',
  debtor: 'Согласиться на предложение Кермана, сдать 2 главные улики и отказаться искать дальше.',
  fallen: 'Согласиться на предложение Кермана, отказаться искать улики, выполнить задания Прапора; нужна солнечная батарея 1.',
  survivor: 'Отказаться от предложения Кермана и заплатить Прапору крупную сумму (по гайдам — сотни миллионов рублей).',
};

export default function Terminal() {
  const mode = getGameMode();
  const { data, error, loading } = useData(loadTerminal);
  const progress = useProgress(mode);
  const { done, toggle, setMarks, auth } = progress;
  const [spoilers, setSpoilers] = useState(false);
  const [rule, setRule] = usePassRule();
  const team = useTeam(mode, progress.source === 'account', auth.userId, auth.name, auth.avatar, done);

  const steps = personalSteps(done, data?.stations);
  const sum = summarize(steps);
  const route = routeOf(done);
  const busy = progress.loading;

  return (
    <section className="terminal">
      <h1>Терминал</h1>
      <p className="lead">Финальная карта сюжета версии 1.0. Здесь — как туда попасть, где взять пропуск, что построить в убежище и готова ли вся команда.</p>

      <div className="card tm-summary">
        <div className="progress">
          <div className="bar"><i style={{ width: `${sum.total ? (sum.done / sum.total) * 100 : 0}%` }} /></div>
          <span className="small">До Терминала: {sum.done} из {sum.total}</span>
        </div>
        <div className="small">{sum.next ? <>Дальше: <b>{sum.next.label}</b></> : <b>Всё готово — можно идти на Терминал.</b>}</div>
        <div className="small muted">
          {progress.source === 'account' ? <>Отметки сохраняются в аккаунте <b>{auth.name}</b>.</> : <>Отметки сохраняются на этом устройстве.</>}
        </div>
      </div>
      {progress.saveError && <div className="alert">Не удалось сохранить: {progress.saveError} <button className="btn small" onClick={progress.retry}>Повторить</button></div>}
      {progress.loadError && <div className="alert">Не удалось загрузить прогресс: {progress.loadError} <button className="btn small" onClick={progress.reload}>Повторить</button></div>}

      <h2>Как попасть</h2>
      <div className="card">
        <p>На Терминал ведёт только <b>переход с Берега</b>{data?.transits[0] ? <> — точка «{data.transits[0].label}»</> : null}. Другого пути в данных игры нет. Для входа нужен пропуск{data?.passes.length ? ' (список ниже)' : ''}.</p>
        <p className="small">
          <a className="link" href="#/maps" onClick={() => { try { localStorage.setItem('mapById', data?.transits[0]?.mapId || SHORELINE_MAP_ID); } catch { /* ignore */ } }}>Открыть Берег на карте →</a>
          <span className="muted"> переход отмечен ромбом.</span>
        </p>
        <ul className="small">
          <li>Переход — через интерком у гарнизона порта. <Unverified /></li>
          <li>Вход по времени рейда примерно с 21:00 до 06:00. <Unverified /></li>
          <li>Когда тратится пропуск — неизвестно: по одной версии при входе, по другой — при смерти. <Unverified text="не подтверждено" /></li>
        </ul>
      </div>

      <h2>Пропуска</h2>
      <label className="card tm-have">
        <input type="checkbox" checked={!!done[PASS_KEY]} disabled={busy} onChange={() => toggle(PASS_KEY)} />
        <span><b>У меня есть пропуск на Терминал</b><span className="muted small"> — любой, который игра принимает на вход</span></span>
      </label>
      <State loading={loading} error={error} />
      {data && data.passes.length > 0 && <Passes data={data} />}
      {(data ? data.passes.length === 0 : !!error) && <div className="card small muted">В данных tarkov.dev для этого режима пропусков нет.</div>}

      <h2>Убежище</h2>
      <div className="card">
        <div className="tm-hideout">
          {HIDEOUT_REQS.map((r) => {
            const s = stationOrFallback(data?.stations, r.station);
            const ok = builtLevel(s, done) >= r.level;
            const mine = !r.routes || (route && r.routes.includes(route));
            return (
              <div key={r.key} className={`tm-hreq ${mine ? '' : 'other'}`}>
                <span className={`tag ${ok ? 'ok' : 'no'}`}>{ok ? '✓' : '✗'} {s.name} {r.level}</span>
                <span className="small muted">{spoilers ? r.whySpoiler : r.why}</span>
                {r.unverified && <Unverified text="по гайдам" />}
              </div>
            );
          })}
        </div>
        <div className="small muted">Уровни берутся из отметок на странице <a className="link" href="#/hideout">«Убежище»</a>. Генератор держите включённым: сюжетные крафты долгие.</div>
      </div>

      <h2>Путь</h2>
      <div className="card">
        <div className="small muted">Главы сюжета по порядку. До Терминала нужно пройти {chaptersBeforeText()}; следующая глава, The Ticket, и ведёт на Терминал. Остальные идут параллельно. Отмечайте пройденные.</div>
        <div className="tm-chapters">
          {STORY_CHAPTERS.map((c, i) => (
            <label key={c.slug} className={done[chapterKey(c.slug)] ? 'done' : ''}>
              <input type="checkbox" checked={!!done[chapterKey(c.slug)]} disabled={busy} onChange={() => toggle(chapterKey(c.slug))} />
              <span>{i + 1}. {c.name}{c.note ? <span className="muted small"> — {c.note}</span> : null}</span>
            </label>
          ))}
        </div>
        <div className="small">Пройдено глав: {chaptersDone(done)} из {STORY_CHAPTERS.length}</div>

        <h3>Мой путь</h3>
        <div className="small muted">Концовок четыре, путь выбирается решениями в главе The Ticket. Отметьте, к какой идёте — так команда увидит, кто определился.</div>
        {spoilers ? (
          <div className="chips">
            {ROUTES.map((r) => (
              <button key={r.id} className={route === r.id ? 'chip on' : 'chip'} disabled={busy} onClick={() => setMarks(routeChanges(done, r.id))}>{r.name}</button>
            ))}
          </div>
        ) : (
          <div className="small">{route ? <b>Путь выбран.</b> : <>Путь не выбран — откройте спойлеры, чтобы выбрать.</>}</div>
        )}

        <button className="btn ghost small" onClick={() => setSpoilers(!spoilers)} aria-expanded={spoilers}>{spoilers ? 'Скрыть спойлеры' : 'Показать спойлеры'}</button>
        {spoilers && (
          <div className="tm-spoiler">
            <div className="tip warn">Всё ниже — по сторонним гайдам, данными игры не подтверждено. Версии патча в источниках разные (от 1.2.5 до 1.3.6) — проверяйте в игре.</div>
            <p>Глава The Ticket начинается после Falling Skies, нужен Разведцентр 1. Главное решение — предложение Кермана: отказ ведёт только к «Выжившему», согласие — к «Спасителю», «Должнику» или «Павшему».</p>
            <h4>Концовки</h4>
            <ul>{ROUTES.map((r) => <li key={r.id}><b>{r.name}.</b> {ROUTE_TEXT[r.id]}</li>)}</ul>
            <h4>Точки невозврата</h4>
            <ul>
              <li>Отказ Керману.</li>
              <li>Отказ искать улики.</li>
              <li>Сдача улик.</li>
              <li>На пути «Спасителя» нельзя выполнять квест «Choose Your Friends Wisely» (по одному источнику).</li>
            </ul>
            <h4>Долгие крафты</h4>
            <ul>
              <li>Экспериментальный глушитель сигнала — верстак 1, 25 ч, нужно электричество.</li>
              <li>Активированная RFID-карта с данными Круглова — Разведцентр 1, 23,5 ч.</li>
              <li>Генератор держите включённым.</li>
            </ul>
            <h4>Частые ошибки</h4>
            <ul>
              <li>Лагерь людей Прапора на Маяке после 1.1.5 переехал на южный холм.</li>
              <li>Записку людей Прапора нужно прочитать в справочнике.</li>
              <li>Инструкцию к RFID-карте обязательно прочитайте.</li>
            </ul>
            <h4>Перед рейдом</h4>
            <ul>
              <li>На пути «Спасителя» улики нужно нести в защищённом контейнере «Альфа-1».</li>
            </ul>
          </div>
        )}
      </div>

      <h2>Готовность команды</h2>
      <TeamBlock progress={progress} team={team} rule={rule} setRule={setRule} spoilers={spoilers} />

      <h2>Перед рейдом</h2>
      <div className="card">
        <ul className="small">
          <li>Совет: возьмите пропуск каждому — неизвестно, хватит ли одного на группу.</li>
          <li>Заходите на Берег и идите к переходу на Терминал (точка перехода — из данных игры). Вход примерно с 21:00 до 06:00 по времени рейда. <Unverified text="по гайдам" /></li>
          <li>Совет: договоритесь с командой, где встретиться на Береге перед переходом.</li>
          <li>Пропуск, по одной из версий, теряется при смерти — снаряжение берите с расчётом на это. <Unverified text="по гайдам" /></li>
          <li>Если вы на одном из путей концовки — проверьте, что нужно взять с собой (в спойлерах выше).</li>
        </ul>
      </div>

      <h3>Источники</h3>
      <ul className="guide-links">
        {SOURCES.map(([t, u]) => <li key={u}><a className="link" href={u} target="_blank" rel="noreferrer">{t} ↗</a></li>)}
      </ul>
      <p className="small muted">Данные о пропусках, рецептах и переходе — из tarkov.dev. Остальное — из сторонних гайдов; версии патча в них разные (от 1.2.5 до 1.3.6).</p>
    </section>
  );
}

// ---------- пропуска ----------
function Passes({ data }: { data: TerminalData }) {
  return (
    <>
      <div className="small muted">Подходит любой из предметов, которые игра принимает на вход (список из данных карты).</div>
      <div className="tm-passes">
        {data.passes.map((id) => {
          const it = data.items[id];
          const recipes = data.crafts.filter((c) => c.product === id);
          const isLetter = id === '68f213f8ea61d1803707cf7a';
          return (
            <div key={id} className="card tm-pass">
              <div className="row-main">
                <Img src={it.icon} alt="" size={48} />
                <div className="grow">
                  <div className="title">{it.name}</div>
                  {safeUrl(it.wiki) && <a className="link small" href={safeUrl(it.wiki)} target="_blank" rel="noreferrer">Wiki ↗</a>}
                </div>
              </div>
              {it.buy.length > 0 && (
                <div className="small">{it.buy.map((b, i) => <div key={i} className="kv"><span>Купить: {b.vendor}</span><b>{rub(b.price)}</b></div>)}</div>
              )}
              {isLetter && <div className="small muted">Лимит — 2 шт. за сброс торговца. <Unverified text="по гайдам" /></div>}
              {recipes.map((c) => (
                <div key={c.id} className="tm-craft">
                  <div className="small"><b>Крафт:</b> {c.stationName} {c.level}, {hoursText(c.duration)}</div>
                  <div className="hd-items">
                    {c.items.map((r) => {
                      const x = data.items[r.id];
                      return (
                        <div key={r.id} className="hd-item" title={x?.name}>
                          <Img src={x?.icon} alt="" size={32} />
                          <span className="grow">{x?.name || r.id}</span>
                          {r.tool ? <span className="badge" title="Не тратится при крафте">не тратится</span> : <b>×{r.count}</b>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
              {!recipes.length && !it.buy.length && <div className="small muted">Крафта и покупки в данных нет — выдаётся по сюжету.</div>}
            </div>
          );
        })}
      </div>
    </>
  );
}

// ---------- команда ----------
/** Кто в группе: id игроков в localStorage; null — выбор ещё не делали (тогда «я и все с отметками t:») */
function useGroup() {
  const key = 'terminalGroup';
  const [v, setV] = useState<string[] | null>(() => {
    try { const x = JSON.parse(localStorage.getItem(key) || 'null'); return Array.isArray(x) ? x.filter((s) => typeof s === 'string') : null; } catch { return null; }
  });
  const set = (ids: string[]) => { setV(ids); try { localStorage.setItem(key, JSON.stringify(ids)); } catch { /* ignore */ } };
  return [v, set] as const;
}

function TeamBlock({ progress, team, rule, setRule, spoilers }: {
  progress: ReturnType<typeof useProgress>; team: ReturnType<typeof useTeam>; rule: PassRule; setRule: (r: PassRule) => void; spoilers: boolean;
}) {
  const auth = progress.auth;
  const [group, setGroup] = useGroup();
  if (progress.source !== 'account') {
    return (
      <div className="card small muted">
        {auth.status === 'signedOut' || auth.status === 'error'
          ? <><button className="linkbtn" onClick={signIn}>Войдите через Discord</button>, чтобы видеть готовность друзей: каждый отмечает свои шаги у себя.</>
          : auth.status === 'denied' ? <>У аккаунта <b>{auth.name}</b> нет доступа: вход только для игроков из списка.</>
          : auth.status === 'app' ? <>Готовность команды видна после входа на сайте khan01m.github.io/TarkovHub.</>
          : <>Готовность команды видна после входа в аккаунт.</>}
      </div>
    );
  }
  if (team.missingTable) return <div className="card small muted">Список команды в базе ещё не настроен.</div>;
  const all: Member[] = team.team.map((t) => ({ userId: t.userId, name: t.name, me: t.me, done: t.done }));
  const ids = groupIds(all, group);
  const st = teamReadiness(inGroup(all, ids), rule);
  const byId = new Map(st.members.map((m) => [m.userId || m.name, m]));
  const routeName = (r: RouteId | null) => (r ? (spoilers ? ROUTES.find((x) => x.id === r)?.name : 'выбран') : '—');
  const flip = (id: string) => { const n = new Set(ids); if (n.has(id)) n.delete(id); else n.add(id); setGroup([...n]); };
  const ruleText = rule === 'each' ? 'пропуск нужен каждому' : 'хватит одного пропуска на группу';
  return (
    <div className="card">
      <div className="small">Пропуск нужен: <Unverified text="не проверено" /></div>
      <div className="chips">
        <button className={rule === 'each' ? 'chip on' : 'chip'} onClick={() => setRule('each')}>каждому</button>
        <button className={rule === 'one' ? 'chip on' : 'chip'} onClick={() => setRule('one')}>одного на группу</button>
      </div>
      {all.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>В группе</th><th>Игрок</th><th>Главы</th><th>Пропуск</th><th>Путь</th><th>Не хватает</th></tr></thead>
            <tbody>
              {all.map((t) => {
                const id = t.userId || t.name;
                const m = byId.get(id);
                const done = t.done as Set<string>;
                return (
                  <tr key={id} className={m ? '' : 'tm-out'}>
                    <td><input type="checkbox" checked={!!m} disabled={t.me} onChange={() => flip(id)} aria-label={`${t.name} в группе`} /></td>
                    <td>{t.me ? 'Я' : t.name}</td>
                    <td>{chaptersDone(done)}/{STORY_CHAPTERS.length}</td>
                    <td>{done.has(PASS_KEY) ? '✓' : '✗'}</td>
                    <td>{routeName(routeOf(done))}</td>
                    <td className={!m ? 'muted' : m.missing.length ? 'down' : 'up'}>{!m ? 'не в группе' : m.missing.length ? m.missing.join(', ') : 'готов'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className={`tm-verdict ${st.ready ? 'ok' : ''}`}>
        {team.loading && !all.length ? <><span className="spinner" /> Загружаю…</>
          : team.error ? <span className="down">Не удалось загрузить команду: {team.error}</span>
          : !all.length ? 'В команде пока никого нет.'
          : st.ready ? `Команда готова (считали так: ${ruleText})`
          : <>Ждём: {st.waiting.join('; ')} <span className="muted small">(считали так: {ruleText})</span></>}
      </div>
      <div className="small muted">
        Готовность — только по отмеченным «в группе» (выбор хранится на этом устройстве). Каждому нужны главы {chaptersBeforeText()} и выбранный путь; пропуск — по правилу выше, сейчас он есть у {st.passHolders}.
        {' '}<button className="linkbtn small" onClick={team.reload} disabled={team.loading}>{team.loading ? 'Загружаю…' : 'Обновить'}</button>
      </div>
    </div>
  );
}
