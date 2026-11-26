/// <reference types="vite/client" />
import { useEffect, useState } from 'react';

// PWA: регистрация service worker (public/sw.js) и плашка «нет сети».

type Env = { prod: boolean; protocol: string; host: string; hasSW: boolean; capacitor: boolean; desktop: boolean };

// Локальный адрес: после `vite preview` воркер остался бы жить и перехватывал бы другие проекты на том же порту
const isLocal = (h: string) => h === 'localhost' || h.endsWith('.localhost') || /^127(\.\d+){3}$/.test(h) || h === '[::1]' || h === '::1';

/** Service worker нужен только сайту: не в dev, не на localhost, не в EXE (file:// и мост Electron), не в APK (Capacitor) */
export function canRegisterSW(e: Env): boolean {
  return e.prod && e.hasSW && !e.capacitor && !e.desktop && !isLocal(e.host) && (e.protocol === 'https:' || e.protocol === 'http:');
}

export function registerSW() {
  const w = window as any;
  const ok = canRegisterSW({
    prod: import.meta.env.PROD,
    protocol: location.protocol,
    host: location.hostname,
    hasSW: 'serviceWorker' in navigator,
    capacitor: !!w.Capacitor,
    desktop: !!w.tarkovHub,
  });
  if (!ok) return;
  // После загрузки страницы — чтобы установка воркера не отнимала сеть у первой отрисовки
  const go = () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch((e) => console.warn('service worker:', e));
    // Файлы, загруженные до того, как воркер начал обслуживать страницу, — пусть он их сохранит
    navigator.serviceWorker.ready.then((reg) => {
      const urls = performance.getEntriesByType('resource').map((r) => r.name).filter((u) => u.startsWith(location.origin));
      reg.active?.postMessage({ type: 'cache-assets', urls });
    }).catch(() => {});
  };
  if (document.readyState === 'complete') go(); else addEventListener('load', go, { once: true });
}

function useOnline() {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    addEventListener('online', on); addEventListener('offline', off);
    return () => { removeEventListener('online', on); removeEventListener('offline', off); };
  }, []);
  return online;
}

/** Плашка без сети. Контейнер с role=status живёт всегда — иначе скринридер не озвучит появление текста */
export function OfflineBar() {
  const online = useOnline();
  return (
    <div className={`pwa-offline${online ? '' : ' on'}`} role="status">
      {online ? '' : <><span className="pwa-dot" aria-hidden="true" />Нет сети — показаны сохранённые данные</>}
    </div>
  );
}
