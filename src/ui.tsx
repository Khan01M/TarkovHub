import { useEffect, useState } from 'react';

export function useData<T = any>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    loader()
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(String(e?.message || e)))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error, loading };
}

export function State({ loading, error }: { loading: boolean; error: string | null }) {
  if (loading) return <div className="state"><span className="spinner" /> Загружаю данные…</div>;
  if (error) return (
    <div className="state error">
      Не удалось получить данные: {error}
      <div className="muted">Проверьте интернет. Данные берутся с открытого API tarkov.dev (json.tarkov.dev).</div>
    </div>
  );
  return null;
}

export function Search({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input className="search" type="search" value={value} placeholder={placeholder || 'Поиск…'}
      onChange={(e) => onChange(e.target.value)} />
  );
}

export const norm = (s: string) => (s || '').toLowerCase().replace(/ё/g, 'е');

export function Img({ src, alt, size = 48 }: { src?: string; alt: string; size?: number }) {
  if (!src) return <div className="img-ph" style={{ width: size, height: size }} />;
  return <img className="thumb" src={src} alt={alt} width={size} height={size} loading="lazy" />;
}

// Пропускаем только http(s)-ссылки: данные приходят из внешнего API,
// и ссылка вида javascript: или file: не должна попасть в href.
export function safeUrl(u?: string | null): string | undefined {
  if (!u) return undefined;
  try {
    const url = new URL(u);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
  } catch { return undefined; }
}
