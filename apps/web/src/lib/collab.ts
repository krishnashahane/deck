import { WebsocketProvider } from 'y-websocket';
import type * as Y from 'yjs';
import type { User } from './api';

const COLORS = ['#E8B04A', '#6FA8FF', '#7DD3A8', '#F07A6A', '#C4A1FF', '#5EEAD4', '#FDBA74', '#F9A8D4'];

/**
 * Real-time sync for a cloud document over an authenticated WebSocket
 * (session cookie + server-side role check). Yjs CRDT updates merge
 * concurrent edits; awareness carries presence (name, colour, cursor).
 */
export function connect(serverId: string, ydoc: Y.Doc, user: User): WebsocketProvider {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const provider = new WebsocketProvider(`${proto}://${location.host}/sync`, serverId, ydoc, { connect: true, maxBackoffTime: 10000 });
  const color = COLORS[Math.abs(hash(user.id)) % COLORS.length]!;
  provider.awareness.setLocalStateField('user', { name: user.name || user.email, color, id: user.id });
  return provider;
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
