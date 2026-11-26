import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config';

const prod = { NODE_ENV: 'production', DATABASE_URL: 'postgres://u:p@db:5432/deck', DECK_PUBLIC_URL: 'https://deck.example.com' } as NodeJS.ProcessEnv;

describe('configuration', () => {
  it('development works with no settings', () => {
    const c = loadConfig({} as NodeJS.ProcessEnv);
    expect(c.production).toBe(false);
    expect(c.allowedOrigins.has('http://localhost:5173')).toBe(true);
  });

  it('production refuses to start without required settings or with insecure URLs', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toThrow(ConfigError);
    expect(() => loadConfig({ ...prod, DATABASE_URL: '' })).toThrow(/DATABASE_URL is required/);
    expect(() => loadConfig({ ...prod, DECK_PUBLIC_URL: 'http://deck.example.com' })).toThrow(/https/);
    expect(() => loadConfig({ ...prod, DECK_ALLOWED_ORIGINS: 'http://other.example.com' })).toThrow(/https/);
    expect(() => loadConfig({ ...prod, DECK_MAIL_WEBHOOK: 'http://mail.example.com' })).toThrow(/DECK_MAIL_WEBHOOK/);
  });

  it('production never trusts development origins and always uses secure cookies', () => {
    const c = loadConfig(prod);
    expect([...c.allowedOrigins]).toEqual(['https://deck.example.com']);
    expect(c.secureCookies).toBe(true);
  });

  it('rejects malformed values instead of silently using NaN', () => {
    expect(() => loadConfig({ PORT: 'abc' } as NodeJS.ProcessEnv)).toThrow(/PORT/);
    expect(() => loadConfig({ DECK_AUTH_RATE: '0' } as NodeJS.ProcessEnv)).toThrow(/DECK_AUTH_RATE/);
    expect(() => loadConfig({ DATABASE_URL: 'mysql://x' } as NodeJS.ProcessEnv)).toThrow(/DATABASE_URL/);
  });
});
