import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { DeckDoc, docFromPresentation, type Presentation } from '@deck/core';

/**
 * Local-first persistence.
 *  - Every document is a Y.Doc persisted to IndexedDB (autosave on every change,
 *    crash recovery and offline editing come for free: updates are durable as
 *    soon as they are written).
 *  - A small registry in localStorage lists documents for the home screen.
 *  - Cloud documents additionally sync over WebSocket (see collab.ts).
 */

export interface DocEntry {
  id: string;
  title: string;
  updated: number;
  slides: number;
  cloud?: { serverId: string; role: string };
}

const KEY = 'deck.registry.v1';

export function listDocs(): DocEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as DocEntry[];
    return Array.isArray(raw) ? raw.sort((a, b) => b.updated - a.updated) : [];
  } catch {
    return [];
  }
}

export function upsertDoc(e: DocEntry) {
  const all = listDocs().filter((d) => d.id !== e.id);
  all.push(e);
  localStorage.setItem(KEY, JSON.stringify(all));
}

export function removeDoc(id: string) {
  localStorage.setItem(KEY, JSON.stringify(listDocs().filter((d) => d.id !== id)));
  indexedDB.deleteDatabase(`deck:${id}`);
}

export interface OpenDoc {
  deck: DeckDoc;
  idb: IndexeddbPersistence;
  destroy: () => void;
}

/** Open (or create) a local document. Resolves once IndexedDB state is loaded. */
export async function openDoc(id: string, seed?: { pres: Presentation; assets: Record<string, Uint8Array> }): Promise<OpenDoc> {
  const ydoc = new Y.Doc({ gc: true });
  const idb = new IndexeddbPersistence(`deck:${id}`, ydoc);
  await idb.whenSynced;
  const deck = new DeckDoc(ydoc);
  if (!deck.initialized && seed) {
    const tmp = docFromPresentation({ ...seed.pres, id }, seed.assets);
    Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(tmp.doc), 'init');
    deck.undo.clear();
  }
  const touch = () => {
    const p = deck.presentation;
    upsertDoc({ ...(listDocs().find((d) => d.id === id) ?? {}), id, title: p.title, updated: Date.now(), slides: p.slides.length });
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unsub = deck.subscribe(() => {
    clearTimeout(timer);
    timer = setTimeout(touch, 500);
  });
  if (seed) touch();
  return {
    deck,
    idb,
    destroy: () => {
      unsub();
      clearTimeout(timer);
      void idb.destroy();
      ydoc.destroy();
    },
  };
}

export function newDocId(): string {
  const b = new Uint8Array(10);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/** Snapshot for local version history (stored in IndexedDB alongside the doc). */
export async function saveVersion(id: string, deck: DeckDoc, label: string) {
  const db = await versionsDb();
  const tx = db.transaction('v', 'readwrite');
  tx.objectStore('v').add({ doc: id, at: Date.now(), label, state: Y.encodeStateAsUpdate(deck.doc) });
  await new Promise((r) => (tx.oncomplete = r));
}

export interface Version {
  key: number;
  at: number;
  label: string;
}

export async function listVersions(id: string): Promise<Version[]> {
  const db = await versionsDb();
  const tx = db.transaction('v');
  const idx = tx.objectStore('v').index('doc');
  const out: Version[] = [];
  await new Promise<void>((res) => {
    const req = idx.openCursor(IDBKeyRange.only(id));
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return res();
      out.push({ key: c.primaryKey as number, at: c.value.at, label: c.value.label });
      c.continue();
    };
  });
  return out.sort((a, b) => b.at - a.at);
}

/** Restore a version by committing its content as a new, undoable change (history is never rewritten). */
export async function restoreVersion(key: number, deck: DeckDoc) {
  const db = await versionsDb();
  const rec = await new Promise<{ state: Uint8Array }>((res) => {
    const r = db.transaction('v').objectStore('v').get(key);
    r.onsuccess = () => res(r.result);
  });
  const tmp = new DeckDoc();
  Y.applyUpdate(tmp.doc, rec.state);
  for (const [id, bytes] of tmp.assetData.entries()) {
    const meta = tmp.presentation.assets[id];
    if (meta) deck.putAsset(meta, bytes);
  }
  deck.commit({ ...tmp.presentation, id: deck.presentation.id });
}

let dbp: Promise<IDBDatabase> | null = null;
function versionsDb(): Promise<IDBDatabase> {
  dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open('deck-versions', 1);
    r.onupgradeneeded = () => {
      const s = r.result.createObjectStore('v', { keyPath: 'key', autoIncrement: true });
      s.createIndex('doc', 'doc');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
