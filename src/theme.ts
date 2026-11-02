// Темы оформления. Переключаются атрибутом data-theme на <html>, цвета заданы в styles.css.
export type ThemeId = 'olive' | 'multicam-black' | 'metal' | 'telnyashka' | 'gear';

export const THEMES: { id: ThemeId; name: string; color: string }[] = [
  { id: 'olive', name: 'Олива', color: '#11130e' },
  { id: 'multicam-black', name: 'Чёрный мультикам', color: '#0b0b0b' },
  { id: 'metal', name: 'Металл', color: '#121518' },
  { id: 'telnyashka', name: 'Тельняшка', color: '#0d1626' },
  { id: 'gear', name: 'Снаряжение', color: '#15120e' },
];

const KEY = 'theme';

export function getTheme(): ThemeId {
  try {
    const t = localStorage.getItem(KEY) as ThemeId | null;
    if (t && THEMES.some((x) => x.id === t)) return t;
  } catch { /* ignore */ }
  return 'olive';
}

export function applyTheme(id: ThemeId) {
  document.documentElement.dataset.theme = id;
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute('content', THEMES.find((x) => x.id === id)?.color || '#11130e');
}

export function setTheme(id: ThemeId) {
  try { localStorage.setItem(KEY, id); } catch { /* ignore */ }
  applyTheme(id);
}
