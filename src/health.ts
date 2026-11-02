// Общие данные для визуализации здоровья по частям тела.

export type PartId = 'Head' | 'Chest' | 'Stomach' | 'LeftArm' | 'RightArm' | 'LeftLeg' | 'RightLeg';
export type Health = { id: string; max: number }[];

export const PARTS: PartId[] = ['Head', 'Chest', 'Stomach', 'LeftArm', 'RightArm', 'LeftLeg', 'RightLeg'];

export const PART_RU: Record<PartId, string> = {
  Head: 'Голова', Chest: 'Грудь', Stomach: 'Живот', LeftArm: 'Л. рука', RightArm: 'П. рука', LeftLeg: 'Л. нога', RightLeg: 'П. нога',
};

// Здоровье обычного ЧВК — база для сравнения
export const PMC: Record<PartId, number> = { Head: 35, Chest: 85, Stomach: 70, LeftArm: 60, RightArm: 60, LeftLeg: 65, RightLeg: 65 };
export const PMC_TOTAL = Object.values(PMC).reduce((a, b) => a + b, 0);

export const hpOf = (h: Health, id: PartId) => h.find((x) => x.id === id)?.max ?? 0;
export const total = (h: Health) => h.reduce((s, x) => s + (x.max || 0), 0);

/** Во сколько раз часть тела крепче, чем у обычного ЧВК */
export const ratio = (h: Health, id: PartId) => hpOf(h, id) / PMC[id];

// Шкала: как у ЧВК — зелёный, ×2 — жёлтый, ×3 — оранжевый, ×4 и больше — красный
const STOPS: [number, [number, number, number]][] = [
  [1, [95, 191, 106]], [2, [217, 184, 74]], [3, [224, 132, 58]], [4, [217, 72, 59]],
];
export function colorFor(r: number): string {
  const [rr, gg, bb] = rgbFor(r);
  return `rgb(${rr}, ${gg}, ${bb})`;
}
export function rgbFor(r: number): [number, number, number] {
  if (r <= STOPS[0][0]) return STOPS[0][1];
  for (let i = 1; i < STOPS.length; i++) {
    const [x1, c1] = STOPS[i];
    const [x0, c0] = STOPS[i - 1];
    if (r <= x1) {
      const t = (r - x0) / (x1 - x0);
      return [0, 1, 2].map((k) => Math.round(c0[k] + (c1[k] - c0[k]) * t)) as [number, number, number];
    }
  }
  return STOPS[STOPS.length - 1][1];
}
