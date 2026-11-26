// Заглушки браузерных объектов для тестов в окружении node.
// localStorage — простое хранилище в памяти, очищается перед каждым тестом.
import { beforeEach } from 'vitest';

class MemoryStorage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

const g = globalThis as any;
// defineProperty, а не присваивание: в новых Node свой localStorage-геттер
Object.defineProperty(g, 'localStorage', { value: new MemoryStorage(), configurable: true, writable: true });
// position.ts читает window.tarkovHub при загрузке модуля
g.window ??= g;

beforeEach(() => { g.localStorage.clear(); });
