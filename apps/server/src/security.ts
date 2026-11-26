import { createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/* ───────────── passwords (scrypt, memory-hard) ───────────── */

const N = 1 << 15, R = 8, P = 1, KEYLEN = 64;

function scrypt(pw: string, salt: Buffer, n = N, r = R, p = P): Promise<Buffer> {
  return new Promise((res, rej) => scryptCb(pw.normalize('NFKC'), salt, KEYLEN, { N: n, r, p, maxmem: 128 * n * r * 2 }, (e, k) => (e ? rej(e) : res(k))));
}

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const key = await scrypt(pw, Buffer.from(salt, 'base64'), Number(n), Number(r), Number(p));
  const want = Buffer.from(hash, 'base64');
  return want.length === key.length && timingSafeEqual(want, key);
}

/** Pre-computed hash used to equalise timing when the account does not exist. */
export const DUMMY_HASH = 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64');

export function passwordProblem(pw: unknown): string | null {
  if (typeof pw !== 'string') return 'Password required';
  if (pw.length < 12) return 'Password must be at least 12 characters';
  if (pw.length > 256) return 'Password is too long';
  if (/^(.)\1+$/.test(pw) || /^(password|123456|qwerty)/i.test(pw)) return 'Password is too easy to guess';
  return null;
}

/* ───────────── tokens ───────────── */

export const token = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const id = (prefix: string) => `${prefix}_${randomBytes(12).toString('base64url')}`;

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/* ───────────── TOTP (RFC 6238, SHA-1, 30 s, 6 digits) ───────────── */

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32(buf: Buffer): string {
  let bits = 0, val = 0, out = '';
  for (const b of buf) {
    val = (val << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(val >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}

function unbase32(s: string): Buffer {
  let bits = 0, val = 0;
  const out: number[] = [];
  for (const c of s.replace(/=+$/, '').toUpperCase()) {
    const i = B32.indexOf(c);
    if (i < 0) continue;
    val = (val << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((val >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function totp(secret: string, at = Date.now(), step = 30): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / step)));
  const h = createHmac('sha1', unbase32(secret)).update(counter).digest();
  const o = h[h.length - 1]! & 15;
  const code = ((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
  return code;
}

/** Accept the current code and one step either side (clock drift). */
export function verifyTotp(secret: string, code: unknown, at = Date.now()): boolean {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) return false;
  return [-1, 0, 1].some((d) => safeEqual(totp(secret, at + d * 30000), code.trim()));
}

/* ───────────── rate limiting (token bucket per key) ───────────── */

export function rateLimit(opts: { windowMs: number; max: number; key?: (req: Request) => string; name: string }) {
  const hits = new Map<string, { n: number; reset: number }>();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, opts.windowMs).unref();
  return (req: Request, res: Response, next: NextFunction) => {
    const k = `${opts.name}:${opts.key ? opts.key(req) : req.ip}`;
    const now = Date.now();
    const h = hits.get(k);
    if (!h || h.reset < now) {
      hits.set(k, { n: 1, reset: now + opts.windowMs });
      return next();
    }
    if (++h.n > opts.max) {
      res.setHeader('Retry-After', Math.ceil((h.reset - now) / 1000));
      return res.status(429).json({ error: 'Too many requests — please wait and try again' });
    }
    next();
  };
}

/* ───────────── cookies, CSRF, headers ───────────── */

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k || k in out) continue;
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore malformed */ }
  }
  return out;
}

export function cookie(name: string, value: string, opts: { httpOnly: boolean; maxAge?: number; secure: boolean }): string {
  return [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'SameSite=Lax', opts.httpOnly ? 'HttpOnly' : '', opts.secure ? 'Secure' : '', opts.maxAge !== undefined ? `Max-Age=${opts.maxAge}` : ''].filter(Boolean).join('; ');
}

/**
 * CSRF: state-changing requests must carry X-Deck-CSRF equal to the deck_csrf
 * cookie (double-submit) and, when present, an Origin in the allow-list.
 */
export function csrf(allowedOrigins: Set<string>) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.has(origin)) return res.status(403).json({ error: 'Cross-origin request refused' });
    const c = parseCookies(req.headers.cookie).deck_csrf;
    const h = req.headers['x-deck-csrf'];
    if (!c || typeof h !== 'string' || !safeEqual(c, h)) return res.status(403).json({ error: 'Missing or invalid CSRF token — reload the page' });
    next();
  };
}

export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export function securityHeaders(prod: boolean) {
  return (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=(self), display-capture=(self)');
    if (prod) res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
    next();
  };
}

export function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}
