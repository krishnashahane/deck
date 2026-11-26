import { Router, type NextFunction, type Request, type Response } from 'express';
import { randomBytes } from 'node:crypto';
import type { Db } from './db';
import { audit } from './db';
import { DUMMY_HASH, base32, clientIp, cookie, hashPassword, id, parseCookies, passwordProblem, sha256, token, verifyPassword, verifyTotp } from './security';
import type { Config } from './config';

export interface AuthedUser {
  id: string;
  email: string;
  name: string;
  mfa: boolean;
  sessionId: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthedUser;
  }
}

const SESSION_DAYS = 14;

/** Resolve the session cookie to a user (or null). Sliding expiry; revoked/expired sessions are rejected. */
export async function sessionUser(db: Db, cookieHeader: string | undefined): Promise<AuthedUser | null> {
  const raw = parseCookies(cookieHeader).deck_sid;
  if (!raw || raw.length > 200) return null;
  const sid = sha256(raw);
  const r = await db.query(
    `update sessions s set last_seen = now() from users u
     where s.id = $1 and s.user_id = u.id and not s.revoked and s.expires_at > now()
     returning u.id, u.email, u.name, u.mfa_enabled`,
    [sid],
  );
  const row = r.rows[0];
  return row ? { id: row.id, email: row.email, name: row.name, mfa: row.mfa_enabled, sessionId: sid } : null;
}

export function attachUser(db: Db) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      req.user = (await sessionUser(db, req.headers.cookie)) ?? undefined;
      next();
    } catch (e) {
      next(e);
    }
  };
}

export function requireUser(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'Sign in required' });
  next();
}

const emailOk = (e: unknown): e is string => typeof e === 'string' && e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

export interface Mailer {
  send(to: string, subject: string, text: string): Promise<void>;
}

export function authRoutes(db: Db, cfg: Config, mailer: Mailer, onSessionsRevoked: (userId: string) => void): Router {
  const r = Router();

  const issueSession = async (res: Response, req: Request, userId: string) => {
    const t = token(32);
    await db.query('insert into sessions (id, user_id, expires_at, user_agent) values ($1,$2, now() + $3::interval, $4)', [sha256(t), userId, `${SESSION_DAYS} days`, String(req.headers['user-agent'] ?? '').slice(0, 300)]);
    res.setHeader('Set-Cookie', [
      cookie('deck_sid', t, { httpOnly: true, maxAge: SESSION_DAYS * 86400, secure: cfg.secureCookies }),
      cookie('deck_csrf', token(18), { httpOnly: false, maxAge: SESSION_DAYS * 86400, secure: cfg.secureCookies }),
    ]);
  };

  r.get('/me', (req, res) => {
    // Ensure every visitor has a CSRF cookie before their first POST.
    if (!parseCookies(req.headers.cookie).deck_csrf) res.setHeader('Set-Cookie', cookie('deck_csrf', token(18), { httpOnly: false, maxAge: SESSION_DAYS * 86400, secure: cfg.secureCookies }));
    const u = req.user;
    res.json(u ? { id: u.id, email: u.email, name: u.name, mfa: u.mfa } : null);
  });

  r.post('/register', async (req, res) => {
    const { email, password, name } = req.body ?? {};
    if (!emailOk(email)) return res.status(400).json({ error: 'Enter a valid email address' });
    const p = passwordProblem(password);
    if (p) return res.status(400).json({ error: p });
    const uid = id('u');
    const hash = await hashPassword(password);
    const ins = await db.query('insert into users (id, email, name, pw_hash) values ($1, lower($2), $3, $4) on conflict (email) do nothing returning id', [uid, email.trim(), String(name ?? '').trim().slice(0, 80), hash]);
    if (!ins.rowCount) return res.status(409).json({ error: 'An account with this email already exists' });
    await audit(db, 'user.register', { userId: uid, ip: clientIp(req) });
    await issueSession(res, req, uid);
    res.status(201).json({ id: uid, email: email.toLowerCase(), name: String(name ?? ''), mfa: false });
  });

  r.post('/login', async (req, res) => {
    const { email, password, totp: code } = req.body ?? {};
    if (!emailOk(email) || typeof password !== 'string') return res.status(400).json({ error: 'Email and password required' });
    const q = await db.query('select * from users where email = lower($1)', [email.trim()]);
    const u = q.rows[0];
    const ok = await verifyPassword(password, u?.pw_hash ?? DUMMY_HASH);
    if (u?.locked_until && new Date(u.locked_until) > new Date()) {
      await audit(db, 'auth.locked', { userId: u.id, ip: clientIp(req) });
      return res.status(429).json({ error: 'Too many failed attempts. Try again later or reset your password.' });
    }
    if (!u || !ok) {
      if (u) await db.query(`update users set failed_logins = failed_logins + 1, locked_until = case when failed_logins + 1 >= 10 then now() + interval '15 minutes' else locked_until end where id = $1`, [u.id]);
      await audit(db, 'auth.fail', { userId: u?.id ?? null, ip: clientIp(req) });
      return res.status(401).json({ error: 'Incorrect email or password' });
    }
    if (u.mfa_enabled) {
      if (!code) return res.json({ mfaRequired: true });
      if (!verifyTotp(u.mfa_secret, code)) {
        await db.query('update users set failed_logins = failed_logins + 1 where id = $1', [u.id]);
        await audit(db, 'auth.mfa_fail', { userId: u.id, ip: clientIp(req) });
        return res.status(401).json({ error: 'Invalid authentication code' });
      }
    }
    await db.query('update users set failed_logins = 0, locked_until = null where id = $1', [u.id]);
    await audit(db, 'auth.login', { userId: u.id, ip: clientIp(req) });
    await issueSession(res, req, u.id);
    res.json({ id: u.id, email: u.email, name: u.name, mfa: u.mfa_enabled });
  });

  r.post('/logout', async (req, res) => {
    if (req.user) await db.query('update sessions set revoked = true where id = $1', [req.user.sessionId]);
    res.setHeader('Set-Cookie', cookie('deck_sid', '', { httpOnly: true, maxAge: 0, secure: cfg.secureCookies }));
    res.json({ ok: true });
  });

  r.get('/sessions', requireUser, async (req, res) => {
    const q = await db.query('select id, created_at, last_seen, user_agent from sessions where user_id = $1 and not revoked and expires_at > now() order by last_seen desc', [req.user!.id]);
    res.json(q.rows.map((s) => ({ id: s.id.slice(0, 16), created_at: s.created_at, last_seen: s.last_seen, user_agent: s.user_agent, current: s.id === req.user!.sessionId })));
  });

  r.delete('/sessions/:sid', requireUser, async (req, res) => {
    const sid = String(req.params.sid);
    if (!/^[0-9a-f]{16}$/.test(sid)) return res.status(400).json({ error: 'Bad session id' });
    const q = await db.query("update sessions set revoked = true where user_id = $1 and left(id, 16) = $2 returning id", [req.user!.id, sid]);
    if (q.rowCount) onSessionsRevoked(req.user!.id);
    await audit(db, 'session.revoke', { userId: req.user!.id, ip: clientIp(req) });
    res.json({ revoked: q.rowCount });
  });

  r.post('/sessions/revoke-others', requireUser, async (req, res) => {
    await db.query('update sessions set revoked = true where user_id = $1 and id <> $2', [req.user!.id, req.user!.sessionId]);
    onSessionsRevoked(req.user!.id);
    await audit(db, 'session.revoke_others', { userId: req.user!.id, ip: clientIp(req) });
    res.json({ ok: true });
  });

  r.post('/mfa/setup', requireUser, async (req, res) => {
    if (req.user!.mfa) return res.status(400).json({ error: 'Two-factor authentication is already enabled' });
    const secret = base32(randomBytes(20));
    await db.query('update users set mfa_secret = $2 where id = $1 and not mfa_enabled', [req.user!.id, secret]);
    res.json({ secret, otpauth: `otpauth://totp/DECK:${encodeURIComponent(req.user!.email)}?secret=${secret}&issuer=DECK` });
  });

  r.post('/mfa/enable', requireUser, async (req, res) => {
    const q = await db.query('select mfa_secret from users where id = $1', [req.user!.id]);
    const secret = q.rows[0]?.mfa_secret;
    if (!secret || !verifyTotp(secret, req.body?.code)) return res.status(400).json({ error: 'That code is not valid — check your authenticator app' });
    await db.query('update users set mfa_enabled = true where id = $1', [req.user!.id]);
    await audit(db, 'mfa.enable', { userId: req.user!.id, ip: clientIp(req) });
    res.json({ ok: true });
  });

  r.post('/mfa/disable', requireUser, async (req, res) => {
    const q = await db.query('select mfa_secret from users where id = $1 and mfa_enabled', [req.user!.id]);
    const secret = q.rows[0]?.mfa_secret;
    if (!secret || !verifyTotp(secret, req.body?.code)) return res.status(400).json({ error: 'That code is not valid' });
    await db.query('update users set mfa_enabled = false, mfa_secret = null where id = $1', [req.user!.id]);
    await audit(db, 'mfa.disable', { userId: req.user!.id, ip: clientIp(req) });
    res.json({ ok: true });
  });

  // Always answers the same way so account existence is not revealed.
  r.post('/recover', async (req, res) => {
    const email = req.body?.email;
    if (emailOk(email)) {
      const q = await db.query('select id, email from users where email = lower($1)', [email.trim()]);
      const u = q.rows[0];
      if (u) {
        const t = token(32);
        await db.query("insert into password_resets (token_hash, user_id, expires_at) values ($1, $2, now() + interval '30 minutes')", [sha256(t), u.id]);
        await mailer.send(u.email, 'Reset your DECK password', `Use this link within 30 minutes to choose a new password:\n${cfg.publicUrl}/#/reset/${t}\n\nIf you did not ask for this, ignore this email.`);
        await audit(db, 'auth.recover', { userId: u.id, ip: clientIp(req) });
      }
    }
    res.json({ ok: true });
  });

  r.post('/reset', async (req, res) => {
    const { token: t, password } = req.body ?? {};
    const p = passwordProblem(password);
    if (p) return res.status(400).json({ error: p });
    if (typeof t !== 'string' || t.length > 100) return res.status(400).json({ error: 'Invalid link' });
    const q = await db.query('update password_resets set used = true where token_hash = $1 and not used and expires_at > now() returning user_id', [sha256(t)]);
    const uid = q.rows[0]?.user_id;
    if (!uid) return res.status(400).json({ error: 'This reset link is invalid or has expired' });
    await db.query('update users set pw_hash = $2, failed_logins = 0, locked_until = null where id = $1', [uid, await hashPassword(password)]);
    // A password reset signs the account out everywhere.
    await db.query('update sessions set revoked = true where user_id = $1', [uid]);
    onSessionsRevoked(uid);
    await audit(db, 'auth.reset', { userId: uid, ip: clientIp(req) });
    res.json({ ok: true });
  });

  return r;
}
