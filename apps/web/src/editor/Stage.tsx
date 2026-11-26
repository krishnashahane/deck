import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPE } from 'react';
import { bounds, uid, createLine, createShape, createText, moveLineWith, para, resizeLine, rotatedBounds, snap, syncLineBox, type Guide, type SlideElement } from '@deck/core';
import { SlideView, resolveConnector } from '../render/SlideView';
import { useEditor, type EditorStore } from '../lib/store';
import { fromEditableDom, toEditableHtml } from './richtext';
import * as A from './actions';
import { ContextMenu, tidy, type MenuEntry } from './ContextMenu';
import { expandToGroups } from '@deck/core';
import { ContextBar } from './ContextBar';
import { Icon } from './icons';
import type { Awareness } from 'y-protocols/awareness';

type Pt = { x: number; y: number };
type Drag =
  | { kind: 'move'; start: Pt; orig: Map<string, SlideElement>; dup: boolean; moved: boolean }
  | { kind: 'resize'; handle: string; start: Pt; orig: Map<string, SlideElement>; box: { x: number; y: number; w: number; h: number } }
  | { kind: 'rotate'; center: Pt; orig: Map<string, SlideElement>; startAngle: number }
  | { kind: 'marquee'; start: Pt; cur: Pt; base: string[] }
  | { kind: 'create'; tool: 'text' | 'shape' | 'line'; start: Pt; cur: Pt }
  | { kind: 'endpoint'; id: string; end: 1 | 2; orig: SlideElement }
  | { kind: 'pan'; start: Pt; scroll: Pt };

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
const CURSORS: Record<string, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };

function hitTest(els: SlideElement[], p: Pt, byId: Map<string, SlideElement>): SlideElement | null {
  for (let i = els.length - 1; i >= 0; i--) {
    const e = els[i]!;
    if (e.hidden) continue;
    if (e.type === 'line') {
      const l = resolveConnector(e, byId);
      const dx = l.x2 - l.x1, dy = l.y2 - l.y1;
      const len2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((p.x - l.x1) * dx + (p.y - l.y1) * dy) / len2));
      const d = Math.hypot(p.x - (l.x1 + t * dx), p.y - (l.y1 + t * dy));
      if (d <= Math.max(10, l.stroke.width)) return e;
      continue;
    }
    // Transform point into the element's unrotated frame.
    const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
    const a = (-e.rotation * Math.PI) / 180;
    const lx = cx + (p.x - cx) * Math.cos(a) - (p.y - cy) * Math.sin(a);
    const ly = cy + (p.x - cx) * Math.sin(a) + (p.y - cy) * Math.cos(a);
    if (lx >= e.x && lx <= e.x + e.w && ly >= e.y && ly <= e.y + e.h) return e;
  }
  return null;
}

export function Stage({ store, awareness }: { store: EditorStore; awareness?: Awareness | null }) {
  const { pres, ui } = useEditor(store, (s) => s);
  const slide = pres.slides.find((s) => s.id === ui.slideId) ?? pres.slides[0];
  const wrapRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [hover, setHover] = useState<string | null>(null);
  const [cellEdit, setCellEdit] = useState<{ id: string; r: number; c: number } | null>(null);
  const [remote, setRemote] = useState<{ id: number; name: string; color: string; x: number; y: number }[]>([]);
  const [space, setSpace] = useState(false);

  useLayoutEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = Math.max(0.05, Math.min((size.w - 96) / pres.width, (size.h - 96) / pres.height));
  const scale = ui.zoom || fit;
  useEffect(() => {
    if (Math.abs(store.ui.fitZoom - fit) > 0.0001) store.setUi({ fitZoom: fit });
  }, [fit, store]);
  const sw = pres.width * scale, sh = pres.height * scale;
  const pad = 48;
  const contentW = Math.max(size.w, sw + pad * 2), contentH = Math.max(size.h, sh + pad * 2);
  const left = (contentW - sw) / 2, top = (contentH - sh) / 2;

  // Space-bar panning.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTyping(e)) {
        setSpace(true);
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => e.code === 'Space' && setSpace(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // Remote presence cursors.
  useEffect(() => {
    if (!awareness) return;
    const onChange = () => {
      const out: typeof remote = [];
      awareness.getStates().forEach((st, id) => {
        if (id === awareness.clientID || !st.user || !st.cursor || st.cursor.slideId !== store.ui.slideId) return;
        out.push({ id, name: String(st.user.name).slice(0, 40), color: st.user.color, x: st.cursor.x, y: st.cursor.y });
      });
      setRemote(out);
    };
    awareness.on('change', onChange);
    return () => awareness.off('change', onChange);
  }, [awareness, store]);

  const toSlide = useCallback(
    (e: { clientX: number; clientY: number }): Pt => {
      const r = hostRef.current!.getBoundingClientRect();
      return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
    },
    [scale],
  );

  // Ctrl/⌘ + wheel zoom around the pointer; trackpad pinch arrives as ctrl+wheel.
  useEffect(() => {
    const el = wrapRef.current!;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const next = Math.max(0.1, Math.min(4, scale * Math.exp(-e.deltaY * 0.01)));
      store.setUi({ zoom: next });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [scale, store]);

  if (!slide) return <div className="stage" ref={wrapRef}><div className="empty-state">No slides</div></div>;
  const byId = new Map(slide.elements.map((e) => [e.id, e]));
  const selected = slide.elements.filter((e) => ui.selection.includes(e.id));

  const onPointerDown = (e: RPE) => {
    if (e.button === 1 || space || ui.tool === 'pan') {
      const sc = wrapRef.current!.querySelector('.stage-scroll')!;
      setDrag({ kind: 'pan', start: { x: e.clientX, y: e.clientY }, scroll: { x: sc.scrollLeft, y: sc.scrollTop } });
      (e.target as Element).setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    const p = toSlide(e);
    if (ui.editingId) {
      commitEditing();
      store.setUi({ editingId: null });
    }
    setCellEdit(null);
    (e.target as Element).setPointerCapture(e.pointerId);
    if (ui.tool === 'text' || ui.tool === 'shape' || ui.tool === 'line') {
      setDrag({ kind: 'create', tool: ui.tool, start: p, cur: p });
      return;
    }
    const hit = hitTest(slide.elements, p, byId);
    if (ui.painter) {
      if (hit) {
        const ids = [...expandToGroups(slide, new Set([hit.id]))];
        A.pasteFormat(store, ids);
        store.select(ids);
      }
      if (!hit || !ui.painter.sticky) store.setUi({ painter: null });
      return;
    }
    if (hit) {
      let ids = ui.selection;
      if (e.shiftKey || e.metaKey || e.ctrlKey) {
        if (ids.includes(hit.id)) {
          store.select(ids.filter((i) => i !== hit.id && byId.get(i)?.groupId !== hit.groupId || (!hit.groupId && i !== hit.id)));
          return;
        }
        store.select([hit.id], true);
      } else if (!ids.includes(hit.id)) store.select([hit.id]);
      ids = store.ui.selection;
      if (hit.locked) return;
      const orig = new Map(slide.elements.filter((x) => ids.includes(x.id) && !x.locked).map((x) => [x.id, x]));
      setDrag({ kind: 'move', start: p, orig, dup: e.altKey, moved: false });
    } else {
      if (!(e.shiftKey || e.metaKey)) store.select([]);
      setDrag({ kind: 'marquee', start: p, cur: p, base: e.shiftKey || e.metaKey ? ui.selection : [] });
    }
  };

  const onPointerMove = (e: RPE) => {
    const p = toSlide(e);
    awareness?.setLocalStateField('cursor', { slideId: slide.id, x: p.x, y: p.y });
    if (!drag) {
      if (ui.tool === 'select') setHover(hitTest(slide.elements, p, byId)?.id ?? null);
      return;
    }
    switch (drag.kind) {
      case 'pan': {
        const sc = wrapRef.current!.querySelector('.stage-scroll')!;
        sc.scrollLeft = drag.scroll.x - (e.clientX - drag.start.x);
        sc.scrollTop = drag.scroll.y - (e.clientY - drag.start.y);
        break;
      }
      case 'move': {
        let dx = p.x - drag.start.x, dy = p.y - drag.start.y;
        if (!drag.moved && Math.hypot(dx, dy) * scale < 3) return;
        if (e.shiftKey) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0);
        const origs = [...drag.orig.values()];
        if (drag.dup && !drag.moved) {
          // Alt-drag: leave copies behind; the originals move.
          const copies = origs.map((o) => ({ ...structuredClone(o), id: uid('el') }));
          store.updateSlide(slide.id, (s) => {
            const idx = s.elements.findIndex((x) => drag.orig.has(x.id));
            const els = [...s.elements];
            els.splice(idx, 0, ...copies);
            return { ...s, elements: els };
          }, 'move');
        }
        const b = bounds(origs.map((o) => rotatedBounds(o)));
        if (ui.snap && !e.metaKey) {
          const others = slide.elements.filter((x) => !drag.orig.has(x.id) && !x.hidden).map((x) => rotatedBounds(x));
          const r = snap({ ...b, x: b.x + dx, y: b.y + dy }, others, pres, { threshold: 6 / scale, grid: ui.showGrid ? 40 : undefined });
          dx += r.dx;
          dy += r.dy;
          setGuides(r.guides);
        }
        store.updateElements(drag.orig.keys(), (el) => {
          const o = drag.orig.get(el.id)!;
          return moveLineWith(o, { ...o, x: o.x + dx, y: o.y + dy } as SlideElement);
        }, 'move');
        setDrag({ ...drag, moved: true });
        break;
      }
      case 'resize': {
        const { box, handle } = drag;
        let { x, y, w, h } = box;
        const dx = p.x - drag.start.x, dy = p.y - drag.start.y;
        if (handle.includes('e')) w = box.w + dx;
        if (handle.includes('s')) h = box.h + dy;
        if (handle.includes('w')) { x = box.x + dx; w = box.w - dx; }
        if (handle.includes('n')) { y = box.y + dy; h = box.h - dy; }
        const single = drag.orig.size === 1 ? [...drag.orig.values()][0]! : null;
        const keepRatio = e.shiftKey !== Boolean(single && (single.type === 'image' || single.type === 'media'));
        if (keepRatio && handle.length === 2) {
          const k = Math.max(w / box.w, h / box.h);
          const nw = box.w * k, nh = box.h * k;
          if (handle.includes('w')) x = box.x + box.w - nw;
          if (handle.includes('n')) y = box.y + box.h - nh;
          w = nw;
          h = nh;
        }
        if (e.altKey) { x = box.x - (w - box.w) / 2; y = box.y - (h - box.h) / 2; }
        if (w < 0) { x += w; w = -w; }
        if (h < 0) { y += h; h = -h; }
        w = Math.max(4, w);
        h = Math.max(4, h);
        if (ui.snap && !e.metaKey && drag.orig.size === 1) {
          const others = slide.elements.filter((o) => !drag.orig.has(o.id)).map((o) => rotatedBounds(o));
          const edge = { x: handle.includes('w') ? x : x + w, y: handle.includes('n') ? y : y + h, w: 0, h: 0 };
          const r = snap(edge, others, pres, { threshold: 6 / scale });
          if (handle.includes('e')) w += r.dx;
          if (handle.includes('w')) { x += r.dx; w -= r.dx; }
          if (handle.includes('s')) h += r.dy;
          if (handle.includes('n')) { y += r.dy; h -= r.dy; }
          setGuides(r.guides);
        }
        const sx = w / box.w, sy = h / box.h;
        store.updateElements(drag.orig.keys(), (el) => {
          const o = drag.orig.get(el.id)!;
          const n = { ...o, x: x + (o.x - box.x) * sx, y: y + (o.y - box.y) * sy, w: o.w * sx, h: o.h * sy } as SlideElement;
          return resizeLine(o, n);
        }, 'resize');
        break;
      }
      case 'rotate': {
        const a = (Math.atan2(p.y - drag.center.y, p.x - drag.center.x) * 180) / Math.PI - drag.startAngle;
        store.updateElements(drag.orig.keys(), (el) => {
          const o = drag.orig.get(el.id)!;
          let r = o.rotation + a;
          if (e.shiftKey) r = Math.round(r / 15) * 15;
          else if (Math.abs(((r % 90) + 90) % 90) < 2 || Math.abs(((r % 90) + 90) % 90) > 88) r = Math.round(r / 90) * 90;
          r = ((r % 360) + 360) % 360;
          return { ...o, rotation: Math.round(r * 10) / 10 };
        }, 'rotate');
        break;
      }
      case 'marquee': {
        setDrag({ ...drag, cur: p });
        const r = { x: Math.min(drag.start.x, p.x), y: Math.min(drag.start.y, p.y), w: Math.abs(p.x - drag.start.x), h: Math.abs(p.y - drag.start.y) };
        const ids = slide.elements.filter((el) => !el.hidden && el.x < r.x + r.w && el.x + el.w > r.x && el.y < r.y + r.h && el.y + el.h > r.y).map((el) => el.id);
        store.select([...new Set([...drag.base, ...ids])]);
        break;
      }
      case 'create':
        setDrag({ ...drag, cur: e.shiftKey && drag.tool !== 'text' ? constrain(drag.start, p, drag.tool === 'line') : p });
        break;
      case 'endpoint': {
        const o = drag.orig;
        if (o.type !== 'line') break;
        const target = hitTest(slide.elements.filter((x) => x.id !== o.id && x.type !== 'line'), p, byId);
        const key = drag.end === 1 ? { x1: p.x, y1: p.y, from: target?.id } : { x2: p.x, y2: p.y, to: target?.id };
        store.updateElements([o.id], (el) => (el.type === 'line' ? syncLineBox({ ...el, ...key }) : el), 'endpoint');
        setHover(target?.id ?? null);
        break;
      }
    }
  };

  const onPointerUp = (e: RPE) => {
    const d = drag;
    setDrag(null);
    setGuides([]);
    if (!d) return;
    if (d.kind === 'create') {
      const x = Math.min(d.start.x, d.cur.x), y = Math.min(d.start.y, d.cur.y);
      let w = Math.abs(d.cur.x - d.start.x), h = Math.abs(d.cur.y - d.start.y);
      const t = pres.theme;
      let el: SlideElement;
      if (d.tool === 'line') {
        if (w < 4 && h < 4) {
          store.setUi({ tool: 'select' });
          return;
        }
        const from = hitTest(slide.elements, d.start, byId)?.id;
        const to = hitTest(slide.elements, d.cur, byId)?.id;
        el = createLine(t, d.start.x, d.start.y, d.cur.x, d.cur.y, { from, to, endArrow: 'arrow' });
      } else if (d.tool === 'text') {
        if (w < 20) w = 700;
        if (h < 20) h = 110;
        el = createText(t, { x, y, w, h, paragraphs: [para('')], style: { ...createText(t).style, size: 32 } });
      } else {
        if (w < 8 && h < 8) { w = 300; h = 300; }
        el = createShape(t, ui.shapeKind, { x, y, w, h, cornerRadius: ui.shapeKind === 'roundRect' ? t.radius * 2 : 0 });
      }
      store.updateSlide(slide.id, (s) => ({ ...s, elements: [...s.elements, el] }));
      store.select([el.id]);
      store.setUi({ tool: 'select', editingId: d.tool === 'text' ? el.id : null });
    }
    if (d.kind === 'move' && !d.moved && !(e.shiftKey || e.metaKey)) {
      const hit = hitTest(slide.elements, toSlide(e), byId);
      // Click inside an already-selected group selects just that member.
      if (hit && hit.groupId && store.ui.selection.length > 1 && e.detail === 1) store.setUi({ selection: [hit.id] });
    }
  };

  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (ui.readOnly) return;
    if (ui.editingId) { commitEditing(); store.setUi({ editingId: null }); }
    const hit = hitTest(slide.elements, toSlide(e), byId);
    if (hit && !ui.selection.includes(hit.id)) store.select([hit.id]);
    if (!hit) store.select([]);
    setMenu({ x: e.clientX, y: e.clientY });
  };
  const menuItems = (): MenuEntry[] => {
    const sel = store.selected;
    const n = sel.length;
    const locked = n > 0 && sel.every((x) => x.locked);
    const grouped = sel.some((x) => x.groupId);
    if (!n) {
      return tidy([
        { label: 'Paste', icon: 'copy', kbd: '⌘V', run: () => void A.paste(store) },
        'sep',
        { label: 'Select all', kbd: '⌘A', run: () => store.select(slide.elements.map((x) => x.id)) },
        { label: 'Text box', icon: 'text', kbd: 'T', run: () => A.insertText(store) },
        { label: 'New slide', icon: 'plus', kbd: '⌘⏎', run: () => A.addSlide(store) },
        'sep',
        { label: ui.showGrid ? 'Hide grid' : 'Show grid', icon: 'grid', kbd: "⌘'", run: () => store.setUi({ showGrid: !ui.showGrid }) },
        { label: 'Slide sorter', icon: 'layout', run: () => store.setUi({ sorter: true }) },
      ]);
    }
    return tidy([
      { label: 'Cut', kbd: '⌘X', run: () => void A.copy(store, true), disabled: locked },
      { label: 'Copy', icon: 'copy', kbd: '⌘C', run: () => void A.copy(store) },
      { label: 'Paste', kbd: '⌘V', run: () => void A.paste(store) },
      { label: 'Duplicate', kbd: '⌘D', run: () => A.duplicateSelection(store) },
      'sep',
      { label: 'Copy style', icon: 'brush', kbd: '⌥⌘C', run: () => A.copyFormat(store) },
      { label: 'Paste style', kbd: '⌥⌘V', run: () => A.pasteFormat(store), disabled: !A.hasCopiedStyle() || locked },
      'sep',
      { label: 'Bring to front', icon: 'front', kbd: '⇧⌘]', run: () => A.zorder(store, 'front') },
      { label: 'Send to back', icon: 'back', kbd: '⇧⌘[', run: () => A.zorder(store, 'back') },
      n > 1 && !grouped && { label: 'Group', icon: 'group', kbd: '⌘G', run: () => A.groupSelection(store) },
      grouped && { label: 'Ungroup', icon: 'group', kbd: '⇧⌘G', run: () => A.ungroupSelection(store) },
      { label: locked ? 'Unlock' : 'Lock', icon: locked ? 'unlock' : 'lock', kbd: '⇧⌘L', run: () => store.updateElements(ui.selection, (x) => ({ ...x, locked: !locked || undefined })) },
      n === 1 && (sel[0]!.type === 'text' || sel[0]!.type === 'shape') && !locked && { label: 'Edit text', icon: 'text', kbd: '⏎', run: () => store.setUi({ editingId: sel[0]!.id }) },
      'sep',
      { label: n > 1 ? `Delete ${n} objects` : 'Delete', icon: 'trash', kbd: '⌫', run: () => A.deleteSelection(store), danger: true, disabled: locked },
    ]);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const p = toSlide(e);
    const hit = hitTest(slide.elements, p, byId);
    if (!hit) {
      if (ui.tool === 'select') {
        const t = pres.theme;
        const el = createText(t, { x: p.x - 350, y: p.y - 55, w: 700, h: 110, paragraphs: [para('')], style: { ...createText(t).style, size: 32 } });
        store.updateSlide(slide.id, (s) => ({ ...s, elements: [...s.elements, el] }));
        store.select([el.id]);
        store.setUi({ editingId: el.id });
      }
      return;
    }
    if (hit.locked) return;
    if (hit.type === 'text' || hit.type === 'shape') {
      store.setUi({ selection: [hit.id], editingId: hit.id });
    } else if (hit.type === 'table') {
      const r = Math.min(hit.rows.length - 1, Math.max(0, Math.floor(((p.y - hit.y) / hit.h) * hit.rows.length)));
      let acc = 0, c = 0;
      const fx = (p.x - hit.x) / hit.w;
      for (; c < hit.colWidths.length - 1; c++) { acc += hit.colWidths[c]!; if (fx < acc) break; }
      setCellEdit({ id: hit.id, r, c });
    } else if (hit.type === 'chart' || hit.type === 'equation') {
      store.setUi({ selection: [hit.id], inspector: 'format', inspectorOpen: true });
    }
  };

  const startHandle = (e: RPE, handle: string) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    const orig = new Map(selected.filter((s) => !s.locked).map((s) => [s.id, s]));
    if (!orig.size) return;
    const p = toSlide(e);
    if (handle === 'rot') {
      const b = bounds(selected);
      const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
      setDrag({ kind: 'rotate', center: c, orig, startAngle: (Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI });
    } else {
      setDrag({ kind: 'resize', handle, start: p, orig, box: bounds(selected) });
    }
  };

  const commitEditing = () => {
    const ed = document.querySelector<HTMLElement>('[data-text-editor]');
    const id = store.ui.editingId;
    if (!ed || !id) return;
    const el = byId.get(id);
    if (!el || (el.type !== 'text' && el.type !== 'shape')) return;
    const paragraphs = fromEditableDom(ed, el.style);
    store.updateElements([id], (x) => (x.type === 'text' || x.type === 'shape' ? { ...x, paragraphs } : x), `text:${id}`);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter((f) => !/\.(pptx|potx)$/i.test(f.name));
    if (files.length) void A.insertFiles(store, files, toSlide(e));
  };

  const single = selected.length === 1 ? selected[0]! : null;
  const selBox = selected.length ? bounds(selected.map((s) => (s.type === 'line' ? resolveConnector(s, byId) : s)).map((s) => ({ x: s.x, y: s.y, w: s.w, h: s.h }))) : null;
  const editing = ui.editingId ? byId.get(ui.editingId) : undefined;
  const hiddenSet = editing ? new Set([editing.id]) : undefined;
  const cursor = ui.painter ? 'copy' : space || ui.tool === 'pan' ? (drag?.kind === 'pan' ? 'grabbing' : 'grab') : ui.tool !== 'select' ? 'crosshair' : drag?.kind === 'move' ? 'move' : hover ? 'move' : 'default';

  return (
    <div className="stage" ref={wrapRef} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <div className="stage-scroll">
        <div style={{ position: 'relative', width: contentW, height: contentH }}>
          <div className="slide-host" ref={hostRef} style={{ left, top, width: sw, height: sh }}>
            <SlideView slide={slide} pres={pres} deck={store.deck} width={sw} hidden={hiddenSet} />
            {ui.showGrid && (
              <svg className="overlay" width={sw} height={sh}>
                <defs>
                  <pattern id="grid40" width={40 * scale} height={40 * scale} patternUnits="userSpaceOnUse">
                    <path d={`M${40 * scale},0V${40 * scale}H0`} fill="none" stroke="rgba(111,168,255,0.25)" strokeWidth="1" />
                  </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#grid40)" />
              </svg>
            )}
            <div
              className="overlay"
              data-testid="stage-hit"
              style={{ pointerEvents: editing || ui.readOnly ? 'none' : 'auto', cursor }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={() => setHover(null)}
              onDoubleClick={onDoubleClick}
              onContextMenu={onContextMenu}
            >
              {hover && !ui.selection.includes(hover) && byId.get(hover) && <HoverBox el={byId.get(hover)!} scale={scale} />}
              {selected.map((s) => (s.type === 'line' ? null : <RotBox key={s.id} el={s} scale={scale} dashed={Boolean(s.groupId)} />))}
              {selBox && selected.length > 1 && <div className="sel-box group" style={{ left: selBox.x * scale - 1, top: selBox.y * scale - 1, width: selBox.w * scale + 2, height: selBox.h * scale + 2, borderColor: 'var(--select)', opacity: 0.6 }} />}
              {selBox && !editing && !ui.painter && !(single?.type === 'line') && !selected.every((s) => s.locked) && (
                <>
                  {HANDLES.map((h) => {
                    const hx = h.includes('w') ? selBox.x : h.includes('e') ? selBox.x + selBox.w : selBox.x + selBox.w / 2;
                    const hy = h.includes('n') ? selBox.y : h.includes('s') ? selBox.y + selBox.h : selBox.y + selBox.h / 2;
                    if (single && single.rotation) return null;
                    return <div key={h} className="handle" data-handle={h} style={{ left: hx * scale, top: hy * scale, cursor: CURSORS[h] }} onPointerDown={(e) => startHandle(e, h)} onPointerMove={onPointerMove} onPointerUp={onPointerUp} />;
                  })}
                  {single && single.rotation !== 0 && <RotatedHandles el={single} scale={scale} onDown={startHandle} onMove={onPointerMove} onUp={onPointerUp} />}
                  <div className="handle rot" data-handle="rot" style={{ left: (selBox.x + selBox.w / 2) * scale, top: selBox.y * scale - 26 }} onPointerDown={(e) => startHandle(e, 'rot')} onPointerMove={onPointerMove} onPointerUp={onPointerUp} title="Rotate (Shift snaps to 15°)" />
                </>
              )}
              {single?.type === 'line' && !editing && !ui.painter && (() => {
                const l = resolveConnector(single, byId);
                return ([1, 2] as const).map((end) => (
                  <div
                    key={end}
                    className="handle pt"
                    style={{ left: (end === 1 ? l.x1 : l.x2) * scale, top: (end === 1 ? l.y1 : l.y2) * scale }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      (e.target as Element).setPointerCapture(e.pointerId);
                      setDrag({ kind: 'endpoint', id: single.id, end, orig: single });
                    }}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                  />
                ));
              })()}
              {guides.map((g, i) =>
                g.axis === 'x' ? (
                  <div key={i} className="guide" style={{ left: g.pos * scale, top: g.from * scale, width: 1, height: (g.to - g.from) * scale }} />
                ) : (
                  <div key={i} className={`guide ${g.kind === 'spacing' ? 'spacing' : ''}`} style={{ top: g.pos * scale, left: g.from * scale, height: 1, width: (g.to - g.from) * scale }}>
                    {g.label && <span className="guide-label" style={{ left: ((g.to - g.from) * scale) / 2 }}>{g.label}</span>}
                  </div>
                ),
              )}
              {drag?.kind === 'marquee' && <div className="marquee" style={{ left: Math.min(drag.start.x, drag.cur.x) * scale, top: Math.min(drag.start.y, drag.cur.y) * scale, width: Math.abs(drag.cur.x - drag.start.x) * scale, height: Math.abs(drag.cur.y - drag.start.y) * scale }} />}
              {drag?.kind === 'create' && (drag.tool === 'line' ? (
                <svg className="overlay" width={sw} height={sh}><line x1={drag.start.x * scale} y1={drag.start.y * scale} x2={drag.cur.x * scale} y2={drag.cur.y * scale} stroke="var(--select)" strokeWidth={2} /></svg>
              ) : (
                <div className="marquee" style={{ left: Math.min(drag.start.x, drag.cur.x) * scale, top: Math.min(drag.start.y, drag.cur.y) * scale, width: Math.abs(drag.cur.x - drag.start.x) * scale, height: Math.abs(drag.cur.y - drag.start.y) * scale, borderRadius: drag.tool === 'shape' && ui.shapeKind === 'ellipse' ? '50%' : 0 }} />
              ))}
              {(drag?.kind === 'resize' || drag?.kind === 'rotate' || (drag?.kind === 'move' && drag.moved)) && selBox && (
                <div className="size-tip" style={{ left: (selBox.x + selBox.w / 2) * scale, top: (selBox.y + selBox.h) * scale }}>
                  {drag.kind === 'rotate' ? `${Math.round(single?.rotation ?? 0)}°` : drag.kind === 'move' ? `${Math.round(selBox.x)}, ${Math.round(selBox.y)}` : `${Math.round(selBox.w)} × ${Math.round(selBox.h)}`}
                </div>
              )}
              {remote.map((r) => (
                <div key={r.id} className="remote-cursor" style={{ transform: `translate(${r.x * scale}px, ${r.y * scale}px)` }}>
                  <svg width="16" height="18" viewBox="0 0 16 18"><path d="M1 1l13 7-6 1.5L5 16z" fill={r.color} stroke="#000" strokeOpacity=".3" /></svg>
                  <span style={{ background: r.color }}>{r.name}</span>
                </div>
              ))}
            </div>
            {editing && (editing.type === 'text' || editing.type === 'shape') && (
              <TextEditor key={editing.id} store={store} el={editing} scale={scale} onCommit={commitEditing} />
            )}
            {cellEdit && byId.get(cellEdit.id)?.type === 'table' && <CellEditor store={store} el={byId.get(cellEdit.id) as Extract<SlideElement, { type: 'table' }>} r={cellEdit.r} c={cellEdit.c} scale={scale} onDone={() => setCellEdit(null)} onMove={(r, c) => setCellEdit({ id: cellEdit.id, r, c })} />}
            {selBox && !drag && !ui.readOnly && !ui.painter && selected.length > 0 && <ContextBar store={store} anchor={{ x: selBox.x * scale, y: selBox.y * scale, w: selBox.w * scale, h: selBox.h * scale }} hostHeight={sh} />}
          </div>
        </div>
      </div>
      {ui.painter && <div className="painter-hint" role="status"><Icon name="brush" /> Click an object to apply the style{ui.painter.sticky ? ' · stays on until Esc' : ''}</div>}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems()} onClose={() => setMenu(null)} label={store.selected.length ? 'Object actions' : 'Slide actions'} />}
    </div>
  );
}

function constrain(a: Pt, b: Pt, line: boolean): Pt {
  const dx = b.x - a.x, dy = b.y - a.y;
  if (line) {
    const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    const len = Math.hypot(dx, dy);
    return { x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len };
  }
  const s = Math.max(Math.abs(dx), Math.abs(dy));
  return { x: a.x + Math.sign(dx || 1) * s, y: a.y + Math.sign(dy || 1) * s };
}

export function isTyping(e: KeyboardEvent | Event): boolean {
  const t = e.target as HTMLElement | null;
  return Boolean(t && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT'));
}

function RotBox({ el, scale, dashed }: { el: SlideElement; scale: number; dashed: boolean }) {
  return <div className={`sel-box ${dashed ? 'group' : ''}`} style={{ left: el.x * scale, top: el.y * scale, width: el.w * scale, height: el.h * scale, transform: `rotate(${el.rotation}deg)`, outline: el.locked ? '1px dashed var(--danger)' : undefined }} />;
}

function HoverBox({ el, scale }: { el: SlideElement; scale: number }) {
  return <div className="hover-box" style={{ left: el.x * scale, top: el.y * scale, width: el.w * scale, height: el.h * scale, transform: `rotate(${el.rotation}deg)` }} />;
}

function RotatedHandles({ el, scale, onDown, onMove, onUp }: { el: SlideElement; scale: number; onDown: (e: RPE, h: string) => void; onMove: (e: RPE) => void; onUp: (e: RPE) => void }) {
  // For rotated elements, place corner handles on the rotated frame; resizing acts in the axis-aligned frame.
  const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
  const a = (el.rotation * Math.PI) / 180;
  const pt = (x: number, y: number) => ({ x: cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a), y: cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a) });
  const corners: [string, number, number][] = [['nw', el.x, el.y], ['ne', el.x + el.w, el.y], ['se', el.x + el.w, el.y + el.h], ['sw', el.x, el.y + el.h]];
  return (
    <>
      {corners.map(([h, x, y]) => {
        const p = pt(x, y);
        return <div key={h} className="handle" style={{ left: p.x * scale, top: p.y * scale, cursor: 'nwse-resize' }} onPointerDown={(e) => onDown(e, h)} onPointerMove={onMove} onPointerUp={onUp} />;
      })}
    </>
  );
}

function TextEditor({ store, el, scale, onCommit }: { store: EditorStore; el: Extract<SlideElement, { type: 'text' | 'shape' }>; scale: number; onCommit: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useLayoutEffect(() => {
    const d = ref.current!;
    d.innerHTML = toEditableHtml(el.paragraphs, el.style);
    d.focus();
    const r = document.createRange();
    r.selectNodeContents(d);
    const empty = el.paragraphs.every((p) => p.runs.every((x) => !x.text));
    if (!empty) {
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(r);
    }
    document.execCommand('styleWithCSS', false, 'true');
    return () => {
      clearTimeout(timer.current);
      onCommit();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const st = el.style;
  const justify = st.valign === 'middle' ? 'center' : st.valign === 'bottom' ? 'flex-end' : 'flex-start';
  return (
    <div style={{ position: 'absolute', left: el.x * scale, top: el.y * scale, width: el.w, height: el.h, transform: `scale(${scale}) rotate(${el.rotation}deg)`, transformOrigin: '0 0', display: 'flex', flexDirection: 'column', justifyContent: justify, padding: st.padding, boxSizing: 'border-box', outline: `${1.5 / scale}px solid var(--select)`, background: el.type === 'text' && el.fill.kind === 'solid' ? el.fill.color : undefined }}>
      <div
        ref={ref}
        data-text-editor
        className="text-editor deck-rich"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={`Edit ${el.name}`}
        spellCheck
        style={{ position: 'relative', minHeight: '1em', fontFamily: `"${st.font}", system-ui`, fontSize: st.size * (96 / 72), fontWeight: st.bold ? 700 : 400, fontStyle: st.italic ? 'italic' : 'normal', color: st.color, letterSpacing: `${st.letterSpacing}em`, lineHeight: st.lineHeight }}
        onInput={() => {
          clearTimeout(timer.current);
          timer.current = setTimeout(onCommit, 250);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onCommit();
            store.setUi({ editingId: null });
          }
          if (e.key === 'Tab') {
            e.preventDefault();
            const sel = window.getSelection();
            const p = sel?.anchorNode && (sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode.parentElement)?.closest('p');
            if (p) {
              const lvl = Math.max(0, Math.min(8, Number(p.getAttribute('data-level') ?? 0) + (e.shiftKey ? -1 : 1)));
              p.setAttribute('data-level', String(lvl));
              if (p.getAttribute('data-bullet') === 'none' && lvl > 0) p.setAttribute('data-bullet', 'bullet');
              onCommit();
            }
          }
          e.stopPropagation();
        }}
        onPaste={(e) => {
          // Paste as plain text: never import foreign markup into the document.
          e.preventDefault();
          const text = e.clipboardData.getData('text/plain');
          document.execCommand('insertText', false, text);
        }}
      />
    </div>
  );
}

function CellEditor({ store, el, r, c, scale, onDone, onMove }: { store: EditorStore; el: Extract<SlideElement, { type: 'table' }>; r: number; c: number; scale: number; onDone: () => void; onMove: (r: number, c: number) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const rowH = el.h / el.rows.length;
  const x = el.x + el.colWidths.slice(0, c).reduce((a, b) => a + b, 0) * el.w;
  const w = (el.colWidths[c] ?? 0) * el.w;
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, [r, c]);
  const set = (text: string) => store.updateElements([el.id], (e) => (e.type === 'table' ? { ...e, rows: e.rows.map((row, ri) => (ri === r ? row.map((cell, ci) => (ci === c ? { ...cell, text } : cell)) : row)) } : e), `cell:${el.id}:${r}:${c}`);
  return (
    <textarea
      ref={ref}
      aria-label={`Row ${r + 1}, column ${c + 1}`}
      defaultValue={el.rows[r]?.[c]?.text ?? ''}
      key={`${r}:${c}`}
      onChange={(e) => set(e.target.value)}
      onBlur={onDone}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') onDone();
        if (e.key === 'Tab') {
          e.preventDefault();
          const cols = el.rows[0]!.length;
          let idx = r * cols + c + (e.shiftKey ? -1 : 1);
          if (idx >= el.rows.length * cols) {
            store.updateElements([el.id], (t) => (t.type === 'table' ? { ...t, rows: [...t.rows, t.rows[0]!.map(() => ({ text: '' }))], h: t.h + t.h / t.rows.length } : t));
          }
          idx = Math.max(0, idx);
          onMove(Math.floor(idx / cols), idx % cols);
        }
      }}
      style={{ position: 'absolute', left: x * scale, top: (el.y + r * rowH) * scale, width: w * scale, height: rowH * scale, fontSize: el.style.size * (96 / 72) * scale, fontFamily: `"${el.style.font}"`, padding: `0 ${8 * scale}px`, border: '2px solid var(--select)', background: 'var(--raised)', color: 'var(--ink)', resize: 'none', zIndex: 30 }}
    />
  );
}
