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

export function loadConfig(env = process.env): Config {
  const production = env.NODE_ENV === 'production';
  const publicUrl = (env.DECK_PUBLIC_URL ?? 'http://localhost:5173').replace(/\/$/, '');
  const origins = new Set([publicUrl, ...(env.DECK_ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean)]);
  if (!production) origins.add('http://localhost:5173').add('http://127.0.0.1:5173').add('http://localhost:8787');
  return {
    port: Number(env.PORT ?? 8787),
    databaseUrl: env.DATABASE_URL ?? 'postgres://deck@localhost:5439/deck',
    publicUrl,
    allowedOrigins: origins,
    secureCookies: production || publicUrl.startsWith('https:'),
    production,
    staticDir: env.DECK_STATIC_DIR ?? null,
    maxDocBytes: Number(env.DECK_MAX_DOC_BYTES ?? 200 * 1024 * 1024),
    ai: { provider: env.ANTHROPIC_API_KEY || env.DECK_AI_PROVIDER === 'anthropic' ? 'anthropic' : 'none', model: env.DECK_AI_MODEL ?? 'claude-opus-5-5' },
    mailWebhook: env.DECK_MAIL_WEBHOOK ?? null,
    limits: { authPerMinute: Number(env.DECK_AUTH_RATE ?? 30), apiPerMinute: Number(env.DECK_API_RATE ?? 600) },
  };
}
