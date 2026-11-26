export interface Config {
  port: number;
  databaseUrl: string;
  publicUrl: string;
  allowedOrigins: Set<string>;
  secureCookies: boolean;
  production: boolean;
  staticDir: string | null;
  maxDocBytes: number;
  ai: { provider: 'anthropic' | 'none'; model: string };
  mailWebhook: string | null;
  limits: { authPerMinute: number; apiPerMinute: number };
}

/** Thrown at startup so a misconfigured production server never runs on development defaults. */
export class ConfigError extends Error {}

function int(env: NodeJS.ProcessEnv, key: string, def: number, min: number, max: number): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new ConfigError(`${key} must be an integer between ${min} and ${max}`);
  return n;
}

function url(value: string, key: string, protocols: string[]): string {
  let u: URL;
  try { u = new URL(value); } catch { throw new ConfigError(`${key} is not a valid URL`); }
  if (!protocols.includes(u.protocol)) throw new ConfigError(`${key} must use ${protocols.join(' or ')}`);
  return value;
}

export function loadConfig(env = process.env): Config {
  const production = env.NODE_ENV === 'production';
  if (production) {
    // No silent fallbacks to development values in production.
    for (const key of ['DATABASE_URL', 'DECK_PUBLIC_URL'] as const) if (!env[key]) throw new ConfigError(`${key} is required in production`);
    if (!env.DECK_PUBLIC_URL!.startsWith('https://')) throw new ConfigError('DECK_PUBLIC_URL must be https:// in production');
  }
  const publicUrl = url((env.DECK_PUBLIC_URL ?? 'http://localhost:5173').replace(/\/$/, ''), 'DECK_PUBLIC_URL', ['http:', 'https:']);
  const extra = (env.DECK_ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
  for (const o of extra) {
    url(o, 'DECK_ALLOWED_ORIGINS', ['http:', 'https:']);
    if (production && !o.startsWith('https://')) throw new ConfigError('DECK_ALLOWED_ORIGINS must all be https:// in production');
  }
  const origins = new Set([publicUrl, ...extra]);
  if (!production) origins.add('http://localhost:5173').add('http://127.0.0.1:5173').add('http://localhost:8787');
  const databaseUrl = url(env.DATABASE_URL ?? 'postgres://deck@localhost:5439/deck', 'DATABASE_URL', ['postgres:', 'postgresql:']);
  const mailWebhook = env.DECK_MAIL_WEBHOOK ? url(env.DECK_MAIL_WEBHOOK, 'DECK_MAIL_WEBHOOK', production ? ['https:'] : ['http:', 'https:']) : null;
  return {
    port: int(env, 'PORT', 8787, 0, 65535),
    databaseUrl,
    publicUrl,
    allowedOrigins: origins,
    secureCookies: production || publicUrl.startsWith('https:'),
    production,
    staticDir: env.DECK_STATIC_DIR ?? null,
    maxDocBytes: int(env, 'DECK_MAX_DOC_BYTES', 200 * 1024 * 1024, 1024 * 1024, 2 * 1024 * 1024 * 1024),
    ai: { provider: env.ANTHROPIC_API_KEY || env.DECK_AI_PROVIDER === 'anthropic' ? 'anthropic' : 'none', model: env.DECK_AI_MODEL ?? 'claude-opus-5-5' },
    mailWebhook,
    limits: { authPerMinute: int(env, 'DECK_AUTH_RATE', 30, 1, 100_000), apiPerMinute: int(env, 'DECK_API_RATE', 600, 1, 1_000_000) },
  };
}
