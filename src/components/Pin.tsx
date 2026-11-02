// Булавка задания на карте и общие подписи типов целей.
export type QuestPin = { x: number; z: number; taskId: string; name: string; label: string; type: string; done: boolean };

export const TYPE_ICON: Record<string, string> = {
  visit: '◎', mark: '⚑', plantItem: '⬇', plantQuestItem: '⬇', findQuestItem: '✋', findItem: '✋', giveItem: '⇄', giveQuestItem: '⇄',
  shoot: '⌖', extract: '⇲', useItem: '✱',
};
const TYPE_RU: Record<string, string> = {
  visit: 'Посетить', mark: 'Отметить маркером', plantItem: 'Заложить предмет', plantQuestItem: 'Заложить предмет', findQuestItem: 'Найти квестовый предмет',
  findItem: 'Найти', giveItem: 'Сдать', giveQuestItem: 'Сдать', shoot: 'Устранить', extract: 'Выйти', useItem: 'Использовать',
};

/** Булавка-указатель: остриё ровно в точке задания. При выделенном квесте над ним подпись. */
export function PinMark({ q, x, y, u, selected, onSelect }: { q: QuestPin; x: number; y: number; u: number; selected?: string | null; onSelect?: (id: string | null) => void }) {
  const on = selected === q.taskId;
  const dim = !!selected && !on;
  const s = (on ? 1.35 : 1) * u;
  return (
    <g className={`pin ${on ? 'on' : ''} ${dim ? 'dim' : ''} ${q.done ? 'done' : ''}`} onClick={(e) => { e.stopPropagation(); onSelect?.(on ? null : q.taskId); }}>
      <title>{`${q.name}\n${TYPE_RU[q.type] || ''}: ${q.label}`}</title>
      <path d={`M ${x} ${y} C ${x - 2 * s} ${y - 6 * s}, ${x - 8 * s} ${y - 9 * s}, ${x - 8 * s} ${y - 16 * s} A ${8 * s} ${8 * s} 0 1 1 ${x + 8 * s} ${y - 16 * s} C ${x + 8 * s} ${y - 9 * s}, ${x + 2 * s} ${y - 6 * s}, ${x} ${y} Z`} style={{ strokeWidth: 1.5 * u }} />
      <text x={x} y={y - 13.2 * s} className="pin-ico" style={{ fontSize: 9 * s }}>{TYPE_ICON[q.type] || '!'}</text>
      {on && <text x={x} y={y - 29 * s} className="pin-label" style={{ fontSize: 11 * u, strokeWidth: 3 * u }}>{q.name}</text>}
    </g>
  );
}

