// Безопасный мост между окном приложения и Electron (без доступа к Node из страницы).
const { contextBridge, ipcRenderer } = require('electron');

const sub = (channel) => (cb) => {
  const h = (_e, data) => cb(data);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};

contextBridge.exposeInMainWorld('tarkovHub', {
  isDesktop: true,
  getScreenshotsDir: () => ipcRenderer.invoke('get-screenshots-dir'),
  chooseScreenshotsDir: () => ipcRenderer.invoke('choose-screenshots-dir'),
  getGameDir: () => ipcRenderer.invoke('get-game-dir'),
  chooseGameDir: () => ipcRenderer.invoke('choose-game-dir'),
  onPosition: sub('position'),
  onMapDetected: sub('map'),
  openExternal: (url) => ipcRenderer.send('open-external', url),
});
