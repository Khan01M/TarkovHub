// Service worker Tarkov Hub: офлайн-оболочка и запасные копии данных.
// Без библиотек и без сборки — файл кладётся в dist как есть.
// Регистрируется только на сайте (http/https, не localhost), не в EXE (file://) и не в APK (src/pwa.tsx).
//
// Стратегии (выбор — в swRoute ниже, покрыт тестами в src/pwa.test.ts):
//   shell  — страница (index.html): сначала сеть; без сети, по таймауту или при ошибке сервера — сохранённая копия;
//   asset  — файлы сборки ./assets/* (в имени хэш, содержимое не меняется): сначала кэш;
//   static — icon.svg, manifest, icons/* (без хэша): сразу из кэша, а в фоне обновляем копию;
//   data   — json.tarkov.dev, карты-SVG с assets.tarkov.dev, свой promocodes.json: сначала сеть, без сети — копия;
//   null   — не трогаем вовсе: Supabase, любые не-GET, Discord, картинки предметов и всё прочее.
//
// Копия, отданная без сети, помечается заголовком X-TH-Cache: 1. По нему приложение понимает,
// что данные не свежие: api.ts не сохраняет их как новые, Promo.tsx пишет «показана сохранённая копия».
//
// Картинки предметов (assets.tarkov.dev/*.webp) приходят без CORS, то есть «непрозрачными» ответами:
// Chrome считает каждый такой ответ в кэше за несколько мегабайт квоты. Их не кэшируем —
// офлайн их отдаёт обычный HTTP-кэш браузера (сервер ставит max-age на 7 суток).
//
// Обновление: страница всегда сначала идёт в сеть, поэтому новая сборка подхватывается при первом
// заходе с сетью. Новая страница попадает в кэш, только когда скачаны все её файлы, — иначе
// офлайн остаётся прежняя рабочая пара «страница + файлы». VERSION поднимать при изменении логики
// этого файла — старые кэши удалятся в activate.

const VERSION = 'v1';
const SHELL = 'th-shell-' + VERSION;
const ASSETS = 'th-assets-' + VERSION;
const DATA = 'th-data-' + VERSION;
const KEEP = [SHELL, ASSETS, DATA];
const MAX_ASSETS = 120; // старые сборки вытесняются (самые давние записи; файлы текущей страницы не трогаем)
const MAX_DATA = 120;   // наборы tarkov.dev × 2 режима + карты + промокоды — с запасом
const SHELL_TIMEOUT_MS = 6000; // страница: если сеть «висит», а копия есть — не ждём дольше
// Ключи кэша — точные адреса (у файлов сборки хэш в имени), поэтому Vary не учитываем:
// иначе ответ с «Vary: Origin» (так отвечает vite preview) не находится для запроса <script crossorigin>
const MATCH = { ignoreVary: true, ignoreSearch: true };
const CACHE_HEADER = 'X-TH-Cache';

/**
 * Какую стратегию применить к запросу. Чистая функция — без self/caches, чтобы её можно было тестировать.
 * @param {string} url адрес запроса
 * @param {string} method HTTP-метод
 * @param {string} scope адрес папки сайта (registration.scope), например https://khan01m.github.io/TarkovHub/
 * @param {string} [mode] request.mode ('navigate' для перехода на страницу)
 * @returns {'shell'|'asset'|'static'|'data'|null}
 */
function swRoute(url, method, scope, mode) {
  if (method !== 'GET') return null;
  let u;
  try { u = new URL(url); } catch (e) { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname;
  if (host === 'supabase.co' || host.endsWith('.supabase.co')) return null;
  if (host === 'json.tarkov.dev') return 'data';
  if (host === 'assets.tarkov.dev') return u.pathname.startsWith('/maps/') ? 'data' : null;
  const s = new URL(scope);
  if (u.origin !== s.origin || !u.pathname.startsWith(s.pathname)) return null;
  const rest = u.pathname.slice(s.pathname.length);
  if (rest === 'promocodes.json') return 'data';
  if (mode === 'navigate' || rest === '' || rest === 'index.html') return 'shell';
  if (rest.startsWith('assets/')) return 'asset';
  if (rest === 'icon.svg' || rest === 'manifest.webmanifest' || rest.startsWith('icons/')) return 'static';
  return null;
}

/** Пути к файлам сборки, на которые ссылается index.html (./assets/…js|css) */
function shellAssets(html) {
  const out = [];
  const re = /(?:src|href)="(\.?\/?assets\/[^"]+)"/g;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

if (typeof ServiceWorkerGlobalScope !== 'undefined' && self instanceof ServiceWorkerGlobalScope) {
  const scope = () => self.registration.scope;
  const shellUrl = () => new URL('./', scope()).href;
  const abs = (p) => new URL(p, scope()).href;

  // Копия из кэша с пометкой X-TH-Cache: 1 (synthetic-ответ — заголовок виден странице и для чужого домена)
  const marked = (res) => {
    const h = new Headers(res.headers);
    h.set(CACHE_HEADER, '1');
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
  };

  // Файлы, на которые ссылается сохранённая страница, — их обрезка кэша не трогает
  const shellRefs = async () => {
    const s = await (await caches.open(SHELL)).match(shellUrl(), MATCH);
    return new Set(s ? shellAssets(await s.text()).map(abs) : []);
  };

  // Обрезка кэша: удаляем самые старые записи сверх лимита (кроме keep)
  const trim = async (name, max, keep) => {
    const c = await caches.open(name);
    const keys = await c.keys();
    let extra = keys.length - max;
    if (extra <= 0) return;
    const protect = keep || new Set();
    for (const k of keys) {
      if (extra <= 0) break;
      if (protect.has(k.url.replace(/\?.*$/, ''))) continue;
      await c.delete(k); extra--;
    }
  };
  const trimAssets = async () => trim(ASSETS, MAX_ASSETS, await shellRefs());

  // Сохраняем страницу только вместе со всеми её файлами. Сначала скачиваем недостающие файлы,
  // и лишь если все пришли — кладём их и саму страницу. Иначе в кэше остаётся прежняя рабочая пара.
  const saveShell = async (res) => {
    const html = await res.clone().text();
    const assets = await caches.open(ASSETS);
    const urls = shellAssets(html).map(abs);
    const missing = [];
    for (const url of urls) if (!(await assets.match(url, MATCH))) missing.push(url);
    const got = await Promise.all(missing.map(async (url) => {
      const r = await fetch(url, { cache: 'no-cache' });
      if (!r.ok || r.type !== 'basic') throw new Error('asset ' + r.status + ' ' + url);
      return [url, r];
    }));
    await Promise.all(got.map(([url, r]) => assets.put(url, r)));
    await (await caches.open(SHELL)).put(shellUrl(), res);
    trimAssets().catch(() => {});
  };

  self.addEventListener('install', (e) => {
    e.waitUntil((async () => {
      try {
        const r = await fetch(shellUrl(), { cache: 'no-cache' });
        if (r.ok) await saveShell(r);
      } catch (err) { /* без сети установка всё равно проходит: оболочку сохраним при следующем заходе */ }
      try {
        await (await caches.open(SHELL)).addAll(['./icon.svg', './manifest.webmanifest']);
      } catch (err) { /* не страшно */ }
      await self.skipWaiting();
    })());
  });

  self.addEventListener('activate', (e) => {
    e.waitUntil((async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith('th-') && !KEEP.includes(n)).map((n) => caches.delete(n)));
      await self.clients.claim();
    })());
  });

  const timeout = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms));

  const networkFirstShell = async (req) => {
    const cached = caches.open(SHELL).then((c) => c.match(shellUrl(), MATCH));
    const net = fetch(req).then((r) => {
      if (r.ok && (r.headers.get('content-type') || '').includes('text/html')) saveShell(r.clone()).catch(() => {});
      return r;
    });
    net.catch(() => {}); // если победил таймаут, поздняя ошибка сети не должна сыпаться в консоль
    try {
      // Есть копия — ждём сеть не дольше SHELL_TIMEOUT_MS; копии нет — ждём сколько нужно
      const r = (await cached) ? await Promise.race([net, timeout(SHELL_TIMEOUT_MS)]) : await net;
      if (!r.ok) return (await cached) || r; // 404/5xx (например, в окно деплоя) — лучше сохранённая страница
      return r;
    } catch (err) {
      const c = await cached;
      if (c) return c;
      throw err;
    }
  };

  const cacheFirst = async (req) => {
    const c = await caches.open(ASSETS);
    const hit = await c.match(req, MATCH);
    if (hit) return hit;
    const r = await fetch(req);
    if (r.ok && r.type === 'basic') { await c.put(req, r.clone()); trimAssets().catch(() => {}); }
    return r;
  };

  // Иконки и манифест: отдаём копию сразу, а свежую версию докладываем в кэш для следующего раза
  const staleWhileRevalidate = async (req, e) => {
    const c = await caches.open(SHELL);
    const hit = await c.match(req, MATCH);
    const net = fetch(req).then(async (r) => {
      if (r.ok && r.type === 'basic') await c.put(req.url.replace(/\?.*$/, ''), r.clone());
      return r;
    });
    if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
    return net;
  };

  const networkFirstData = async (req) => {
    const c = await caches.open(DATA);
    try {
      const r = await fetch(req);
      // Только полноценные ответы: ошибки и «непрозрачные» ответы не сохраняем
      if (r.ok && r.type !== 'opaque') {
        const key = req.url;
        const copy = r.clone(); // клонировать сразу, пока страница не начала читать тело
        // delete + put — запись переезжает в конец списка, trim удаляет давно не обновлявшиеся
        c.delete(key).then(() => c.put(key, copy)).then(() => trim(DATA, MAX_DATA)).catch(() => {});
      }
      return r;
    } catch (err) {
      const hit = await c.match(req.url, { ignoreVary: true });
      if (hit) return marked(hit);
      throw err;
    }
  };

  // При первом заходе страница загрузила файлы ещё до того, как воркер стал её обслуживать
  // (например, отдельный кусок с Supabase). Страница присылает их список — докладываем в кэш.
  self.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || d.type !== 'cache-assets' || !Array.isArray(d.urls)) return;
    e.waitUntil((async () => {
      const c = await caches.open(ASSETS);
      for (const url of d.urls.slice(0, 50)) {
        if (typeof url !== 'string' || swRoute(url, 'GET', scope(), 'no-cors') !== 'asset') continue;
        if (await c.match(url, MATCH)) continue;
        try { const r = await fetch(url); if (r.ok && r.type === 'basic') await c.put(url, r); } catch (err) { /* нет сети — не страшно */ }
      }
      await trimAssets();
    })());
  });

  self.addEventListener('fetch', (e) => {
    const req = e.request;
    const kind = swRoute(req.url, req.method, scope(), req.mode);
    if (kind === 'shell') e.respondWith(networkFirstShell(req));
    else if (kind === 'asset') e.respondWith(cacheFirst(req));
    else if (kind === 'static') e.respondWith(staleWhileRevalidate(req, e));
    else if (kind === 'data') e.respondWith(networkFirstData(req));
    // null — запрос идёт как обычно, мимо service worker
  });
}
