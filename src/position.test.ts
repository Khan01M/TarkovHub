import { describe, expect, it } from 'vitest';
import { parseScreenshotName } from './position';

// Угол поворота вокруг вертикали для кватерниона, повёрнутого только вокруг Y: 2·atan2(qy, qw), в пределах (−π, π]
const yawY = (qy: number, qw: number) => {
  let a = 2 * Math.atan2(qy, qw);
  if (a > Math.PI) a -= 2 * Math.PI;
  if (a <= -Math.PI) a += 2 * Math.PI;
  return a;
};

describe('parseScreenshotName — координаты из имени скриншота', () => {
  it('стандартное имя скриншота игры', () => {
    const name = '2025-01-08[20-17]_-198.75, 2.53, -73.97_0.00000, -0.83160, 0.00000, 0.55541_14.08 (0).png';
    const p = parseScreenshotName(name)!;
    expect(p).toMatchObject({ x: -198.75, y: 2.53, z: -73.97, file: name });
    expect(p.yaw).toBeCloseTo(yawY(-0.8316, 0.55541), 3);
    expect(typeof p.time).toBe('number');
  });

  it('полный путь (Windows и /) — в file только имя файла', () => {
    const base = '2024-12-31[23-59]_312.5, -1.02, 140.0_0.00000, 0.70711, 0.00000, 0.70711_9.87.png';
    for (const path of [`C:\\Users\\player\\Documents\\Escape from Tarkov\\Screenshots\\${base}`, `/home/p/Screenshots/${base}`]) {
      const p = parseScreenshotName(path)!;
      expect(p).toMatchObject({ x: 312.5, y: -1.02, z: 140, file: base });
      expect(p.yaw).toBeCloseTo(Math.PI / 2, 3);
    }
  });

  it('целые координаты и кватернион без дробной части', () => {
    const p = parseScreenshotName('2025-02-01[10-00]_100, 0, -50_0, 0, 0, 1_0.00.png')!;
    expect(p).toMatchObject({ x: 100, y: 0, z: -50 });
    expect(p.yaw).toBeCloseTo(0, 6);
  });

  it('взгляд назад: поворот на 180°', () => {
    const p = parseScreenshotName('2025-02-01[10-00]_1.0, 2.0, 3.0_0.00000, 1.00000, 0.00000, 0.00000_1.00.png')!;
    expect(Math.abs(p.yaw!)).toBeCloseTo(Math.PI, 3);
  });

  it('ручной ввод «x, y, z» — без поворота и без имени файла', () => {
    expect(parseScreenshotName('-198.75, 2.53, -73.97')).toMatchObject({ x: -198.75, y: 2.53, z: -73.97, yaw: null });
    expect(parseScreenshotName('10,20,30')).toMatchObject({ x: 10, y: 20, z: 30, yaw: null });
    expect(parseScreenshotName('10,20,30')!.file).toBeUndefined();
  });

  it('имя без координат — null', () => {
    expect(parseScreenshotName('2025-01-08[20-17]_screenshot.png')).toBeNull();
    expect(parseScreenshotName('')).toBeNull();
    expect(parseScreenshotName('1, 2')).toBeNull();
  });
});
