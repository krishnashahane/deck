import { uid } from './factory';
import type { Fill, Paragraph, Presentation, Slide, SlideElement, Theme } from './model';

/* ───────────── geometry ───────────── */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function bounds(els: Box[]): Box {
  if (!els.length) return { x: 0, y: 0, w: 0, h: 0 };
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const e of els) {
    x1 = Math.min(x1, e.x);
    y1 = Math.min(y1, e.y);
    x2 = Math.max(x2, e.x + e.w);
    y2 = Math.max(y2, e.y + e.h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** Axis-aligned bounds of a rotated box. */
export function rotatedBounds(b: Box & { rotation: number }): Box {
  if (!b.rotation) return { x: b.x, y: b.y, w: b.w, h: b.h };
  const r = (b.rotation * Math.PI) / 180;
  const c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r));
  const w = b.w * c + b.h * s;
  const h = b.w * s + b.h * c;
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/* ───────────── alignment & distribution ───────────── */

export type AlignMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

/** Align elements to their selection bounds, or to the slide when a single element is selected. */
export function align(els: SlideElement[], mode: AlignMode, slide: { width: number; height: number }): SlideElement[] {
  const ref = els.length === 1 ? { x: 0, y: 0, w: slide.width, h: slide.height } : bounds(els);
  return els.map((e) => {
    const n = { ...e };
    switch (mode) {
      case 'left': n.x = ref.x; break;
      case 'center': n.x = ref.x + (ref.w - e.w) / 2; break;
      case 'right': n.x = ref.x + ref.w - e.w; break;
      case 'top': n.y = ref.y; break;
      case 'middle': n.y = ref.y + (ref.h - e.h) / 2; break;
      case 'bottom': n.y = ref.y + ref.h - e.h; break;
    }
    return moveLineWith(e, n);
  });
}

/** Distribute so the gaps between consecutive elements are equal. */
export function distribute(els: SlideElement[], axis: 'h' | 'v'): SlideElement[] {
  if (els.length < 3) return els;
  const key = axis === 'h' ? 'x' : 'y';
  const size = axis === 'h' ? 'w' : 'h';
  const sorted = [...els].sort((a, b) => a[key] - b[key]);
  const first = sorted[0]!, last = sorted[sorted.length - 1]!;
  const span = last[key] + last[size] - first[key];
  const total = sorted.reduce((s, e) => s + e[size], 0);
  const gap = (span - total) / (sorted.length - 1);
  let cur = first[key];
  const out = new Map<string, SlideElement>();
  for (const e of sorted) {
    const n = { ...e, [key]: cur } as SlideElement;
    out.set(e.id, moveLineWith(e, n));
    cur += e[size] + gap;
  }
  return els.map((e) => out.get(e.id)!);
}

/** Keep line endpoints consistent when the bounding box is moved. */
export function moveLineWith(prev: SlideElement, next: SlideElement): SlideElement {
  if (prev.type !== 'line' || next.type !== 'line') return next;
  const dx = next.x - prev.x, dy = next.y - prev.y;
  if (!dx && !dy) return next;
  return { ...next, x1: prev.x1 + dx, y1: prev.y1 + dy, x2: prev.x2 + dx, y2: prev.y2 + dy };
}

/** Scale a line's endpoints into a new bounding box. */
export function resizeLine(prev: SlideElement, next: SlideElement): SlideElement {
  if (prev.type !== 'line' || next.type !== 'line') return next;
  const sx = prev.w ? next.w / prev.w : 1, sy = prev.h ? next.h / prev.h : 1;
  const map = (x: number, y: number) => [next.x + (x - prev.x) * sx, next.y + (y - prev.y) * sy] as const;
  const [x1, y1] = map(prev.x1, prev.y1);
  const [x2, y2] = map(prev.x2, prev.y2);
  return { ...next, x1, y1, x2, y2 };
}

/* ───────────── z-order ───────────── */

export type ZOp = 'front' | 'back' | 'forward' | 'backward';

export function reorder(slide: Slide, ids: Set<string>, op: ZOp): SlideElement[] {
  const els = [...slide.elements];
  const sel = els.filter((e) => ids.has(e.id));
  const rest = els.filter((e) => !ids.has(e.id));
  if (op === 'front') return [...rest, ...sel];
  if (op === 'back') return [...sel, ...rest];
  if (op === 'forward') {
    for (let i = els.length - 2; i >= 0; i--) {
      if (ids.has(els[i]!.id) && !ids.has(els[i + 1]!.id)) [els[i], els[i + 1]] = [els[i + 1]!, els[i]!];
    }
    return els;
  }
  for (let i = 1; i < els.length; i++) {
    if (ids.has(els[i]!.id) && !ids.has(els[i - 1]!.id)) [els[i], els[i - 1]] = [els[i - 1]!, els[i]!];
  }
  return els;
}

/* ───────────── grouping ───────────── */

export function group(slide: Slide, ids: Set<string>): Slide {
  if (ids.size < 2) return slide;
  const gid = uid('gr');
  return { ...slide, elements: slide.elements.map((e) => (ids.has(e.id) ? { ...e, groupId: gid } : e)) };
}

export function ungroup(slide: Slide, ids: Set<string>): Slide {
  const groups = new Set(slide.elements.filter((e) => ids.has(e.id) && e.groupId).map((e) => e.groupId));
  return {
    ...slide,
    elements: slide.elements.map((e) => (e.groupId && groups.has(e.groupId) ? { ...e, groupId: undefined } : e)),
  };
}

/** Expand a selection so whole groups are selected together. */
export function expandToGroups(slide: Slide, ids: Iterable<string>): Set<string> {
  const set = new Set(ids);
  const groups = new Set(slide.elements.filter((e) => set.has(e.id) && e.groupId).map((e) => e.groupId));
  for (const e of slide.elements) if (e.groupId && groups.has(e.groupId)) set.add(e.id);
  return set;
}

/* ───────────── snapping & smart guides ───────────── */

export interface Guide {
  axis: 'x' | 'y';
  pos: number;
  /** Extent of the guide line along the other axis. */
  from: number;
  to: number;
  kind: 'edge' | 'center' | 'slide' | 'spacing';
  label?: string;
}

export interface SnapResult {
  dx: number;
  dy: number;
  guides: Guide[];
}

/**
 * Snap a moving box against slide edges/centre, other elements' edges and
 * centres, and an optional grid. Returns the correction and guides to draw.
 */
export function snap(moving: Box, others: Box[], slide: { width: number; height: number }, opts: { threshold: number; grid?: number }): SnapResult {
  const t = opts.threshold;
  const xs = [moving.x, moving.x + moving.w / 2, moving.x + moving.w];
  const ys = [moving.y, moving.y + moving.h / 2, moving.y + moving.h];
  type Cand = { pos: number; kind: Guide['kind']; box?: Box };
  const cx: Cand[] = [
    { pos: 0, kind: 'slide' },
    { pos: slide.width / 2, kind: 'slide' },
    { pos: slide.width, kind: 'slide' },
  ];
  const cy: Cand[] = [
    { pos: 0, kind: 'slide' },
    { pos: slide.height / 2, kind: 'slide' },
    { pos: slide.height, kind: 'slide' },
  ];
  for (const o of others) {
    cx.push({ pos: o.x, kind: 'edge', box: o }, { pos: o.x + o.w / 2, kind: 'center', box: o }, { pos: o.x + o.w, kind: 'edge', box: o });
    cy.push({ pos: o.y, kind: 'edge', box: o }, { pos: o.y + o.h / 2, kind: 'center', box: o }, { pos: o.y + o.h, kind: 'edge', box: o });
  }
  const best = (vals: number[], cands: Cand[]) => {
    let d = Infinity;
    let hit: { delta: number; cand: Cand } | null = null;
    for (const v of vals) for (const c of cands) {
      const delta = c.pos - v;
      if (Math.abs(delta) <= t && Math.abs(delta) < d) {
        d = Math.abs(delta);
        hit = { delta, cand: c };
      }
    }
    return hit;
  };
  const bx = best(xs, cx);
  const by = best(ys, cy);
  let dx = bx?.delta ?? 0;
  let dy = by?.delta ?? 0;
  if (!bx && opts.grid) {
    const g = opts.grid;
    const r = Math.round(moving.x / g) * g - moving.x;
    if (Math.abs(r) <= t) dx = r;
  }
  if (!by && opts.grid) {
    const g = opts.grid;
    const r = Math.round(moving.y / g) * g - moving.y;
    if (Math.abs(r) <= t) dy = r;
  }
  const guides: Guide[] = [];
  const m = { x: moving.x + dx, y: moving.y + dy, w: moving.w, h: moving.h };
  if (bx) {
    const b = bx.cand.box;
    guides.push({
      axis: 'x',
      pos: bx.cand.pos,
      from: b ? Math.min(b.y, m.y) : 0,
      to: b ? Math.max(b.y + b.h, m.y + m.h) : slide.height,
      kind: bx.cand.kind,
    });
  }
  if (by) {
    const b = by.cand.box;
    guides.push({
      axis: 'y',
      pos: by.cand.pos,
      from: b ? Math.min(b.x, m.x) : 0,
      to: b ? Math.max(b.x + b.w, m.x + m.w) : slide.width,
      kind: by.cand.kind,
    });
  }
  // Equal-spacing hints: show distance to the nearest neighbour on each side.
  for (const o of others) {
    const overlapY = o.y < m.y + m.h && o.y + o.h > m.y;
    if (overlapY) {
      const gap = o.x >= m.x + m.w ? o.x - (m.x + m.w) : m.x >= o.x + o.w ? m.x - (o.x + o.w) : -1;
      if (gap > 0 && gap < 400) {
        const y = Math.max(m.y, o.y) + (Math.min(m.y + m.h, o.y + o.h) - Math.max(m.y, o.y)) / 2;
        const from = o.x >= m.x + m.w ? m.x + m.w : o.x + o.w;
        guides.push({ axis: 'y', pos: y, from, to: from + gap, kind: 'spacing', label: `${Math.round(gap)}` });
      }
    }
  }
  return { dx, dy, guides: guides.slice(0, 6) };
}

/* ───────────── themes ───────────── */

/**
 * Re-theme a presentation: every colour that equals a colour of the old theme
 * is mapped to the matching slot of the new theme; heading/body fonts are
 * swapped likewise. Colours the user picked manually are preserved.
 */
export function applyTheme(pres: Presentation, next: Theme): Presentation {
  const prev = pres.theme;
  const colorMap = new Map<string, string>();
  for (const k of Object.keys(prev.colors) as (keyof Theme['colors'])[]) {
    colorMap.set(prev.colors[k].toLowerCase(), next.colors[k]);
  }
  const fontMap = new Map<string, string>([
    [prev.fonts.heading, next.fonts.heading],
    [prev.fonts.body, next.fonts.body],
    [prev.fonts.mono, next.fonts.mono],
  ]);
  const c = (v: string | undefined) => (v ? colorMap.get(v.toLowerCase()) ?? v : v);
  const f = (v: string | undefined) => (v ? fontMap.get(v) ?? v : v);
  const fill = (x: Fill | null): Fill | null => {
    if (!x) return x;
    if (x.kind === 'solid') return { ...x, color: c(x.color)! };
    if (x.kind === 'linear' || x.kind === 'radial') return { ...x, stops: x.stops.map((s) => ({ ...s, color: c(s.color)! })) };
    return x;
  };
  const paras = (ps: Paragraph[]) => ps.map((p) => ({ ...p, runs: p.runs.map((r) => ({ ...r, color: c(r.color), font: f(r.font) })) }));
  const el = (e: SlideElement): SlideElement => {
    switch (e.type) {
      case 'text':
      case 'shape': {
        const base = { ...e, paragraphs: paras(e.paragraphs), style: { ...e.style, color: c(e.style.color)!, font: f(e.style.font)! }, fill: fill(e.fill)!, stroke: e.stroke && { ...e.stroke, color: c(e.stroke.color)! } };
        return base as SlideElement;
      }
      case 'line':
        return { ...e, stroke: { ...e.stroke, color: c(e.stroke.color)! } };
      case 'table':
        return { ...e, style: { ...e.style, color: c(e.style.color)!, border: c(e.style.border)!, headerFill: c(e.style.headerFill)!, bandFill: c(e.style.bandFill)!, font: f(e.style.font)! }, rows: e.rows.map((r) => r.map((cell) => ({ ...cell, fill: c(cell.fill), color: c(cell.color) }))) };
      case 'chart':
        return { ...e, style: { ...e.style, color: c(e.style.color)!, grid: c(e.style.grid)!, font: f(e.style.font)! }, series: e.series.map((s) => ({ ...s, color: c(s.color) })) };
      case 'equation':
        return { ...e, color: c(e.color)! };
      default:
        return e;
    }
  };
  return {
    ...pres,
    theme: structuredClone(next),
    slides: pres.slides.map((s) => ({ ...s, background: fill(s.background), elements: s.elements.map(el) })),
  };
}

/* ───────────── content analysis (deterministic, no AI) ───────────── */

export interface SlideIssue {
  slideId: string;
  elementId?: string;
  severity: 'info' | 'warn';
  code: 'overcrowded' | 'small-text' | 'off-slide' | 'low-contrast' | 'too-many-fonts' | 'empty-slide' | 'missing-alt';
  message: string;
}

export function analyzeSlide(slide: Slide, pres: Pick<Presentation, 'width' | 'height' | 'theme'>): SlideIssue[] {
  const issues: SlideIssue[] = [];
  let words = 0;
  const fonts = new Set<string>();
  for (const e of slide.elements) {
    if (e.type === 'text' || e.type === 'shape') {
      const text = e.paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join(' ');
      words += text.split(/\s+/).filter(Boolean).length;
      fonts.add(e.style.font);
      for (const p of e.paragraphs) for (const r of p.runs) if (r.font) fonts.add(r.font);
      const minSize = Math.min(e.style.size, ...e.paragraphs.flatMap((p) => p.runs.map((r) => r.size ?? e.style.size)));
      if (text.trim() && minSize < 14) issues.push({ slideId: slide.id, elementId: e.id, severity: 'warn', code: 'small-text', message: `Text at ${minSize}pt may be unreadable when projected (aim for ≥ 18pt).` });
      const bg = slide.background?.kind === 'solid' ? slide.background.color : pres.theme.colors.background;
      const fg = e.style.color;
      if (text.trim() && e.fill.kind === 'none' && contrast(fg, bg) < 3) issues.push({ slideId: slide.id, elementId: e.id, severity: 'warn', code: 'low-contrast', message: `Contrast ratio ${contrast(fg, bg).toFixed(1)}:1 is below 3:1.` });
    }
    if (e.type === 'image' && !e.alt) issues.push({ slideId: slide.id, elementId: e.id, severity: 'info', code: 'missing-alt', message: 'Image has no alternative text.' });
    if (e.x + e.w < 0 || e.y + e.h < 0 || e.x > pres.width || e.y > pres.height) issues.push({ slideId: slide.id, elementId: e.id, severity: 'info', code: 'off-slide', message: `“${e.name}” is outside the slide.` });
  }
  if (words > 90) issues.push({ slideId: slide.id, severity: 'warn', code: 'overcrowded', message: `${words} words on one slide. Consider splitting or moving detail to speaker notes.` });
  if (slide.elements.length > 25) issues.push({ slideId: slide.id, severity: 'warn', code: 'overcrowded', message: `${slide.elements.length} objects on one slide.` });
  if (fonts.size > 3) issues.push({ slideId: slide.id, severity: 'info', code: 'too-many-fonts', message: `${fonts.size} different fonts on this slide.` });
  if (!slide.elements.length) issues.push({ slideId: slide.id, severity: 'info', code: 'empty-slide', message: 'Slide is empty.' });
  return issues;
}

function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0.5;
  const n = parseInt(m[1]!, 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}

export function contrast(a: string, b: string): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
