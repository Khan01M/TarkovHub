// Tarkov Hub — десктопная версия (Windows / macOS / Linux).
// Интеграция с игрой без вмешательства в её процесс:
//  1) следим за папкой скриншотов — EFT пишет координаты игрока в имя файла;
//  2) читаем логи игры — по строке "Location: <id>" узнаём, какая карта загрузилась.
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');

const APP_INDEX = path.join(__dirname, '..', 'dist', 'index.html');
const APP_DIR_URL = pathToFileURL(path.join(__dirname, '..', 'dist') + path.sep).href;

// Во внешний браузер отдаём только http(s). Ссылки file:, smb:, ms-*: и прочие
// протоколы в Windows могут запустить программу, поэтому они отклоняются.
function isSafeExternal(url) {
  try { const u = new URL(url); return u.protocol === 'https:' || u.protocol === 'http:'; } catch { return false; }
}
function openExternalSafe(url) { if (isSafeExternal(url)) shell.openExternal(url); }

// Принимаем IPC только от собственной страницы приложения.
// Сравниваем file://-адреса без учёта кодирования и (в Windows) регистра:
// путь может содержать кириллицу и пробелы.
function normFileUrl(u) {
  let s = ''; try { s = decodeURIComponent(new URL(u).href.split(/[?#]/)[0]); } catch { return ''; }
  return process.platform === 'win32' ? s.toLowerCase() : s;
}
const isAppUrl = (u) => typeof u === 'string' && u.startsWith('file:') && normFileUrl(u).startsWith(normFileUrl(APP_DIR_URL));
function fromApp(event) {
  return event.sender === win?.webContents && isAppUrl(event.senderFrame?.url || '');
}

let win;
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
let settings = {};
function loadSettings() { try { settings = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { settings = {}; } }
function saveSettings() { try { fs.mkdirSync(path.dirname(settingsFile()), { recursive: true }); fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2)); } catch {} }

// ---------- скриншоты ----------
const RE = /_(-?\d+(?:\.\d+)?), (-?\d+(?:\.\d+)?), (-?\d+(?:\.\d+)?)_(-?\d+(?:\.\d+)?), (-?\d+(?:\.\d+)?), (-?\d+(?:\.\d+)?), (-?\d+(?:\.\d+)?)_/;
function parseName(name) {
  const m = name.match(RE);
  if (!m) return null;
  const [x, y, z, qx, qy, qz, qw] = m.slice(1).map(Number);
  const yaw = Math.atan2(2 * (qw * qy + qx * qz), 1 - 2 * (qx * qx + qy * qy));
  return { x, y, z, yaw, time: Date.now(), file: name };
}

function defaultScreenshotsDir() {
  const docs = (() => { try { return app.getPath('documents'); } catch { return path.join(os.homedir(), 'Documents'); } })();
  return path.join(docs, 'Escape from Tarkov', 'Screenshots');
}

let shotWatcher = null;
const seen = new Set();
function watchScreenshots() {
  if (shotWatcher) { shotWatcher.close(); shotWatcher = null; }
  const dir = settings.screenshotsDir || defaultScreenshotsDir();
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  try {
    shotWatcher = fs.watch(dir, (_evt, file) => {
      if (!file || !/\.(png|jpe?g|bmp)$/i.test(file) || seen.has(file)) return;
      const pos = parseName(file);
      if (!pos) return;
      if (seen.size > 5000) seen.clear();
      seen.add(file);
      win?.webContents.send('position', pos);
    });
  } catch (e) { console.error('Не удалось следить за папкой скриншотов:', e.message); }
}

// ---------- логи игры (определение карты) ----------
const GAME_DIR_CANDIDATES = ['C', 'D', 'E', 'F'].flatMap((d) => [
  `${d}:\\Battlestate Games\\EFT`, `${d}:\\Battlestate Games\\Escape from Tarkov`, `${d}:\\Games\\Escape from Tarkov`,
]);
function gameDir() {
  if (settings.gameDir && fs.existsSync(settings.gameDir)) return settings.gameDir;
  return GAME_DIR_CANDIDATES.find((p) => { try { return fs.existsSync(path.join(p, 'Logs')); } catch { return false; } }) || '';
}

let logState = { file: '', size: 0, map: '' };
function newestLog(logsDir) {
  try {
    const dirs = fs.readdirSync(logsDir, { withFileTypes: true }).filter((d) => d.isDirectory())
      .map((d) => path.join(logsDir, d.name)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    for (const d of dirs.slice(0, 2)) {
      const f = fs.readdirSync(d).filter((n) => /application.*\.log$/i.test(n))
        .map((n) => path.join(d, n)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
      if (f) return f;
    }
  } catch {}
  return '';
}
function pollLogs() {
  const gd = gameDir();
  if (!gd) return;
  const file = newestLog(path.join(gd, 'Logs'));
  if (!file) return;
  try {
    const size = fs.statSync(file).size;
    if (file !== logState.file) logState = { file, size: Math.max(0, size - 200000), map: logState.map };
    if (size <= logState.size) return;
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(size - logState.size);
    fs.readSync(fd, buf, 0, buf.length, logState.size);
    fs.closeSync(fd);
    logState.size = size;
    const matches = [...buf.toString('utf8').matchAll(/Location:\s*([A-Za-z0-9_]+)/g)];
    const last = matches.length ? matches[matches.length - 1][1] : '';
    if (last && last !== logState.map) { logState.map = last; win?.webContents.send('map', last); }
  } catch {}
}

// ---------- окно ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 380, backgroundColor: '#0f1110', title: 'Tarkov Hub',
    icon: path.join(__dirname, '..', 'dist', 'icon.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      webSecurity: true, webviewTag: false, spellcheck: false,
    },
  });
  win.loadFile(APP_INDEX);
  // Новые окна не открываем: http(s)-ссылки уходят в обычный браузер, остальное отклоняется.
  win.webContents.setWindowOpenHandler(({ url }) => { openExternalSafe(url); return { action: 'deny' }; });
  // Окно приложения никогда не уходит со своей страницы — иначе чужой сайт получил бы мост preload.
  const guardNav = (e, url) => { if (!isAppUrl(url)) { e.preventDefault(); openExternalSafe(url); } };
  win.webContents.on('will-navigate', guardNav);
  win.webContents.on('will-redirect', guardNav);

  const menu = Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { label: 'Вид', submenu: [
      { label: 'Поверх всех окон', type: 'checkbox', checked: !!settings.onTop,
        click: (i) => { settings.onTop = i.checked; win.setAlwaysOnTop(i.checked); saveSettings(); } },
      { role: 'reload', label: 'Обновить' }, { role: 'togglefullscreen', label: 'Полный экран' },
      { role: 'zoomIn', label: 'Крупнее' }, { role: 'zoomOut', label: 'Мельче' }, { role: 'resetZoom', label: 'Обычный размер' },
      { type: 'separator' }, { role: 'toggleDevTools', label: 'Инструменты разработчика' },
    ] },
  ]);
  Menu.setApplicationMenu(menu);
  if (settings.onTop) win.setAlwaysOnTop(true);
}

ipcMain.handle('get-screenshots-dir', (e) => fromApp(e) ? (settings.screenshotsDir || defaultScreenshotsDir()) : null);
ipcMain.handle('choose-screenshots-dir', async (e) => {
  if (!fromApp(e)) return null;
  const r = await dialog.showOpenDialog(win, { title: 'Папка скриншотов Escape from Tarkov', properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  settings.screenshotsDir = r.filePaths[0]; saveSettings(); watchScreenshots();
  return settings.screenshotsDir;
});
ipcMain.handle('get-game-dir', (e) => fromApp(e) ? gameDir() : null);
ipcMain.handle('choose-game-dir', async (e) => {
  if (!fromApp(e)) return null;
  const r = await dialog.showOpenDialog(win, { title: 'Папка, где установлена игра (в ней есть папка Logs)', properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  settings.gameDir = r.filePaths[0]; saveSettings(); logState = { file: '', size: 0, map: '' };
  return settings.gameDir;
});
ipcMain.on('open-external', (e, url) => { if (fromApp(e) && typeof url === 'string') openExternalSafe(url); });

// Запрещаем любые <webview> и запросы разрешений (камера, микрофон, геолокация и т. п.) — приложению они не нужны.
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (ev) => ev.preventDefault());
});

app.whenReady().then(() => {
  require('electron').session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  loadSettings();
  createWindow();
  watchScreenshots();
  setInterval(pollLogs, 3000);
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
