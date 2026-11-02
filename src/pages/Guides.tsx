import { useEffect, useState } from 'react';
import { GUIDES } from '../guides';

export default function Guides() {
  const fromHash = () => location.hash.split('/')[2] || '';
  const [id, setId] = useState(fromHash);
  useEffect(() => { const f = () => setId(fromHash()); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  const g = GUIDES.find((x) => x.id === id);

  if (g) return (
    <article className="guide">
      <a href="#/guides" className="link small">← Все гайды</a>
      <span className="badge">{g.tag}</span>
      <h1>{g.title}</h1>
      {g.blocks.map((b, i) =>
        b.h ? <h3 key={i}>{b.h}</h3> :
        b.p ? <p key={i}>{b.p}</p> :
        b.list ? <ul key={i}>{b.list.map((l, j) => <li key={j}>{l}</li>)}</ul> :
        b.tip ? <div key={i} className="tip">💡 {b.tip}</div> : null)}
    </article>
  );

  return (
    <section>
      <h1>Гайды</h1>
      <p className="lead">Короткие разборы механик для новичков и тех, кто вернулся после вайпа.</p>
      <div className="cards">
        {GUIDES.map((x) => (
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
