// Вход через Discord (Supabase Auth, PKCE).
// PKCE возвращает «?code=…» в строке запроса, а не токены в «#…», поэтому не мешает маршрутам вида #/quests.
import { useEffect, useState } from 'react';
import type { SupabaseClient, Session } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config';
import { desktop } from './position';

export type AuthStatus =
  | 'off'        // Supabase не настроен
  | 'app'        // EXE/APK: вход только на сайте
  | 'loading'
  | 'signedOut'
  | 'allowed'
  | 'denied'     // вошёл, но не в списке игроков
  | 'error';

export type AuthState = { status: AuthStatus; userId?: string; name?: string; avatar?: string; error?: string };

const configured = !!(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
const inApp = !!desktop || !!(window as any).Capacitor?.isNativePlatform?.() || location.protocol === 'file:';

let client: SupabaseClient | null = null;
let state: AuthState = { status: !configured ? 'off' : inApp ? 'app' : 'loading' };
const listeners = new Set<(s: AuthState) => void>();
const set = (s: AuthState) => { state = s; listeners.forEach((l) => l(s)); };

const RETURN_KEY = 'auth:returnHash';

export async function getClient(): Promise<SupabaseClient | null> {
  if (!configured || inApp) return null;
  if (!client) {
    const { createClient } = await import('@supabase/supabase-js');
    client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }
  return client;
}

async function applySession(session: Session | null) {
  if (!session) { set({ status: 'signedOut' }); return; }
  const u = session.user;
  const m: any = u.user_metadata || {};
  const base = { userId: u.id, name: m.custom_claims?.global_name || m.full_name || m.name || m.user_name || 'Игрок', avatar: m.avatar_url };
  try {
    const c = await getClient();
    const { data, error } = await c!.rpc('am_i_allowed');
    if (error) throw error;
    set({ ...base, status: data === true ? 'allowed' : 'denied' });
  } catch (e: any) {
    set({ ...base, status: 'error', error: e?.message || String(e) });
  }
}

let started = false;
async function start() {
  if (started || state.status === 'off' || state.status === 'app') return;
  started = true;
  const c = await getClient();
  if (!c) return;
  c.auth.onAuthStateChange((event, session) => {
    // Обработку откладываем: внутри колбэка нельзя ждать другие вызовы клиента
    if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
      setTimeout(() => applySession(session), 0);
    }
    if (event === 'SIGNED_IN') cleanUrl();
  });
}

// Убираем ?code=… из адреса и возвращаем страницу, с которой начинали вход
function cleanUrl() {
  const url = new URL(location.href);
  if (url.searchParams.has('code') || url.searchParams.has('error')) {
    url.searchParams.delete('code'); url.searchParams.delete('error'); url.searchParams.delete('error_description');
    let hash = url.hash;
    try { hash = sessionStorage.getItem(RETURN_KEY) || hash; sessionStorage.removeItem(RETURN_KEY); } catch { /* ignore */ }
    history.replaceState(null, '', url.pathname + url.search + hash);
    dispatchEvent(new HashChangeEvent('hashchange'));
  }
}

export async function signIn() {
  const c = await getClient();
  if (!c) return;
  try { sessionStorage.setItem(RETURN_KEY, location.hash || '#/quests'); } catch { /* ignore */ }
  const { error } = await c.auth.signInWithOAuth({
    provider: 'discord',
    options: { redirectTo: location.origin + location.pathname },
  });
  if (error) set({ ...state, status: 'error', error: error.message });
}

export async function signOut() {
  const c = await getClient();
  if (!c) return;
  await c.auth.signOut();
  set({ status: 'signedOut' });
}

export function useAuth(): AuthState {
  const [s, setS] = useState(state);
  useEffect(() => {
    listeners.add(setS);
    setS(state);
    start();
    return () => { listeners.delete(setS); };
  }, []);
  return s;
}

export function getAuth() { return state; }
export function onAuth(l: (s: AuthState) => void) { listeners.add(l); return () => listeners.delete(l); }

// Если в адресе ошибка от Discord/Supabase (например, отказ от входа) — показать её
const params = new URLSearchParams(location.search);
if (configured && !inApp && params.get('error')) {
  state = { status: 'error', error: params.get('error_description') || params.get('error') || '' };
  setTimeout(cleanUrl, 0);
}
