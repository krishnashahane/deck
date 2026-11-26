import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { DeckDoc, createPresentation, createSlide, createText, docFromPresentation, themeById } from '@deck/core';
import { createDeckServer, type DeckServer } from '../src/app';
import { loadConfig } from '../src/config';
import { totp } from '../src/security';

const DB = process.env.DECK_TEST_DATABASE_URL ?? 'postgres://deck@localhost:5439/deck_test';
let s: DeckServer;
let base = '';
const mails: { to: string; text: string }[] = [];

class Client {
  jar = new Map<string, string>();
  constructor(public origin = 'http://localhost:5173') {}
  cookieHeader() {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  async req(method: string, path: string, body?: unknown, opts: { csrf?: boolean; origin?: string } = {}) {
    const headers: Record<string, string> = { 'content-type': 'application/json', cookie: this.cookieHeader(), origin: opts.origin ?? this.origin };
    if (opts.csrf !== false && this.jar.get('deck_csrf')) headers['x-deck-csrf'] = decodeURIComponent(this.jar.get('deck_csrf')!);
    const r = await fetch(`${base}/api${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    for (const c of r.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const i = kv!.indexOf('=');
      const k = kv!.slice(0, i), v = kv!.slice(i + 1);
      if (/Max-Age=0/.test(c)) this.jar.delete(k);
      else this.jar.set(k, v);
    }
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null, headers: r.headers };
  }
  async signup(email: string, password = 'correct horse battery staple') {
    await this.req('GET', '/auth/me');
    return this.req('POST', '/auth/register', { email, password, name: email.split('@')[0] });
  }
}

function deckState(title = 'Test deck') {
  const theme = themeById('graphite');
  const d = docFromPresentation(createPresentation({ title, theme, slides: [createSlide({ elements: [createText(theme, { name: 'T', paragraphs: [{ runs: [{ text: 'hello' }] }] })] })] }));
  return Buffer.from(Y.encodeStateAsUpdate(d.doc)).toString('base64');
}

beforeAll(async () => {
  const cfg = { ...loadConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv), databaseUrl: DB, port: 0, limits: { authPerMinute: 1000, apiPerMinute: 5000 } };
  s = await createDeckServer(cfg, { mailer: { send: async (to, _s, text) => void mails.push({ to, text }) } });
  await s.db.query('truncate users, sessions, documents, members, links, comments, versions, audit_log, password_resets cascade');
  await new Promise<void>((r) => s.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(s.server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await s?.close();
});

describe('authentication', () => {
  it('registers, rejects weak passwords and duplicate emails', async () => {
    const c = new Client();
    expect((await c.signup('weak@example.com', 'short')).status).toBe(400);
    const r = await c.signup('alice@example.com');
    expect(r.status).toBe(201);
    expect(r.headers.getSetCookie().some((x) => x.startsWith('deck_sid=') && /HttpOnly/.test(x) && /SameSite=Lax/.test(x))).toBe(true);
    expect((await new Client().signup('ALICE@example.com')).status).toBe(409);
    const me = await c.req('GET', '/auth/me');
    expect(me.body.email).toBe('alice@example.com');
  });

  it('stores passwords hashed with scrypt, never in plain text', async () => {
    const q = await s.db.query("select pw_hash from users where email = 'alice@example.com'");
    expect(q.rows[0].pw_hash).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(q.rows[0].pw_hash).not.toContain('horse');
  });

  it('gives the same error for unknown email and wrong password, and locks after repeated failures', async () => {
    const c = new Client();
    await c.req('GET', '/auth/me');
    const a = await c.req('POST', '/auth/login', { email: 'nobody@example.com', password: 'x' });
    const b = await c.req('POST', '/auth/login', { email: 'alice@example.com', password: 'wrong password!!' });
    expect(a.status).toBe(401);
    expect(a.body.error).toBe(b.body.error);
    for (let i = 0; i < 10; i++) await c.req('POST', '/auth/login', { email: 'alice@example.com', password: 'wrong password!!' });
    const locked = await c.req('POST', '/auth/login', { email: 'alice@example.com', password: 'correct horse battery staple' });
    expect(locked.status).toBe(429);
    await s.db.query("update users set failed_logins = 0, locked_until = null where email = 'alice@example.com'");
  });

  it('enforces CSRF tokens and origin checks on state-changing requests', async () => {
    const c = new Client();
    await c.req('GET', '/auth/me');
    expect((await c.req('POST', '/auth/register', { email: 'x@example.com', password: 'correct horse battery staple' }, { csrf: false })).status).toBe(403);
    expect((await c.req('POST', '/auth/register', { email: 'x@example.com', password: 'correct horse battery staple' }, { origin: 'https://evil.example' })).status).toBe(403);
  });

  it('supports TOTP MFA end to end', async () => {
    const c = new Client();
    await c.signup('mfa@example.com');
    const setup = await c.req('POST', '/auth/mfa/setup', {});
    expect((await c.req('POST', '/auth/mfa/enable', { code: '000000' })).status).toBe(400);
    expect((await c.req('POST', '/auth/mfa/enable', { code: totp(setup.body.secret) })).status).toBe(200);
    const d = new Client();
    await d.req('GET', '/auth/me');
    const step1 = await d.req('POST', '/auth/login', { email: 'mfa@example.com', password: 'correct horse battery staple' });
    expect(step1.body).toEqual({ mfaRequired: true });
    expect(d.jar.has('deck_sid')).toBe(false);
    expect((await d.req('POST', '/auth/login', { email: 'mfa@example.com', password: 'correct horse battery staple', totp: '123456' })).status).toBe(401);
    expect((await d.req('POST', '/auth/login', { email: 'mfa@example.com', password: 'correct horse battery staple', totp: totp(setup.body.secret) })).status).toBe(200);
  });

  it('password recovery does not reveal accounts, and a reset revokes all sessions', async () => {
    const c = new Client();
    await c.signup('reset@example.com');
    const anon = new Client();
    await anon.req('GET', '/auth/me');
    const a = await anon.req('POST', '/auth/recover', { email: 'reset@example.com' });
    const b = await anon.req('POST', '/auth/recover', { email: 'ghost@example.com' });
    expect(a.body).toEqual(b.body);
    const mail = mails.find((m) => m.to === 'reset@example.com')!;
    const t = /#\/reset\/([A-Za-z0-9_-]+)/.exec(mail.text)![1]!;
    expect((await anon.req('POST', '/auth/reset', { token: t, password: 'a brand new long password' })).status).toBe(200);
    expect((await anon.req('POST', '/auth/reset', { token: t, password: 'a brand new long password' })).status).toBe(400); // single use
    expect((await c.req('GET', '/auth/me')).body).toBeNull(); // old session revoked
  });

  it('lists and revokes sessions', async () => {
    const a = new Client(), b = new Client();
    await a.signup('sess@example.com');
    await b.req('GET', '/auth/me');
    await b.req('POST', '/auth/login', { email: 'sess@example.com', password: 'correct horse battery staple' });
    const list = await a.req('GET', '/auth/sessions');
    expect(list.body).toHaveLength(2);
    await a.req('POST', '/auth/sessions/revoke-others', {});
    expect((await b.req('GET', '/auth/me')).body).toBeNull();
    expect((await a.req('GET', '/auth/me')).body.email).toBe('sess@example.com');
  });
});

describe('documents & authorisation', () => {
  const owner = new Client(), other = new Client(), editor = new Client(), viewer = new Client();
  let docId = '';
  beforeAll(async () => {
    await owner.signup('owner@example.com');
    await other.signup('other@example.com');
    await editor.signup('editor@example.com');
    await viewer.signup('viewer@example.com');
    const r = await owner.req('POST', '/docs', { title: 'Plan', state: deckState('Plan') });
    expect(r.status).toBe(201);
    docId = r.body.id;
  });

  it('rejects invalid document payloads', async () => {
    expect((await owner.req('POST', '/docs', { title: 'x', state: Buffer.from('garbage').toString('base64') })).status).toBe(400);
  });

  it('hides documents from non-members (IDOR) and requires sign-in', async () => {
    expect((await other.req('GET', `/docs/${docId}`)).status).toBe(404);
    expect((await other.req('GET', `/docs/${docId}/comments`)).status).toBe(404);
    expect((await other.req('DELETE', `/docs/${docId}`)).status).toBe(404);
    const anon = new Client();
    await anon.req('GET', '/auth/me');
    expect((await anon.req('GET', `/docs/${docId}`)).status).toBe(401);
    expect((await other.req('GET', '/docs')).body).toEqual([]);
  });

  it('owner invites members; roles are enforced server-side', async () => {
    expect((await owner.req('POST', `/docs/${docId}/members`, { email: 'editor@example.com', role: 'editor' })).status).toBe(201);
    expect((await owner.req('POST', `/docs/${docId}/members`, { email: 'viewer@example.com', role: 'viewer' })).status).toBe(201);
    expect((await owner.req('POST', `/docs/${docId}/members`, { email: 'x@example.com', role: 'owner' })).status).toBe(400);
    expect((await editor.req('GET', `/docs/${docId}`)).body.role).toBe('editor');
    // privilege escalation attempts
    expect((await editor.req('POST', `/docs/${docId}/members`, { email: 'other@example.com', role: 'editor' })).status).toBe(403);
    expect((await editor.req('GET', `/docs/${docId}/links`)).status).toBe(403);
    expect((await viewer.req('PATCH', `/docs/${docId}`, { title: 'hacked' })).status).toBe(403);
    expect((await viewer.req('POST', `/docs/${docId}/comments`, { slideId: 's', body: 'hi' })).status).toBe(403);
    expect((await editor.req('POST', `/docs/${docId}/comments`, { slideId: 's', body: 'looks good' })).status).toBe(201);
    expect((await viewer.req('GET', `/docs/${docId}/comments`)).body).toHaveLength(1);
    expect((await editor.req('DELETE', `/docs/${docId}`)).status).toBe(403);
  });

  it('share links: expiring, revocable, never downgrade, never grant owner', async () => {
    const l = await owner.req('POST', `/docs/${docId}/links`, { role: 'commenter', expiresInHours: 24 });
    expect(l.status).toBe(201);
    expect((await other.req('POST', `/share/${l.body.token}/accept`, {})).body.docId).toBe(docId);
    expect((await other.req('GET', `/docs/${docId}`)).body.role).toBe('commenter');
    // editor accepting a viewer link keeps editor
    const v = await owner.req('POST', `/docs/${docId}/links`, { role: 'viewer', expiresInHours: null });
    await editor.req('POST', `/share/${v.body.token}/accept`, {});
    expect((await editor.req('GET', `/docs/${docId}`)).body.role).toBe('editor');
    // revoke
    await owner.req('DELETE', `/docs/${docId}/links/${v.body.id}`);
    const late = new Client();
    await late.signup('late@example.com');
    expect((await late.req('POST', `/share/${v.body.token}/accept`, {})).status).toBe(404);
    // expired
    const e = await owner.req('POST', `/docs/${docId}/links`, { role: 'viewer', expiresInHours: 1 });
    await s.db.query("update links set expires_at = now() - interval '1 minute' where id = $1", [e.body.id]);
    expect((await late.req('POST', `/share/${e.body.token}/accept`, {})).status).toBe(404);
    // tokens are stored hashed
    const q = await s.db.query('select token_hash from links where id = $1', [l.body.id]);
    expect(q.rows[0].token_hash).not.toBe(l.body.token);
  });

  it('removing a member revokes access immediately', async () => {
    const u = await s.db.query("select id from users where email = 'other@example.com'");
    await owner.req('DELETE', `/docs/${docId}/members/${u.rows[0].id}`);
    expect((await other.req('GET', `/docs/${docId}`)).status).toBe(404);
  });

  it('real-time sync: editors merge, viewers cannot write, revoked users are disconnected', async () => {
    const connect = (c: Client) => {
      const doc = new Y.Doc();
      const p = new WebsocketProvider(base.replace('http', 'ws') + '/sync', docId, doc, { WebSocketPolyfill: class extends WebSocket { constructor(url: string) { super(url, { headers: { cookie: c.cookieHeader(), origin: 'http://localhost:5173' } }); } } as unknown as typeof globalThis.WebSocket, disableBc: true });
      return { doc, p, deck: new DeckDoc(doc) };
    };
    const synced = (p: WebsocketProvider) => new Promise<void>((r) => (p.synced ? r() : p.once('sync', () => r())));
    const A = connect(owner), B = connect(editor), V = connect(viewer);
    await Promise.all([synced(A.p), synced(B.p), synced(V.p)]);
    expect(A.deck.presentation.title).toBe('Plan');
    A.deck.commit({ ...A.deck.presentation, title: 'Edited by owner' });
    const pb = B.deck.presentation;
    B.deck.commit({ ...pb, slides: [...pb.slides, createSlide({ notes: 'from editor' })] });
    await new Promise((r) => setTimeout(r, 400));
    expect(B.deck.presentation.title).toBe('Edited by owner');
    expect(A.deck.presentation.slides).toHaveLength(2);
    // viewer edits stay local and never reach the server or others
    V.deck.commit({ ...V.deck.presentation, title: 'VIEWER WAS HERE' });
    await new Promise((r) => setTimeout(r, 400));
    expect(A.deck.presentation.title).toBe('Edited by owner');
    // persisted
    await new Promise((r) => setTimeout(r, 1800));
    const row = await s.db.query('select state, title from documents where id = $1', [docId]);
    const check = new DeckDoc();
    Y.applyUpdate(check.doc, new Uint8Array(row.rows[0].state));
    expect(check.presentation.slides).toHaveLength(2);
    expect(row.rows[0].title).toBe('Edited by owner');
    // revoke the editor → their socket is closed by the server
    const closed = new Promise<number>((r) => B.p.ws?.addEventListener('close', (ev) => r((ev as CloseEvent).code)));
    const eu = await s.db.query("select id from users where email = 'editor@example.com'");
    await owner.req('DELETE', `/docs/${docId}/members/${eu.rows[0].id}`);
    expect(await closed).toBe(4401);
    for (const x of [A, B, V]) x.p.destroy();
  });

  it('refuses WebSocket connections without a session, from foreign origins, or to foreign documents', async () => {
    const tryWs = (headers: Record<string, string>, id = docId) =>
      new Promise<string>((r) => {
        const ws = new WebSocket(`${base.replace('http', 'ws')}/sync/${id}`, { headers });
        ws.on('open', () => { r('open'); ws.close(); });
        ws.on('unexpected-response', (_q, res) => r(String(res.statusCode)));
        ws.on('error', () => r('error'));
      });
    expect(await tryWs({ origin: 'http://localhost:5173' })).toBe('401');
    expect(await tryWs({ origin: 'https://evil.example', cookie: owner.cookieHeader() })).toBe('403');
    expect(await tryWs({ origin: 'http://localhost:5173', cookie: other.cookieHeader() })).toBe('403');
    expect(await tryWs({ origin: 'http://localhost:5173', cookie: owner.cookieHeader() })).toBe('open');
  });

  it('versions: save and restore as a new change', async () => {
    const v = await owner.req('POST', `/docs/${docId}/versions`, { label: 'Before' });
    expect(v.status).toBe(201);
    const q = await s.db.query('select state from documents where id = $1', [docId]);
    const d = new DeckDoc();
    Y.applyUpdate(d.doc, new Uint8Array(q.rows[0].state));
    d.commit({ ...d.presentation, title: 'Changed later' });
    await s.db.query('update documents set state = $2 where id = $1', [docId, Buffer.from(Y.encodeStateAsUpdate(d.doc))]);
    expect((await owner.req('POST', `/docs/${docId}/versions/${v.body.id}/restore`, {})).status).toBe(200);
    const after = await s.db.query('select state from documents where id = $1', [docId]);
    const r = new DeckDoc();
    Y.applyUpdate(r.doc, new Uint8Array(after.rows[0].state));
    expect(r.presentation.title).toBe('Edited by owner');
  });

  it('AI endpoint requires consent and reports when no provider is configured', async () => {
    expect((await owner.req('POST', '/ai', { task: 'notes', source: 'x' })).status).toBe(400);
    expect((await owner.req('POST', '/ai', { task: 'evil', source: 'x', consent: true })).status).toBe(400);
    const r = await owner.req('POST', '/ai', { task: 'notes', source: 'x', consent: true });
    expect([503, 200, 502]).toContain(r.status);
  });

  it('writes an audit trail and sets security headers', async () => {
    const q = await s.db.query("select action from audit_log where doc_id = $1", [docId]);
    expect(q.rows.map((r) => r.action)).toEqual(expect.arrayContaining(['doc.create', 'member.add', 'link.create', 'link.revoke', 'member.remove', 'version.restore']));
    const r = await fetch(`${base}/api/health`);
    expect(r.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('x-powered-by')).toBeNull();
  });

  it('activity log: owner-only, names actors and targets, never exposes collaborator IPs', async () => {
    const r = await owner.req('GET', `/docs/${docId}/activity`);
    expect(r.status).toBe(200);
    const actions = r.body.map((a: { action: string }) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['doc.create', 'member.add', 'link.create']));
    const invite = r.body.find((a: { action: string; target: { email: string } | null }) => a.action === 'member.add' && a.target?.email === 'editor@example.com');
    expect(invite).toMatchObject({ actor: { email: 'owner@example.com' }, role: 'editor' });
    expect(JSON.stringify(r.body)).not.toMatch(/"ip"|127\.0\.0\.1|::1/);
    // newest first, cursor paging
    const times = r.body.map((a: { at: string }) => Date.parse(a.at));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect((await owner.req('GET', `/docs/${docId}/activity?before=${encodeURIComponent(r.body[0].at)}`)).body.length).toBe(r.body.length - 1);
    expect((await owner.req('GET', `/docs/${docId}/activity?before=not-a-date`)).status).toBe(400);
    // other roles and strangers
    expect((await viewer.req('GET', `/docs/${docId}/activity`)).status).toBe(403);
    expect((await other.req('GET', `/docs/${docId}/activity`)).status).toBe(404);
  });

  it('users see only their own security activity', async () => {
    const mine = await owner.req('GET', '/auth/activity');
    expect(mine.status).toBe(200);
    expect(mine.body.map((a: { action: string }) => a.action)).toContain('user.register');
    expect(mine.body.every((a: { action: string }) => /^(auth|mfa|session)\.|^user\.register$/.test(a.action))).toBe(true);
    const anon = new Client();
    await anon.req('GET', '/auth/me');
    expect((await anon.req('GET', '/auth/activity')).status).toBe(401);
    const q = await s.db.query("select count(*)::int as n from audit_log a join users u on u.id = a.user_id where u.email = 'other@example.com' and a.action = 'user.register'");
    expect(q.rows[0].n).toBe(1);
    expect(JSON.stringify(mine.body)).not.toContain('other@example.com');
  });

  it('never exposes stack traces for malformed input', async () => {
    const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: owner.cookieHeader(), 'x-deck-csrf': decodeURIComponent(owner.jar.get('deck_csrf')!) }, body: '{bad json' });
    expect(r.status).toBe(400);
    expect(await r.text()).not.toMatch(/at .*\.ts/);
  });
});

describe('rate limiting', () => {
  it('returns 429 with Retry-After once the auth budget is exhausted', async () => {
    const cfg = { ...loadConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv), databaseUrl: DB, limits: { authPerMinute: 5, apiPerMinute: 5000 } };
    const t = await createDeckServer(cfg, { mailer: { send: async () => undefined } });
    await new Promise<void>((r) => t.server.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(t.server.address() as AddressInfo).port}/api/auth/me`;
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await fetch(url)).status);
    const last = await fetch(url);
    expect(codes.slice(0, 5).every((c) => c === 200)).toBe(true);
    expect(last.status).toBe(429);
    expect(Number(last.headers.get('retry-after'))).toBeGreaterThan(0);
    await t.close();
  });
});
