import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import type { Db } from './db';
import { audit } from './db';
import { sessionUser } from './auth';
import type { Config } from './config';
import { roleFor, type Role } from './docs';

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;

interface Conn {
  ws: WebSocket;
  userId: string;
  sessionId: string;
  role: Role;
  awarenessIds: Set<number>;
}

interface Room {
  id: string;
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  conns: Set<Conn>;
  dirty: boolean;
  timer: NodeJS.Timeout | null;
  loaded: Promise<void>;
}

/**
 * Real-time collaboration server speaking the y-protocols sync + awareness
 * wire format. Every connection is authenticated with the session cookie and
 * authorised per document; viewer/commenter connections may read and share
 * presence but any document update they send is dropped.
 */
export class SyncServer {
  private rooms = new Map<string, Room>();
  private wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024 });

  constructor(private db: Db, private cfg: Config) {}

  async handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    const reject = (code: number, msg: string) => {
      socket.write(`HTTP/1.1 ${code} ${msg}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    };
    try {
      const url = new URL(req.url ?? '/', 'http://x');
      const m = /^\/sync\/([A-Za-z0-9_-]{4,64})$/.exec(url.pathname);
      if (!m) return reject(404, 'Not Found');
      const origin = req.headers.origin;
      if (origin && !this.cfg.allowedOrigins.has(origin)) return reject(403, 'Forbidden');
      const user = await sessionUser(this.db, req.headers.cookie);
      if (!user) return reject(401, 'Unauthorized');
      const docId = m[1]!;
      const role = await roleFor(this.db, docId, user.id);
      if (!role) return reject(403, 'Forbidden');
      this.wss.handleUpgrade(req, socket, head, (ws) => void this.attach(ws, docId, { userId: user.id, sessionId: user.sessionId, role }));
    } catch (e) {
      console.error('[sync] upgrade failed', (e as Error).message);
      reject(500, 'Internal Server Error');
    }
  }

  private room(id: string): Room {
    let r = this.rooms.get(id);
    if (r) return r;
    const doc = new Y.Doc({ gc: true });
    const awareness = new awarenessProtocol.Awareness(doc);
    awareness.setLocalState(null);
    r = { id, doc, awareness, conns: new Set(), dirty: false, timer: null, loaded: Promise.resolve() };
    const room = r;
    room.loaded = (async () => {
      const q = await this.db.query('select state from documents where id = $1', [id]);
      if (q.rows[0]) Y.applyUpdate(doc, new Uint8Array(q.rows[0].state), 'load');
    })();
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === 'load') return;
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_SYNC);
      syncProtocol.writeUpdate(enc, update);
      const msg = encoding.toUint8Array(enc);
      for (const c of room.conns) if (c !== origin) send(c, msg);
      room.dirty = true;
      this.schedulePersist(room);
    });
    awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      const changed = added.concat(updated, removed);
      if (origin && typeof origin === 'object' && 'awarenessIds' in origin) {
        const c = origin as Conn;
        added.forEach((x) => c.awarenessIds.add(x));
        removed.forEach((x) => c.awarenessIds.delete(x));
      }
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_AWARENESS);
      encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(awareness, changed));
      const msg = encoding.toUint8Array(enc);
      for (const c of room.conns) send(c, msg);
    });
    this.rooms.set(id, room);
    return room;
  }

  private schedulePersist(room: Room) {
    if (room.timer) return;
    room.timer = setTimeout(() => {
      room.timer = null;
      void this.persist(room);
    }, 1500);
  }

  async persist(room: Room) {
    if (!room.dirty) return;
    room.dirty = false;
    const state = Y.encodeStateAsUpdate(room.doc);
    if (state.length > this.cfg.maxDocBytes) {
      console.error(`[sync] document ${room.id} exceeds size limit; not persisted`);
      return;
    }
    const title = String(room.doc.getMap('meta').get('title') ?? '').slice(0, 200) || null;
    await this.db.query('update documents set state = $2, updated_at = now(), title = coalesce($3, title) where id = $1', [room.id, Buffer.from(state), title]);
  }

  private async attach(ws: WebSocket, docId: string, who: { userId: string; sessionId: string; role: Role }) {
    const room = this.room(docId);
    const conn: Conn = { ws, ...who, awarenessIds: new Set() };
    room.conns.add(conn);
    ws.binaryType = 'arraybuffer';
    const queued: Uint8Array[] = [];
    let ready = false;
    ws.on('message', (data: ArrayBuffer) => {
      const msg = new Uint8Array(data);
      if (!ready) queued.push(msg);
      else this.onMessage(room, conn, msg);
    });
    ws.on('close', () => this.detach(room, conn));
    ws.on('error', () => this.detach(room, conn));
    // Heartbeat: drop dead connections.
    let alive = true;
    ws.on('pong', () => (alive = true));
    const hb = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
    }, 30000);
    ws.on('close', () => clearInterval(hb));

    await room.loaded;
    ready = true;
    // Send sync step 1 and current awareness.
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_SYNC);
    syncProtocol.writeSyncStep1(enc, room.doc);
    send(conn, encoding.toUint8Array(enc));
    const states = room.awareness.getStates();
    if (states.size) {
      const a = encoding.createEncoder();
      encoding.writeVarUint(a, MSG_AWARENESS);
      encoding.writeVarUint8Array(a, awarenessProtocol.encodeAwarenessUpdate(room.awareness, Array.from(states.keys())));
      send(conn, encoding.toUint8Array(a));
    }
    for (const m of queued.splice(0)) this.onMessage(room, conn, m);
  }

  private onMessage(room: Room, conn: Conn, msg: Uint8Array) {
    try {
      const dec = decoding.createDecoder(msg);
      const type = decoding.readVarUint(dec);
      if (type === MSG_SYNC) {
        const sub = decoding.readVarUint(dec);
        if (sub === syncProtocol.messageYjsSyncStep1) {
          const enc = encoding.createEncoder();
          encoding.writeVarUint(enc, MSG_SYNC);
          syncProtocol.readSyncStep1(dec, enc, room.doc);
          send(conn, encoding.toUint8Array(enc));
        } else if (sub === syncProtocol.messageYjsSyncStep2 || sub === syncProtocol.messageYjsUpdate) {
          if (conn.role === 'viewer' || conn.role === 'commenter') return; // read-only: never apply
          const update = decoding.readVarUint8Array(dec);
          Y.applyUpdate(room.doc, update, conn);
        }
      } else if (type === MSG_AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(room.awareness, decoding.readVarUint8Array(dec), conn);
      }
    } catch (e) {
      console.error('[sync] bad message', (e as Error).message);
      conn.ws.close(1003, 'Malformed message');
    }
  }

  private detach(room: Room, conn: Conn) {
    if (!room.conns.delete(conn)) return;
    awarenessProtocol.removeAwarenessStates(room.awareness, Array.from(conn.awarenessIds), null);
    if (!room.conns.size) {
      void this.persist(room).finally(() => {
        if (!room.conns.size) {
          if (room.timer) clearTimeout(room.timer);
          room.doc.destroy();
          this.rooms.delete(room.id);
        }
      });
    }
  }

  /** Re-authorise a user's live connections (after revocation, role change or session sign-out). */
  async recheckUser(userId: string, docId?: string) {
    for (const room of this.rooms.values()) {
      if (docId && room.id !== docId) continue;
      for (const c of [...room.conns]) {
        if (c.userId !== userId) continue;
        const s = await this.db.query('select 1 from sessions where id = $1 and not revoked and expires_at > now()', [c.sessionId]);
        const role = s.rowCount ? await roleFor(this.db, room.id, userId) : null;
        if (!role) {
          c.ws.close(4401, 'Access revoked');
          await audit(this.db, 'sync.kick', { userId, docId: room.id });
        } else c.role = role;
      }
    }
  }

  /** Replace a document's content (version restore) for everyone connected. */
  async replaceState(docId: string, apply: (doc: Y.Doc) => void) {
    const room = this.rooms.get(docId);
    if (room) {
      await room.loaded;
      apply(room.doc);
      await this.persist(room);
    }
    return Boolean(room);
  }

  /** Current state of a document, from memory if it is open. */
  async stateOf(docId: string): Promise<Uint8Array | null> {
    const room = this.rooms.get(docId);
    if (room) {
      await room.loaded;
      return Y.encodeStateAsUpdate(room.doc);
    }
    const q = await this.db.query('select state from documents where id = $1', [docId]);
    return q.rows[0] ? new Uint8Array(q.rows[0].state) : null;
  }

  async close() {
    for (const room of this.rooms.values()) {
      for (const c of room.conns) c.ws.terminate();
      room.dirty = true;
      await this.persist(room);
      if (room.timer) clearTimeout(room.timer);
    }
    this.rooms.clear();
    this.wss.close();
  }
}

function send(c: Conn, msg: Uint8Array) {
  if (c.ws.readyState === c.ws.OPEN) c.ws.send(msg, (e) => e && c.ws.terminate());
}
