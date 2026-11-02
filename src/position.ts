// Позиция игрока из имени скриншота Escape from Tarkov.
// Игра пишет координаты в имя файла, например:
// 2025-01-08[20-17]_-198.75, 2.53, -73.97_0.00000, -0.83160, 0.00000, 0.55541_14.08 (0).png
//                    x       y      z     кватернион поворота (x, y, z, w)

export type Pos = { x: number; y: number; z: number; yaw: number | null; time: number; file?: string };

const RE = /_(-?\d+(?:\.\d+)?), (-?\d+(?:\.\d+)?), (-?\d+(?:\.\d+)?)_(-?\d+(?:\.\d+)?), (-?\d+(?:\.\d+)?), (-?\d+(?:\.\d+)?), (-?\d+(?:\.\d+)?)_/;
const RE_POS_ONLY = /(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/;

export function parseScreenshotName(name: string): Pos | null {
  const base = name.split(/[\\/]/).pop() || name;
  const m = base.match(RE);
  if (m) {
    const [x, y, z, qx, qy, qz, qw] = m.slice(1).map(Number);
    // Поворот вокруг вертикальной оси Y (Unity)
    const yaw = Math.atan2(2 * (qw * qy + qx * qz), 1 - 2 * (qx * qx + qy * qy));
    return { x, y, z, yaw, time: Date.now(), file: base };
  }
  const p = base.match(RE_POS_ONLY); // ручной ввод «x, y, z»
  if (p) {
    const [x, y, z] = p.slice(1).map(Number);
    return { x, y, z, yaw: null, time: Date.now() };
  }
  return null;
}

// Мост к десктопному приложению (Electron, см. electron/preload.cjs)
export type DesktopBridge = {
  isDesktop: true;
  getScreenshotsDir: () => Promise<string>;
  chooseScreenshotsDir: () => Promise<string | null>;
  onPosition: (cb: (p: Pos) => void) => () => void;
  onMapDetected?: (cb: (map: string) => void) => () => void;
  openExternal?: (url: string) => void;
};

export const desktop: DesktopBridge | undefined = (window as any).tarkovHub;
