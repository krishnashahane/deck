import {
  align as alignEls,
  applyLayout,
  bounds,
  cloneSlide,
  createChart,
  createEquation,
  createImage,
  createLine,
  createMedia,
  createShape,
  createSlide,
  createTable,
  createText,
  distribute,
  group,
  layoutById,
  para,
  reorder,
  ungroup,
  uid,
  type AlignMode,
  type LayoutId,
  type ShapeKind,
  type Slide,
  type SlideElement,
  type ZOp,
} from '@deck/core';
import type { EditorStore } from '../lib/store';
import { copyStyle, pasteStyle, type StyleSnapshot } from '@deck/core';
import { addFile } from '../lib/assets';
import { toast } from '../lib/toast';

/* ───────────── slides ───────────── */

export function addSlide(store: EditorStore, layout: LayoutId = 'title-content', after?: string) {
  const p = store.pres;
  const cur = store.slide;
  const s = createSlide({ layout, elements: layoutById(layout).build(p.theme, p.width, p.height), transition: cur ? { ...cur.transition } : undefined });
  const idx = after ? p.slides.findIndex((x) => x.id === after) : p.slides.findIndex((x) => x.id === cur?.id);
  store.update((pp) => {
    const slides = [...pp.slides];
    slides.splice(idx < 0 ? slides.length : idx + 1, 0, s);
    return { ...pp, slides };
  });
  store.goToSlide(s.id);
}

export function duplicateSlides(store: EditorStore, ids = selectedSlideIds(store)) {
  const set = new Set(ids);
  let last = '';
  store.update((p) => {
    const out: Slide[] = [];
    for (const s of p.slides) {
      out.push(s);
      if (set.has(s.id)) {
        const c = cloneSlide(s);
        c.section = undefined;
        out.push(c);
        last = c.id;
      }
    }
    return { ...p, slides: out };
  });
  if (last) store.goToSlide(last);
}

export function deleteSlides(store: EditorStore, ids = selectedSlideIds(store)) {
  const set = new Set(ids);
  const p = store.pres;
  if (set.size >= p.slides.length) {
    toast('A presentation needs at least one slide');
    return;
  }
  const idx = p.slides.findIndex((s) => set.has(s.id));
  store.update((pp) => {
    const removed = pp.slides.filter((s) => set.has(s.id));
    const kept = pp.slides.filter((s) => !set.has(s.id));
    // Keep a section label if its first slide was removed.
    for (const r of removed) if (r.section) {
      const i = pp.slides.indexOf(r);
      const next = pp.slides.slice(i + 1).find((s) => !set.has(s.id));
      if (next && !next.section) kept[kept.indexOf(next)] = { ...next, section: r.section };
    }
    return { ...pp, slides: kept };
  });
  const after = store.pres.slides[Math.min(idx, store.pres.slides.length - 1)];
  if (after) store.setUi({ slideId: after.id, slideSelection: [after.id], selection: [] });
}

export function moveSlides(store: EditorStore, ids: string[], toIndex: number) {
  const set = new Set(ids);
  store.update((p) => {
    const moving = p.slides.filter((s) => set.has(s.id));
    const before = p.slides.slice(0, toIndex).filter((s) => !set.has(s.id));
    const after = p.slides.slice(toIndex).filter((s) => !set.has(s.id));
    return { ...p, slides: [...before, ...moving, ...after] };
  });
}

export function toggleHidden(store: EditorStore, ids = selectedSlideIds(store)) {
  const set = new Set(ids);
  const hide = !store.pres.slides.filter((s) => set.has(s.id)).every((s) => s.hidden);
  store.update((p) => ({ ...p, slides: p.slides.map((s) => (set.has(s.id) ? { ...s, hidden: hide } : s)) }));
}

export function addSection(store: EditorStore, slideId = store.slide?.id) {
  if (!slideId) return;
  store.updateSlide(slideId, (s) => ({ ...s, section: s.section ?? 'New section' }));
}

export function setLayout(store: EditorStore, layout: LayoutId) {
  const s = store.slide;
  if (!s) return;
  store.updateSlide(s.id, (sl) => applyLayout(sl, layout, store.pres));
}

export function selectedSlideIds(store: EditorStore): string[] {
  const sel = store.ui.slideSelection.filter((id) => store.pres.slides.some((s) => s.id === id));
  return sel.length ? sel : store.slide ? [store.slide.id] : [];
}

/* ───────────── elements ───────────── */

function centerIn(store: EditorStore, el: SlideElement): SlideElement {
  const p = store.pres;
  return { ...el, x: (p.width - el.w) / 2, y: (p.height - el.h) / 2 };
}

export function insertElement(store: EditorStore, el: SlideElement, opts: { center?: boolean; edit?: boolean } = {}) {
  const s = store.slide;
  if (!s) return;
  const e = opts.center ? centerIn(store, el) : el;
  store.updateSlide(s.id, (sl) => ({ ...sl, elements: [...sl.elements, e] }));
  store.select([e.id]);
  if (opts.edit) store.setUi({ editingId: e.id });
}

export function insertText(store: EditorStore) {
  const t = store.pres.theme;
  insertElement(store, createText(t, { w: 900, h: 120, paragraphs: [para('')], style: { ...createText(t).style, size: 32 } }), { center: true, edit: true });
}

export function insertShape(store: EditorStore, kind: ShapeKind) {
  insertElement(store, createShape(store.pres.theme, kind, { w: 360, h: kind === 'arrowRight' || kind === 'chevron' ? 220 : 360, cornerRadius: kind === 'roundRect' ? store.pres.theme.radius * 2 : 0 }), { center: true });
}

export function insertTable(store: EditorStore, rows = 4, cols = 3) {
  insertElement(store, createTable(store.pres.theme, rows, cols), { center: true });
}

export function insertChart(store: EditorStore, kind: import('@deck/core').ChartKind = 'column') {
  insertElement(store, createChart(store.pres.theme, kind), { center: true });
  store.setUi({ inspector: 'format' });
}

export function insertEquation(store: EditorStore) {
  insertElement(store, createEquation(store.pres.theme), { center: true });
}

export function insertLine(store: EditorStore, arrow = false) {
  const p = store.pres;
  insertElement(store, createLine(p.theme, p.width * 0.35, p.height / 2, p.width * 0.65, p.height / 2, { endArrow: arrow ? 'arrow' : 'none' }));
}

export async function insertFiles(store: EditorStore, files: File[], at?: { x: number; y: number }) {
  const p = store.pres;
  let off = 0;
  for (const f of files) {
    try {
      const a = await addFile(store.deck, f);
      store.update((pp) => ({ ...pp, assets: { ...pp.assets, [a.meta.id]: a.meta } }));
      const maxW = p.width * 0.6, maxH = p.height * 0.6;
      const k = Math.min(1, maxW / a.width, maxH / a.height);
      const w = a.width * k, h = a.height * k;
      const x = (at ? at.x - w / 2 : (p.width - w) / 2) + off, y = (at ? at.y - h / 2 : (p.height - h) / 2) + off;
      off += 30;
      const el = a.kind === 'image' ? createImage(a.src, w, h, { x, y, name: f.name.replace(/\.[^.]+$/, '').slice(0, 60) || 'Image' }) : createMedia(a.kind, a.src, a.kind === 'video' ? { x, y, w, h } : { x: (p.width - 480) / 2, y: p.height - 160 });
      insertElement(store, el);
    } catch (e) {
      toast((e as Error).message);
    }
  }
}

export function pickFiles(accept: string): Promise<File[]> {
  return new Promise((resolve) => {
    const i = document.createElement('input');
    i.type = 'file';
    i.accept = accept;
    i.multiple = true;
    i.onchange = () => resolve(Array.from(i.files ?? []));
    i.click();
  });
}

export function deleteSelection(store: EditorStore) {
  const ids = new Set(store.ui.selection);
  const s = store.slide;
  if (!s || !ids.size) return;
  store.updateSlide(s.id, (sl) => ({
    ...sl,
    elements: sl.elements.filter((e) => !ids.has(e.id)).map((e) => (e.type === 'line' && ((e.from && ids.has(e.from)) || (e.to && ids.has(e.to))) ? { ...e, from: e.from && ids.has(e.from) ? undefined : e.from, to: e.to && ids.has(e.to) ? undefined : e.to } : e)),
    animations: sl.animations.filter((a) => !ids.has(a.elementId)),
  }));
  store.setUi({ selection: [], editingId: null });
}

export function nudge(store: EditorStore, dx: number, dy: number) {
  store.updateElements(store.ui.selection, (e) => {
    const n = { ...e, x: e.x + dx, y: e.y + dy } as SlideElement;
    if (n.type === 'line' && e.type === 'line') return { ...n, x1: e.x1 + dx, y1: e.y1 + dy, x2: e.x2 + dx, y2: e.y2 + dy };
    return n;
  }, 'nudge');
}

export function zorder(store: EditorStore, op: ZOp) {
  const s = store.slide;
  if (!s) return;
  store.updateSlide(s.id, (sl) => ({ ...sl, elements: reorder(sl, new Set(store.ui.selection), op) }));
}

export function alignSelection(store: EditorStore, mode: AlignMode) {
  const els = store.selected;
  const map = new Map(alignEls(els, mode, store.pres).map((e) => [e.id, e]));
  store.updateElements(map.keys(), (e) => map.get(e.id)!);
}

export function distributeSelection(store: EditorStore, axis: 'h' | 'v') {
  const map = new Map(distribute(store.selected, axis).map((e) => [e.id, e]));
  store.updateElements(map.keys(), (e) => map.get(e.id)!);
}

export function groupSelection(store: EditorStore) {
  const s = store.slide;
  if (!s || store.ui.selection.length < 2) return;
  store.updateSlide(s.id, (sl) => group(sl, new Set(store.ui.selection)));
}

export function ungroupSelection(store: EditorStore) {
  const s = store.slide;
  if (!s) return;
  store.updateSlide(s.id, (sl) => ungroup(sl, new Set(store.ui.selection)));
}

/* ───────────── clipboard ───────────── */

const CLIP_PREFIX = 'application/x-deck-elements';
let internalClip: { elements: SlideElement[]; slides?: Slide[] } | null = null;

function remapIds(els: SlideElement[], offset: number): SlideElement[] {
  const map = new Map<string, string>();
  const groups = new Map<string, string>();
  const out = els.map((e) => {
    const id = uid('el');
    map.set(e.id, id);
    const gid = e.groupId ? (groups.get(e.groupId) ?? groups.set(e.groupId, uid('gr')).get(e.groupId)) : undefined;
    const n = { ...structuredClone(e), id, groupId: gid, x: e.x + offset, y: e.y + offset } as SlideElement;
    if (n.type === 'line' && e.type === 'line') Object.assign(n, { x1: e.x1 + offset, y1: e.y1 + offset, x2: e.x2 + offset, y2: e.y2 + offset });
    return n;
  });
  return out.map((e) => (e.type === 'line' ? { ...e, from: e.from ? map.get(e.from) : undefined, to: e.to ? map.get(e.to) : undefined } : e));
}

export async function copy(store: EditorStore, cut = false) {
  const els = store.selected;
  if (!els.length) {
    // Copy slides when nothing on the canvas is selected.
    const ids = new Set(selectedSlideIds(store));
    internalClip = { elements: [], slides: store.pres.slides.filter((s) => ids.has(s.id)) };
    toast(`Copied ${ids.size} slide${ids.size > 1 ? 's' : ''}`);
    return;
  }
  internalClip = { elements: structuredClone(els) };
  try {
    const text = els.map((e) => (e.type === 'text' || e.type === 'shape' ? e.paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join('\n') : '')).filter(Boolean).join('\n');
    await navigator.clipboard.writeText(text || ' ');
  } catch {
    /* clipboard permission is optional */
  }
  if (cut) deleteSelection(store);
}

export async function paste(store: EditorStore, e?: ClipboardEvent) {
  const files = Array.from(e?.clipboardData?.files ?? []);
  if (files.length) return insertFiles(store, files);
  const text = e?.clipboardData?.getData('text/plain');
  const internalText = internalClip?.elements.length
    ? internalClip.elements.map((x) => (x.type === 'text' || x.type === 'shape' ? x.paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join('\n') : '')).filter(Boolean).join('\n') || ' '
    : null;
  if (internalClip && (text === undefined || text === internalText || !text)) {
    if (internalClip.slides?.length && !internalClip.elements.length) {
      const copies = internalClip.slides.map(cloneSlide);
      const cur = store.slide;
      store.update((p) => {
        const i = p.slides.findIndex((s) => s.id === cur?.id);
        const slides = [...p.slides];
        slides.splice(i + 1, 0, ...copies);
        return { ...p, slides };
      });
      store.goToSlide(copies[0]!.id);
      return;
    }
    const els = remapIds(internalClip.elements, 24);
    internalClip = { elements: els.map((x) => structuredClone(x)) };
    const s = store.slide;
    if (!s) return;
    store.updateSlide(s.id, (sl) => ({ ...sl, elements: [...sl.elements, ...els] }));
    store.select(els.map((x) => x.id));
    return;
  }
  if (text && text.trim()) {
    const t = store.pres.theme;
    insertElement(store, createText(t, { w: 1000, h: 200, paragraphs: text.split(/\r?\n/).slice(0, 200).map((l) => para(l.slice(0, 5000))) }), { center: true });
  }
}

export function duplicateSelection(store: EditorStore) {
  const els = store.selected;
  const s = store.slide;
  if (!s || !els.length) return duplicateSlides(store);
  const copies = remapIds(els, 24);
  store.updateSlide(s.id, (sl) => ({ ...sl, elements: [...sl.elements, ...copies] }));
  store.select(copies.map((x) => x.id));
}

export { CLIP_PREFIX, bounds };

// ---- Format painter -------------------------------------------------------
let styleClip: StyleSnapshot | null = null;

export const hasCopiedStyle = () => styleClip !== null;

export function copyFormat(store: EditorStore) {
  const el = store.selected[0];
  if (!el) { toast('Select an object to copy its style'); return; }
  styleClip = copyStyle(el);
  toast('Style copied · ⌥⌘V to apply it to other objects');
}

export function pasteFormat(store: EditorStore, ids: string[] = store.ui.selection) {
  if (!styleClip) { toast('Copy a style first (⌥⌘C)'); return; }
  const s = styleClip;
  const targets = ids.filter((id) => !store.slide?.elements.find((e) => e.id === id)?.locked);
  if (targets.length) store.updateElements(targets, (e) => pasteStyle(e, s));
}

/** Arm the painter from the current selection; sticky keeps it armed until Esc. */
export function startPainter(store: EditorStore, sticky = false) {
  if (store.ui.painter) { store.setUi({ painter: null }); return; }
  const el = store.selected[0];
  if (!el) { toast('Select an object, then use the format painter to copy its style'); return; }
  styleClip = copyStyle(el);
  store.setUi({ painter: { style: styleClip, sticky }, tool: 'select', editingId: null });
}
