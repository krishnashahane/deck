/** Minimal client for the DECK server. All requests send the CSRF token from its cookie as a header. */
export interface User { id: string; email: string; name: string; mfa: boolean }
export interface CloudDoc { id: string; title: string; role: Role; updated_at: string; owner_name: string }
export type Role = 'owner' | 'editor' | 'commenter' | 'viewer';

function csrf(): string {
  return document.cookie.split('; ').find((c) => c.startsWith('deck_csrf='))?.slice(10) ?? '';
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? (init.body ? 'POST' : 'GET'),
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-deck-csrf': csrf() },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? res.statusText);
  return data as T;
}

let serverUp: boolean | null = null;
export async function serverAvailable(): Promise<boolean> {
  if (serverUp !== null) return serverUp;
  // Static hosting (no API behind this origin): skip the probe entirely.
  if (import.meta.env.VITE_DECK_STATIC === '1') return (serverUp = false);
  try {
    const r = await fetch('/api/health', { credentials: 'same-origin' });
    serverUp = r.ok && (await r.json()).ok === true;
  } catch {
    serverUp = false;
  }
  return serverUp;
}

export async function me(): Promise<User | null> {
  if (!(await serverAvailable())) return null;
  try {
    return await api<User | null>('/auth/me');
  } catch {
    return null;
  }
}

export function b64(u: Uint8Array): string {
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}
export function unb64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
