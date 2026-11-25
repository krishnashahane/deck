import * as Y from 'yjs';
import type { AssetMeta, Presentation, Slide, SlideElement } from './model';
import { createPresentation } from './factory';

/**
 * Yjs binding — the Y.Doc is the single source of truth for a presentation.
 *
 * Schema
 *   meta        Y.Map   id,title,width,height,theme,importReport
 *   order       Y.Array<string>  slide ids in display order
 *   slides      Y.Map<slideId, Y.Map>
 *                 layout,background,notes,hidden,section,transition,animations : JSON values
 *                 elOrder : Y.Array<string>   z-order (back → front)
 *                 els     : Y.Map<elementId, Y.Map<field, JSON>>
 *   assetMeta   Y.Map<assetId, AssetMeta>
 *   assetData   Y.Map<assetId, Uint8Array>
 *
 * Merge semantics: concurrent edits to *different* fields or objects merge;
 * concurrent edits to the same field of the same object resolve last-writer-wins
 * (Yjs map semantics). Concurrent reorders may produce duplicate ids, which the
 * reader de-duplicates deterministically.
 */

const SLIDE_FIELDS = ['layout', 'background', 'notes', 'hidden', 'section', 'transition', 'animations'] as const;
const META_FIELDS = ['id', 'title', 'width', 'height', 'theme', 'importReport'] as const;

export const LOCAL_ORIGIN = Symbol('deck-local');

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Yjs rejects `undefined`; strip it (and clone) so values are plain JSON. */
function json<T>(v: T): T {
  return v === undefined ? (null as T) : (JSON.parse(JSON.stringify(v)) as T);
}

function syncOrder(arr: Y.Array<string>, next: string[]) {
  const cur = arr.toArray();
  if (cur.length === next.length && cur.every((v, i) => v === next[i])) return;
  // Trim common prefix/suffix so small edits produce small updates.
  let s = 0;
  while (s < cur.length && s < next.length && cur[s] === next[s]) s++;
  let e = 0;
  while (e < cur.length - s && e < next.length - s && cur[cur.length - 1 - e] === next[next.length - 1 - e]) e++;
  const delCount = cur.length - s - e;
  if (delCount > 0) arr.delete(s, delCount);
  const ins = next.slice(s, next.length - e);
  if (ins.length) arr.insert(s, ins);
}

function writeElement(map: Y.Map<unknown>, el: SlideElement, prev?: SlideElement) {
  const rec = el as unknown as Record<string, unknown>;
  const prevRec = prev as unknown as Record<string, unknown> | undefined;
  for (const k of Object.keys(rec)) {
    if (rec[k] === undefined) continue;
    if (!prevRec || !same(rec[k], prevRec[k]) || !map.has(k)) map.set(k, json(rec[k]));
  }
  for (const k of Array.from(map.keys())) if (rec[k] === undefined) map.delete(k);
}

function writeSlide(map: Y.Map<unknown>, slide: Slide, prev?: Slide) {
  const rec = slide as unknown as Record<string, unknown>;
  const prevRec = prev as unknown as Record<string, unknown> | undefined;
  for (const k of SLIDE_FIELDS) {
    const v = rec[k];
    if (v === undefined) {
      if (map.has(k)) map.delete(k);
    } else if (!prevRec || !same(v, prevRec[k]) || !map.has(k)) map.set(k, json(v));
  }
  let elOrder = map.get('elOrder') as Y.Array<string> | undefined;
  let els = map.get('els') as Y.Map<Y.Map<unknown>> | undefined;
  if (!elOrder) map.set('elOrder', (elOrder = new Y.Array<string>()));
  if (!els) map.set('els', (els = new Y.Map<Y.Map<unknown>>()));
  const prevEls = new Map((prev?.elements ?? []).map((e) => [e.id, e]));
  const ids = new Set<string>();
  for (const el of slide.elements) {
    ids.add(el.id);
    const p = prevEls.get(el.id);
    if (p === el && els.has(el.id)) continue;
    let m = els.get(el.id);
    if (!m) {
      m = new Y.Map<unknown>();
      els.set(el.id, m);
      writeElement(m, el);
    } else writeElement(m, el, p);
  }
  for (const id of Array.from(els.keys())) if (!ids.has(id)) els.delete(id);
  syncOrder(elOrder, slide.elements.map((e) => e.id));
}

function readSlide(id: string, map: Y.Map<unknown>): Slide {
  const els = map.get('els') as Y.Map<Y.Map<unknown>> | undefined;
  const order = (map.get('elOrder') as Y.Array<string> | undefined)?.toArray() ?? [];
  const seen = new Set<string>();
  const elements: SlideElement[] = [];
  const push = (eid: string) => {
    if (seen.has(eid)) return;
    const m = els?.get(eid);
    if (!m) return;
    seen.add(eid);
    elements.push(m.toJSON() as SlideElement);
  };
  for (const eid of order) push(eid);
  // Elements present but missing from the order (concurrent insert races) go on top.
  if (els) for (const eid of Array.from(els.keys()).sort()) push(eid);
  return {
    id,
    layout: (map.get('layout') as Slide['layout']) ?? 'blank',
    background: (map.get('background') as Slide['background']) ?? null,
    notes: (map.get('notes') as string) ?? '',
    hidden: Boolean(map.get('hidden')),
    section: (map.get('section') as string | null) ?? undefined,
    transition: (map.get('transition') as Slide['transition']) ?? { kind: 'none', duration: 600, direction: 'left', advanceAfter: 0 },
    animations: ((map.get('animations') as Slide['animations']) ?? []).filter((a) => seen.has(a.elementId)),
    elements,
  };
}

export class DeckDoc {
  readonly doc: Y.Doc;
  readonly undo: Y.UndoManager;
  private state: Presentation;
  private slideCache = new Map<string, Slide>();
  private dirtySlides = new Set<string>();
  private metaDirty = true;
  private listeners = new Set<(p: Presentation, local: boolean) => void>();

  constructor(doc = new Y.Doc()) {
    this.doc = doc;
    const roots = [this.meta, this.order, this.slides, this.assetMeta];
    this.undo = new Y.UndoManager(roots, { trackedOrigins: new Set([LOCAL_ORIGIN]), captureTimeout: 400 });
    this.state = this.read();
    this.slides.observeDeep((events) => {
      for (const ev of events) {
        const key = ev.path[0];
        if (typeof key === 'string') this.dirtySlides.add(key);
        else if (ev.target === this.slides) for (const k of (ev as Y.YMapEvent<unknown>).keysChanged) this.dirtySlides.add(k);
      }
    });
    this.meta.observe(() => (this.metaDirty = true));
    this.order.observe(() => (this.metaDirty = true));
    this.assetMeta.observe(() => (this.metaDirty = true));
    this.doc.on('afterTransaction', (tr: Y.Transaction) => {
      if (!this.dirtySlides.size && !this.metaDirty) return;
      this.state = this.read();
      const local = tr.origin === LOCAL_ORIGIN;
      for (const l of this.listeners) l(this.state, local);
    });
  }

  get meta() { return this.doc.getMap<unknown>('meta'); }
  get order() { return this.doc.getArray<string>('order'); }
  get slides() { return this.doc.getMap<Y.Map<unknown>>('slides'); }
  get assetMeta() { return this.doc.getMap<AssetMeta>('assetMeta'); }
  get assetData() { return this.doc.getMap<Uint8Array>('assetData'); }

  get presentation(): Presentation {
    return this.state;
  }

  subscribe(fn: (p: Presentation, local: boolean) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** True once the doc contains a presentation (meta.id set). */
  get initialized(): boolean {
    return this.meta.has('id');
  }

  private read(): Presentation {
    const base = createPresentation();
    const meta = this.meta;
    const order = this.order.toArray();
    const seen = new Set<string>();
    const slides: Slide[] = [];
    for (const id of order) {
      if (seen.has(id)) continue;
      const m = this.slides.get(id);
      if (!m) continue;
      seen.add(id);
      let s = this.slideCache.get(id);
      if (!s || this.dirtySlides.has(id)) {
        s = readSlide(id, m);
        this.slideCache.set(id, s);
      }
      slides.push(s);
    }
    for (const id of this.slideCache.keys()) if (!this.slides.has(id)) this.slideCache.delete(id);
    this.dirtySlides.clear();
    this.metaDirty = false;
    const assets: Record<string, AssetMeta> = {};
    for (const [k, v] of this.assetMeta.entries()) assets[k] = v;
    return {
      id: (meta.get('id') as string) ?? base.id,
      title: (meta.get('title') as string) ?? base.title,
      width: (meta.get('width') as number) ?? base.width,
      height: (meta.get('height') as number) ?? base.height,
      theme: (meta.get('theme') as Presentation['theme']) ?? base.theme,
      importReport: (meta.get('importReport') as Presentation['importReport']) ?? undefined,
      assets,
      slides,
    };
  }

  /**
   * Commit a new immutable presentation state. Only fields that changed
   * relative to the current state are written, so each commit is a small,
   * mergeable, undoable Yjs transaction.
   */
  commit(next: Presentation, origin: unknown = LOCAL_ORIGIN) {
    const prev = this.state;
    this.doc.transact(() => {
      const nm = next as unknown as Record<string, unknown>;
      const pm = prev as unknown as Record<string, unknown>;
      for (const k of META_FIELDS) {
        const v = nm[k];
        if (v === undefined) {
          if (this.meta.has(k)) this.meta.delete(k);
        } else if (!this.meta.has(k) || !same(v, pm[k])) this.meta.set(k, json(v));
      }
      const prevSlides = new Map(prev.slides.map((s) => [s.id, s]));
      const ids = new Set<string>();
      for (const s of next.slides) {
        ids.add(s.id);
        const p = prevSlides.get(s.id);
        let m = this.slides.get(s.id);
        if (p === s && m) continue;
        if (!m) {
          m = new Y.Map<unknown>();
          this.slides.set(s.id, m);
          writeSlide(m, s);
        } else writeSlide(m, s, p);
      }
      for (const id of Array.from(this.slides.keys())) if (!ids.has(id)) this.slides.delete(id);
      syncOrder(this.order, next.slides.map((s) => s.id));
      for (const id of Array.from(this.assetMeta.keys())) if (!next.assets[id]) this.assetMeta.delete(id);
      for (const [id, meta] of Object.entries(next.assets)) if (!same(this.assetMeta.get(id), meta)) this.assetMeta.set(id, json(meta));
    }, origin);
  }

  /** Store binary asset bytes. Not part of undo history (bytes are immutable and content-addressed). */
  putAsset(meta: AssetMeta, bytes: Uint8Array) {
    this.doc.transact(() => {
      if (!this.assetData.has(meta.id)) this.assetData.set(meta.id, bytes);
    }, 'asset');
  }

  getAsset(id: string): Uint8Array | undefined {
    return this.assetData.get(id);
  }

  /** Remove asset bytes no element or background references any more. */
  collectGarbage(): number {
    const used = new Set<string>();
    const scan = (v: unknown) => {
      if (typeof v === 'string' && v.startsWith('asset:')) used.add(v.slice(6));
    };
    for (const s of this.state.slides) {
      if (s.background?.kind === 'image') scan(s.background.src);
      for (const e of s.elements) {
        if (e.type === 'image') scan(e.src);
        if (e.type === 'media') { scan(e.src); scan(e.poster); }
        if ((e.type === 'text' || e.type === 'shape') && e.fill.kind === 'image') scan(e.fill.src);
      }
    }
    let removed = 0;
    this.doc.transact(() => {
      for (const id of Array.from(this.assetData.keys())) if (!used.has(id)) { this.assetData.delete(id); this.assetMeta.delete(id); removed++; }
    }, 'gc');
    return removed;
  }
}

/** Build a fresh Y.Doc holding `pres` plus asset bytes. */
export function docFromPresentation(pres: Presentation, assets: Record<string, Uint8Array> = {}): DeckDoc {
  const d = new DeckDoc();
  d.commit(pres, 'init');
  for (const [id, bytes] of Object.entries(assets)) {
    const meta = pres.assets[id];
    if (meta) d.putAsset(meta, bytes);
  }
  d.undo.clear();
  return d;
}
