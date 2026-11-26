// Пустой результат поиска или фильтра: что случилось и что сделать дальше.
export default function RefEmpty({ text, hint, onReset }: { text: string; hint?: string; onReset?: () => void }) {
  return (
    <div className="ref-empty">
      <b>{text}</b>
      {hint && <div className="muted small">{hint}</div>}
      {onReset && <button className="btn ghost small" onClick={onReset}>Сбросить поиск и фильтры</button>}
    </div>
  );
}
