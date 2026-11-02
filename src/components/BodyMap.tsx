import { PART_RU, PartId, Health, hpOf, ratio, colorFor, PMC } from '../health';

// Плоская схема тела для карточки босса: цвет части — во сколько раз она крепче, чем у ЧВК.
const SHAPES: Record<PartId, JSX.Element> = {
  Head: <circle cx="40" cy="14" r="10" />,
  Chest: <rect x="26" y="27" width="28" height="22" rx="5" />,
  Stomach: <rect x="28" y="51" width="24" height="16" rx="4" />,
  // Фигура смотрит на нас: её левая сторона — справа
  LeftArm: <rect x="56" y="28" width="10" height="38" rx="5" />,
  RightArm: <rect x="14" y="28" width="10" height="38" rx="5" />,
  LeftLeg: <rect x="41" y="69" width="11" height="44" rx="5" />,
  RightLeg: <rect x="28" y="69" width="11" height="44" rx="5" />,
};

export default function BodyMap({ health }: { health: Health }) {
  return (
    <div className="bodymap">
      <svg viewBox="0 0 80 116" width="64" height="93" role="img" aria-label="Здоровье по частям тела">
        {(Object.keys(SHAPES) as PartId[]).map((id) => (
          <g key={id} fill={colorFor(ratio(health, id))}>
            <title>{`${PART_RU[id]}: ${hpOf(health, id)} (у ЧВК ${PMC[id]})`}</title>
            {SHAPES[id]}
          </g>
        ))}
      </svg>
      <div className="bodymap-list">
        {(Object.keys(SHAPES) as PartId[]).map((id) => (
          <div key={id} className="kv small">
            <span><i className="dot" style={{ background: colorFor(ratio(health, id)) }} />{PART_RU[id]}</span>
            <b>{hpOf(health, id)}</b>
          </div>
        ))}
      </div>
    </div>
  );
}
