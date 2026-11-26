// Отметки «Я уже активировал» на странице «Промокоды».
// Без входа — localStorage (ключ usedCodes), как раньше.
// Игрок из списка вошёл — отметки лежат в прогрессе аккаунта (quest_progress) с ключом «promo:<КОД>»:
// PvE-коды — в режиме pve, остальные (PvP, PvP-сезон, «режим уточняется») — в regular.
// Читаем оба режима: если в списке у кода сменится режим, отметка не потеряется.
// Остальной код ключи «promo:» не считает: квесты ищутся по id, Терминал — по «t:», уровень — по «lvl:»/«ll:».
import type { GameMode } from './api';

export const PROMO_PREFIX = 'promo:';
/** quest_id в Supabase — текст от 1 до 64 символов */
const MAX_KEY = 64;

export type PromoMode = 'pve' | 'season' | 'pvp' | 'unknown';
type Marks = Record<string, boolean>;
type Changes = Record<string, boolean>;

/** Ключ отметки в прогрессе; null, если код слишком длинный для quest_id (такой код отмечается только в браузере) */
export function promoKey(code: string): string | null {
  const k = PROMO_PREFIX + code;
  return code && k.length <= MAX_KEY ? k : null;
}
export const isPromoKey = (k: string) => k.startsWith(PROMO_PREFIX);

/** В каком режиме прогресса хранить отметку кода */
export const promoProgressMode = (m: PromoMode | undefined): GameMode => (m === 'pve' ? 'pve' : 'regular');

/** Активирован ли код по отметкам аккаунта (в любом из режимов) */
export function usedInAccount(code: string, regular: Marks, pve: Marks): boolean {
  const k = promoKey(code);
  return !!k && (!!regular[k] || !!pve[k]);
}

/** Изменения отметок: включить — в режиме кода; снять — везде, где отметка стоит */
export function promoChanges(code: string, mode: GameMode, on: boolean, regular: Marks, pve: Marks): { regular: Changes; pve: Changes } {
  const k = promoKey(code);
  const out = { regular: {} as Changes, pve: {} as Changes };
  if (!k) return out;
  if (on) out[mode][k] = true;
  else {
    if (regular[k]) out.regular[k] = false;
    if (pve[k]) out.pve[k] = false;
  }
  return out;
}

// ---------- localStorage ----------
export const USED_KEY = 'usedCodes';
/** Какие коды с этого устройства уже перенесены в аккаунт этого игрока */
export const syncedKey = (userId: string) => `usedCodesSynced:${userId}`;

export function readUsedLocal(): Marks {
  try {
    const raw = JSON.parse(localStorage.getItem(USED_KEY) || '{}');
    const out: Marks = {};
    if (raw && typeof raw === 'object') for (const [k, v] of Object.entries(raw)) if (v === true) out[k] = true;
    return out;
  } catch { return {}; }
}
export function writeUsedLocal(m: Marks) {
  try { localStorage.setItem(USED_KEY, JSON.stringify(m)); } catch { /* ignore */ }
}
export function readSynced(userId: string): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(syncedKey(userId)) || '[]');
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}

/** Что перенести из usedCodes в аккаунт: отмеченные коды, которых ещё не переносили этому игроку.
 *  Уже перенесённые не трогаем, чтобы не вернуть отметку, снятую в аккаунте. */
export function migrationPlan(local: Marks, synced: string[], modeOf: (code: string) => GameMode) {
  const done = new Set(synced);
  const plan = { regular: [] as string[], pve: [] as string[], codes: [] as string[] };
  for (const [code, v] of Object.entries(local)) {
    const k = promoKey(code);
    if (v !== true || !k || done.has(code)) continue;
    plan[modeOf(code)].push(k);
    plan.codes.push(code);
  }
  return plan;
}

// ---------- хозяин устройства ----------
// usedCodes на устройстве принадлежат первому вошедшему на нём игроку: только ему переносим их в аккаунт
// и только его аккаунт зеркалим обратно в usedCodes. Друг, вошедший на чужом ПК, их не получает и не портит.
export const OWNER_KEY = 'usedCodesOwner';
export function readOwner(): string | null {
  try { return localStorage.getItem(OWNER_KEY) || null; } catch { return null; }
}
/** Хозяин этого устройства — userId (если хозяина ещё нет, им становится userId) */
export function claimOwner(userId: string): boolean {
  const owner = readOwner();
  if (owner) return owner === userId;
  try { localStorage.setItem(OWNER_KEY, userId); } catch { /* ignore */ }
  return true;
}
/** usedCodes хозяина как в аккаунте: коды из promo-ключей обоих режимов; коды без ключа (слишком длинные) остаются */
export function mirrorLocal(local: Marks, regular: Marks, pve: Marks): Marks {
  const out: Marks = {};
  for (const code of Object.keys(local)) if (local[code] && !promoKey(code)) out[code] = true;
  for (const m of [regular, pve]) for (const k of Object.keys(m)) if (m[k] && isPromoKey(k)) out[k.slice(PROMO_PREFIX.length)] = true;
  return out;
}
export const sameMarks = (a: Marks, b: Marks) => {
  const ka = Object.keys(a).filter((k) => a[k]);
  return ka.length === Object.keys(b).filter((k) => b[k]).length && ka.every((k) => b[k]);
};

type Upload = (mode: GameMode, userId: string, ids: string[]) => Promise<void>;

/** Однократный перенос отметок с устройства в аккаунт хозяина через uploadMarks (повтор не создаёт дублей).
 *  usedCodes не стираем: без входа отметки по-прежнему видны. Возвращает, сколько кодов перенесено.
 *  Сознательно не обрабатываем: код, перенесённый раньше, снятый в аккаунте и снова отмеченный без входа,
 *  повторно не переносится; если упала запись второго режима, первый уже записан (повтор не создаст дублей). */
export async function migrateUsedCodes(userId: string, modeOf: (code: string) => GameMode, upload: Upload): Promise<number> {
  if (!claimOwner(userId)) return 0;
  const synced = readSynced(userId);
  const plan = migrationPlan(readUsedLocal(), synced, modeOf);
  if (!plan.codes.length) return 0;
  await upload('regular', userId, plan.regular);
  await upload('pve', userId, plan.pve);
  try { localStorage.setItem(syncedKey(userId), JSON.stringify([...synced, ...plan.codes])); } catch { /* ignore */ }
  return plan.codes.length;
}
