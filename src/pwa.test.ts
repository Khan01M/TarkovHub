import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { canRegisterSW } from './pwa';

// public/sw.js — обычный скрипт без модулей; берём из него чистые функции через new Function.
// Обработчики событий внутри не запускаются: они под проверкой ServiceWorkerGlobalScope.
const src = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
const sw = new Function(`${src}\nreturn { swRoute, shellAssets, VERSION };`)() as {
  swRoute: (url: string, method: string, scope: string, mode?: string) => string | null;
  shellAssets: (html: string) => string[];
  VERSION: string;
};

const SCOPE = 'https://khan01m.github.io/TarkovHub/';
const route = (url: string, method = 'GET', mode = 'cors') => sw.swRoute(url, method, SCOPE, mode);

describe('sw.js: выбор стратегии', () => {
  it('страница сайта — shell', () => {
    expect(route(SCOPE, 'GET', 'navigate')).toBe('shell');
    expect(route(SCOPE + '?r=1', 'GET', 'navigate')).toBe('shell');
    expect(route(SCOPE + 'index.html')).toBe('shell');
  });
  it('файлы сборки с хэшем — asset (сначала кэш)', () => {
    expect(route(SCOPE + 'assets/index-AbC123.js')).toBe('asset');
    expect(route(SCOPE + 'assets/index-AbC123.css')).toBe('asset');
  });
  it('иконки и манифест без хэша — static (копия сразу, обновление в фоне)', () => {
    expect(route(SCOPE + 'icon.svg')).toBe('static');
    expect(route(SCOPE + 'icons/icon-192.png')).toBe('static');
    expect(route(SCOPE + 'manifest.webmanifest')).toBe('static');
  });
  it('данные tarkov.dev, карты и промокоды — data', () => {
    expect(route('https://json.tarkov.dev/regular/items')).toBe('data');
    expect(route('https://json.tarkov.dev/pve/tasks_ru')).toBe('data');
    expect(route('https://assets.tarkov.dev/maps/svg/Customs.svg')).toBe('data');
    expect(route(SCOPE + 'promocodes.json')).toBe('data');
  });
  it('promocodes.json — только свой, в папке сайта', () => {
    expect(route('https://khan01m.github.io/OtherSite/promocodes.json')).toBeNull();
    expect(route('https://example.org/TarkovHub/promocodes.json')).toBeNull();
    expect(route(SCOPE + 'sub/promocodes.json')).toBeNull();
  });
  it('Supabase никогда не кэшируется', () => {
    expect(route('https://erzkitfpautpvetrqwnj.supabase.co/rest/v1/progress?select=*')).toBeNull();
    expect(route('https://erzkitfpautpvetrqwnj.supabase.co/auth/v1/user')).toBeNull();
    expect(route('https://supabase.co/')).toBeNull();
  });
  it('не-GET не трогаем, даже для своих адресов и данных', () => {
    expect(route(SCOPE, 'POST', 'navigate')).toBeNull();
    expect(route('https://json.tarkov.dev/regular/items', 'POST')).toBeNull();
    expect(route(SCOPE + 'assets/index-AbC123.js', 'HEAD')).toBeNull();
  });
  it('картинки предметов, Discord и чужие сайты — мимо', () => {
    expect(route('https://assets.tarkov.dev/5447a9cd4bdc2dbd208b4567-icon.webp')).toBeNull();
    expect(route('https://cdn.discordapp.com/avatars/1/2.png')).toBeNull();
    expect(route('https://khan01m.github.io/OtherSite/assets/x.js')).toBeNull();
    expect(route('https://example.org/TarkovHub/assets/x.js')).toBeNull();
    expect(route('chrome-extension://abc/x.js')).toBeNull();
    expect(route('not a url')).toBeNull();
  });
  it('работает и в корне домена', () => {
    const root = 'https://th.example/';
    expect(sw.swRoute(root, 'GET', root, 'navigate')).toBe('shell');
    expect(sw.swRoute(root + 'assets/a-1.js', 'GET', root)).toBe('asset');
    expect(sw.swRoute(root + 'promocodes.json', 'GET', root)).toBe('data');
    expect(sw.swRoute(root + 'sw.js', 'GET', root)).toBeNull();
  });
  it('страницы вне папки сайта не перехватываются', () => {
    expect(route('https://khan01m.github.io/', 'GET', 'navigate')).toBeNull();
    expect(route('https://khan01m.github.io/Other/', 'GET', 'navigate')).toBeNull();
  });
});

describe('sw.js: файлы оболочки из index.html', () => {
  it('находит скрипты и стили сборки', () => {
    const html = `<script type="module" crossorigin src="./assets/index-D1x.js"></script>
      <link rel="modulepreload" crossorigin href="./assets/vendor-9Zq.js">
      <link rel="stylesheet" crossorigin href="./assets/index-Bb2.css">
      <link rel="icon" href="./icon.svg" /><link rel="manifest" href="./manifest.webmanifest" />`;
    expect(sw.shellAssets(html)).toEqual(['./assets/index-D1x.js', './assets/vendor-9Zq.js', './assets/index-Bb2.css']);
  });
  it('версия кэша задана', () => {
    expect(sw.VERSION).toMatch(/^v\d+$/);
  });
});

describe('регистрация service worker', () => {
  const site = { prod: true, protocol: 'https:', host: 'khan01m.github.io', hasSW: true, capacitor: false, desktop: false };
  it('на сайте — да', () => {
    expect(canRegisterSW(site)).toBe(true);
    expect(canRegisterSW({ ...site, protocol: 'http:' })).toBe(true);
  });
  it('в EXE, APK, dev и без поддержки — нет', () => {
    expect(canRegisterSW({ ...site, protocol: 'file:' })).toBe(false);
    expect(canRegisterSW({ ...site, desktop: true })).toBe(false);
    expect(canRegisterSW({ ...site, capacitor: true })).toBe(false);
    expect(canRegisterSW({ ...site, prod: false })).toBe(false);
    expect(canRegisterSW({ ...site, hasSW: false })).toBe(false);
  });
  it('на localhost — нет (иначе воркер после vite preview перехватывал бы другие проекты)', () => {
    for (const host of ['localhost', 'app.localhost', '127.0.0.1', '127.0.1.5', '[::1]']) {
      expect(canRegisterSW({ ...site, protocol: 'http:', host })).toBe(false);
    }
  });
});
