import { Router, type Request, type Response } from 'express';
import * as Y from 'yjs';
import { DeckDoc, cleanLabel } from '@deck/core';
import type { Db } from './db';
import { audit } from './db';
import { requireUser } from './auth';
import { clientIp, id, sha256, token } from './security';
import type { SyncServer } from './sync';
import type { Config } from './config';

export type Role = 'owner' | 'editor' | 'commenter' | 'viewer';
const RANK: Record<Role, number> = { viewer: 1, commenter: 2, editor: 3, owner: 4 };
const isRole = (r: unknown): r is Exclude<Role, 'owner'> => r === 'editor' || r === 'commenter' || r === 'viewer';
const DOC_ID = /^d_[A-Za-z0-9_-]{8,40}$/;

export async function roleFor(db: Db, docId: string, userId: string): Promise<Role | null> {
  if (!DOC_ID.test(docId)) return null;
  const q = await db.query('select role from members where doc_id = $1 and user_id = $2', [docId, userId]);
  return (q.rows[0]?.role as Role) ?? null;
}

/**
 * Authorisation guard. Every document route resolves the caller's role on the
 * server and answers 404 (not 403) when the caller has no access, so document
 * ids cannot be probed (IDOR).
 */
function need(db: Db, min: Role) {
  return async (req: Request, res: Response, next: () => void) => {
    const role = await roleFor(db, String(req.params.id), req.user!.id);
    if (!role) return res.status(404).json({ error: 'Presentation not found' });
    if (RANK[role] < RANK[min]) return res.status(403).json({ error: `Requires ${min} access` });
    res.locals.role = role;
    next();
  };
}

function validState(b64: unknown, max: number): Uint8Array | null {
  if (typeof b64 !== 'string' || b64.length > (max * 4) / 3 + 16) return null;
  try {
    const bytes = new Uint8Array(Buffer.from(b64, 'base64'));
    const d = new DeckDoc();
    Y.applyUpdate(d.doc, bytes);
    if (!d.initialized) return null;
    return Y.encodeStateAsUpdate(d.doc);
  } catch {
    return null;
  }
}

export function docRoutes(db: Db, cfg: Config, sync: SyncServer): Router {
  const r = Router();
  r.use(requireUser);

  r.get('/', async (req, res) => {
    const q = await db.query(
      `select d.id, d.title, m.role, d.updated_at, u.name as owner_name from documents d
       join members m on m.doc_id = d.id and m.user_id = $1 join users u on u.id = d.owner_id
       order by d.updated_at desc limit 500`,
      [req.user!.id],
    );
    res.json(q.rows);
  });

  r.post('/', async (req, res) => {
    const state = validState(req.body?.state, cfg.maxDocBytes);
    if (!state) return res.status(400).json({ error: 'Invalid or oversized document' });
    const did = id('d');
    const title = cleanLabel(String(req.body?.title ?? 'Untitled'), 200) || 'Untitled';
    await db.query('insert into documents (id, owner_id, title, state) values ($1,$2,$3,$4)', [did, req.user!.id, title, Buffer.from(state)]);
    await db.query("insert into members (doc_id, user_id, role) values ($1,$2,'owner')", [did, req.user!.id]);
    await audit(db, 'doc.create', { userId: req.user!.id, docId: did, ip: clientIp(req) });
    res.status(201).json({ id: did });
  });

  r.get('/:id', need(db, 'viewer'), async (req, res) => {
    const q = await db.query('select id, title, created_at, updated_at from documents where id = $1', [req.params.id]);
    res.json({ ...q.rows[0], role: res.locals.role });
  });

  r.patch('/:id', need(db, 'editor'), async (req, res) => {
    const title = cleanLabel(String(req.body?.title ?? ''), 200);
    if (!title) return res.status(400).json({ error: 'Title required' });
    await db.query('update documents set title = $2, updated_at = now() where id = $1', [req.params.id, title]);
    res.json({ ok: true });
  });

  r.delete('/:id', need(db, 'owner'), async (req, res) => {
    const members = await db.query('select user_id from members where doc_id = $1', [req.params.id]);
    await db.query('delete from documents where id = $1', [req.params.id]);
    for (const m of members.rows) await sync.recheckUser(m.user_id, String(req.params.id));
    await audit(db, 'doc.delete', { userId: req.user!.id, docId: String(req.params.id), ip: clientIp(req) });
    res.json({ ok: true });
  });

  /* members */
  r.get('/:id/members', need(db, 'owner'), async (req, res) => {
    const q = await db.query('select m.user_id, u.email, u.name, m.role from members m join users u on u.id = m.user_id where m.doc_id = $1 order by m.role, u.email', [req.params.id]);
    res.json(q.rows);
  });

  r.post('/:id/members', need(db, 'owner'), async (req, res) => {
    const { email, role } = req.body ?? {};
    if (!isRole(role) || typeof email !== 'string') return res.status(400).json({ error: 'Email and role required' });
    const u = await db.query('select id from users where email = lower($1)', [email.trim()]);
    // Do not reveal whether an email is registered beyond what's needed to invite.
    if (!u.rows[0]) return res.status(404).json({ error: 'No DECK account uses that email. Ask them to sign up, or share a link instead.' });
    if (u.rows[0].id === req.user!.id) return res.status(400).json({ error: 'You already own this presentation' });
    await db.query("insert into members (doc_id, user_id, role) values ($1,$2,$3) on conflict (doc_id, user_id) do update set role = excluded.role where members.role <> 'owner'", [req.params.id, u.rows[0].id, role]);
    await sync.recheckUser(u.rows[0].id, String(req.params.id));
    await audit(db, 'member.add', { userId: req.user!.id, docId: String(req.params.id), detail: { target: u.rows[0].id, role }, ip: clientIp(req) });
    res.status(201).json({ ok: true });
  });

  r.patch('/:id/members/:uid', need(db, 'owner'), async (req, res) => {
    if (!isRole(req.body?.role)) return res.status(400).json({ error: 'Invalid role' });
    const q = await db.query("update members set role = $3 where doc_id = $1 and user_id = $2 and role <> 'owner'", [req.params.id, req.params.uid, req.body.role]);
    await sync.recheckUser(String(req.params.uid), String(req.params.id));
    await audit(db, 'member.role', { userId: req.user!.id, docId: String(req.params.id), detail: { target: req.params.uid, role: req.body.role }, ip: clientIp(req) });
    res.json({ updated: q.rowCount });
  });

  r.delete('/:id/members/:uid', need(db, 'owner'), async (req, res) => {
    const q = await db.query("delete from members where doc_id = $1 and user_id = $2 and role <> 'owner'", [req.params.id, req.params.uid]);
    await sync.recheckUser(String(req.params.uid), String(req.params.id));
    await audit(db, 'member.remove', { userId: req.user!.id, docId: String(req.params.id), detail: { target: req.params.uid }, ip: clientIp(req) });
    res.json({ removed: q.rowCount });
  });

  /* share links: the raw token is shown once; only its hash is stored */
  r.get('/:id/links', need(db, 'owner'), async (req, res) => {
    const q = await db.query('select id, role, expires_at, revoked, created_at from links where doc_id = $1 order by created_at desc', [req.params.id]);
    res.json(q.rows);
  });

  r.post('/:id/links', need(db, 'owner'), async (req, res) => {
    const { role, expiresInHours } = req.body ?? {};
    if (!isRole(role)) return res.status(400).json({ error: 'Invalid role' });
    const hours = expiresInHours === null || expiresInHours === undefined ? null : Number(expiresInHours);
    if (hours !== null && (!Number.isFinite(hours) || hours <= 0 || hours > 24 * 365)) return res.status(400).json({ error: 'Invalid expiry' });
    const t = token(24);
    const lid = id('l');
    await db.query(`insert into links (id, doc_id, token_hash, role, expires_at, created_by) values ($1,$2,$3,$4, case when $5::float8 is null then null else now() + make_interval(hours => $5::float8::int) end, $6)`, [lid, req.params.id, sha256(t), role, hours, req.user!.id]);
    await audit(db, 'link.create', { userId: req.user!.id, docId: String(req.params.id), detail: { role, hours }, ip: clientIp(req) });
    res.status(201).json({ id: lid, token: t });
  });

  r.delete('/:id/links/:lid', need(db, 'owner'), async (req, res) => {
    const q = await db.query('update links set revoked = true where id = $2 and doc_id = $1', [req.params.id, req.params.lid]);
    await audit(db, 'link.revoke', { userId: req.user!.id, docId: String(req.params.id), ip: clientIp(req) });
    res.json({ revoked: q.rowCount });
  });

  /* comments */
  r.get('/:id/comments', need(db, 'viewer'), async (req, res) => {
    const q = await db.query('select c.id, c.slide_id, c.element_id, c.parent_id, c.body, c.resolved, c.created_at, c.author_id, u.name as author_name from comments c join users u on u.id = c.author_id where c.doc_id = $1 order by c.created_at limit 2000', [req.params.id]);
    res.json(q.rows.map((c) => ({ ...c, author_name: c.author_name || 'Someone' })));
  });

  r.post('/:id/comments', need(db, 'commenter'), async (req, res) => {
    const { slideId, elementId, parentId, body } = req.body ?? {};
    if (typeof slideId !== 'string' || slideId.length > 80 || typeof body !== 'string' || !body.trim() || body.length > 5000) return res.status(400).json({ error: 'Invalid comment' });
    if (parentId) {
      const p = await db.query('select 1 from comments where id = $1 and doc_id = $2', [parentId, req.params.id]);
      if (!p.rowCount) return res.status(400).json({ error: 'Invalid parent' });
    }
    const cid = id('c');
    await db.query('insert into comments (id, doc_id, slide_id, element_id, parent_id, author_id, body) values ($1,$2,$3,$4,$5,$6,$7)', [cid, req.params.id, slideId, typeof elementId === 'string' ? elementId.slice(0, 80) : null, parentId ?? null, req.user!.id, body.trim()]);
    res.status(201).json({ id: cid });
  });

  r.patch('/:id/comments/:cid', need(db, 'commenter'), async (req, res) => {
    const q = await db.query('update comments set resolved = $3 where id = $2 and doc_id = $1', [req.params.id, req.params.cid, Boolean(req.body?.resolved)]);
    res.json({ updated: q.rowCount });
  });

  r.delete('/:id/comments/:cid', need(db, 'commenter'), async (req, res) => {
    // Authors may delete their own comments; owners may delete any.
    const q = await db.query('delete from comments where id = $2 and doc_id = $1 and (author_id = $3 or $4)', [req.params.id, req.params.cid, req.user!.id, res.locals.role === 'owner']);
    res.json({ deleted: q.rowCount });
  });

  /* versions */
  r.get('/:id/versions', need(db, 'viewer'), async (req, res) => {
    const q = await db.query('select id, label, created_at from versions where doc_id = $1 order by created_at desc limit 200', [req.params.id]);
    res.json(q.rows);
  });

  r.post('/:id/versions', need(db, 'editor'), async (req, res) => {
    const state = await sync.stateOf(String(req.params.id));
    if (!state) return res.status(404).json({ error: 'Presentation not found' });
    const label = cleanLabel(String(req.body?.label ?? ''), 120) || new Date().toISOString();
    const q = await db.query('insert into versions (doc_id, label, state, created_by) values ($1,$2,$3,$4) returning id', [req.params.id, label, Buffer.from(state), req.user!.id]);
    res.status(201).json({ id: q.rows[0].id });
  });

  r.post('/:id/versions/:vid/restore', need(db, 'editor'), async (req, res) => {
    const q = await db.query('select state from versions where id = $2 and doc_id = $1', [req.params.id, Number(req.params.vid)]);
    if (!q.rows[0]) return res.status(404).json({ error: 'Version not found' });
    const old = new DeckDoc();
    Y.applyUpdate(old.doc, new Uint8Array(q.rows[0].state));
    // Restore = commit the old content as a new change (history is never rewritten; collaborators receive it live).
    const apply = (doc: Y.Doc) => {
      const live = new DeckDoc(doc);
      for (const [aid, bytes] of old.assetData.entries()) {
        const meta = old.presentation.assets[aid];
        if (meta) live.putAsset(meta, bytes);
      }
      live.commit({ ...old.presentation, id: live.presentation.id }, 'restore');
    };
    const live = await sync.replaceState(String(req.params.id), apply);
    if (!live) {
      const cur = await sync.stateOf(String(req.params.id));
      const doc = new Y.Doc();
      if (cur) Y.applyUpdate(doc, cur);
      apply(doc);
      await db.query('update documents set state = $2, updated_at = now() where id = $1', [req.params.id, Buffer.from(Y.encodeStateAsUpdate(doc))]);
    }
    await audit(db, 'version.restore', { userId: req.user!.id, docId: String(req.params.id), detail: { version: req.params.vid }, ip: clientIp(req) });
    res.json({ ok: true });
  });

  return r;
}

export function shareRoutes(db: Db, sync: SyncServer): Router {
  const r = Router();
  r.post('/:token/accept', requireUser, async (req, res) => {
    const t = String(req.params.token);
    if (t.length > 100) return res.status(404).json({ error: 'Link not found' });
    const q = await db.query('select doc_id, role from links where token_hash = $1 and not revoked and (expires_at is null or expires_at > now())', [sha256(t)]);
    const link = q.rows[0];
    if (!link) return res.status(404).json({ error: 'Link not found, expired or revoked' });
    // Never downgrade an existing higher role; never grant owner via link.
    await db.query(
      `insert into members (doc_id, user_id, role) values ($1,$2,$3)
       on conflict (doc_id, user_id) do update set role = excluded.role
       where members.role <> 'owner' and (case members.role when 'viewer' then 1 when 'commenter' then 2 when 'editor' then 3 else 4 end) < (case excluded.role when 'viewer' then 1 when 'commenter' then 2 when 'editor' then 3 else 4 end)`,
      [link.doc_id, req.user!.id, link.role],
    );
    await sync.recheckUser(req.user!.id, link.doc_id);
    await audit(db, 'link.accept', { userId: req.user!.id, docId: link.doc_id, ip: clientIp(req) });
    res.json({ docId: link.doc_id });
  });
  return r;
}
