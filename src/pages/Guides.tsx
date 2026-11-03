import { useEffect, useMemo, useState } from 'react';
import { GUIDES } from '../guides';
import { Search, norm, safeUrl } from '../ui';

// Актуальное (ивент, сезон) — наверху списка
const TOP = ['Ивент', 'Сезон'];
const rank = (t: string) => (TOP.includes(t) ? TOP.indexOf(t) : TOP.length);

export default function Guides() {
  const fromHash = () => location.hash.split('/')[2] || '';
  const [id, setId] = useState(fromHash);
  const [tag, setTag] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => { const f = () => setId(fromHash()); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  useEffect(() => { if (id) window.scrollTo(0, 0); }, [id]);
  const g = GUIDES.find((x) => x.id === id);
  const tags = useMemo(() => Array.from(new Set(GUIDES.map((x) => x.tag))), []);
  const list = useMemo(() => {
    const nq = norm(q);
    return GUIDES.filter((x) => (!tag || x.tag === tag) &&
      (!nq || norm(x.title + ' ' + x.summary + ' ' + JSON.stringify(x.blocks)).includes(nq)))
      .sort((a, b) => rank(a.tag) - rank(b.tag));
  }, [tag, q]);

  if (g) return (
    <article className="guide">
      <a href="#/guides" className="link small">← Все гайды</a>
      <div className="guide-meta"><span className="badge">{g.tag}</span>{g.updated && <span className="muted small">Обновлено: {g.updated}</span>}</div>
      <h1>{g.title}</h1>
      {g.blocks.map((b, i) =>
        b.h ? <h3 key={i}>{b.h}</h3> :
        b.p ? <p key={i}>{b.p}</p> :
        b.list ? <ul key={i}>{b.list.map((l, j) => <li key={j}>{l}</li>)}</ul> :
        b.tip ? <div key={i} className="tip">💡 {b.tip}</div> :
        b.warn ? <div key={i} className="tip warn">⚠️ {b.warn}</div> :
        b.links ? (
          <ul key={i} className="guide-links">
            {b.links.map(([t, u], j) => safeUrl(u) ? <li key={j}><a className="link" href={safeUrl(u)} target="_blank" rel="noreferrer">{t} ↗</a></li> : null)}
          </ul>
        ) : null)}
    </article>
  );

  return (
    <section>
      <h1>Гайды</h1>
      <p className="lead">Разборы механик, карт, ивентов и сезона — для новичков и тех, кто вернулся. Всего гайдов: {GUIDES.length}.</p>
      <div className="toolbar"><Search value={q} onChange={setQ} placeholder="Ледокол, убежище, Каппа…" /></div>
      <div className="chips">
        <button className={!tag ? 'chip on' : 'chip'} onClick={() => setTag('')}>Все</button>
        {tags.map((t) => <button key={t} className={tag === t ? 'chip on' : 'chip'} onClick={() => setTag(t)}>{t}</button>)}
      </div>
      {list.length === 0 && <div className="muted">Ничего не найдено.</div>}
      <div className="cards">
        {list.map((x) => (
          <a key={x.id} href={`#/guides/${x.id}`} className="card guide-card">
            <span className="badge">{x.tag}</span>
            <div className="title">{x.title}</div>
            <div className="muted small">{x.summary}</div>
          </a>
        ))}
      </div>
    </section>
  );
}
