import type { Paragraph, Presentation, Slide, SlideElement, TableCell } from './model';

/**
 * Deck-wide find & replace.
 *
 * Text is matched per paragraph across run boundaries (a phrase split over bold and
 * plain runs is still found). A replacement takes the formatting of the run where the
 * match starts, and text from later runs inside the match is removed, so surrounding
 * formatting is preserved exactly.
 */

export interface FindOptions {
  matchCase?: boolean;
  wholeWord?: boolean;
  /** Also search speaker notes (default true). */
  notes?: boolean;
  /** Also search table cells (default true). */
  tables?: boolean;
  /** Also search chart titles, categories and series names (default true). */
  charts?: boolean;
  /** Also search alt text of images, media and shapes (default false). */
  altText?: boolean;
}

export type MatchPlace =
  | { kind: 'text'; elementId: string; paragraph: number }
  | { kind: 'cell'; elementId: string; row: number; col: number }
  | { kind: 'chart'; elementId: string; field: 'title' | 'category' | 'series'; index: number }
  | { kind: 'alt'; elementId: string }
  | { kind: 'notes' };

export interface FindMatch {
  /** Stable for a given document state; used to replace a single match. */
  key: string;
  slideId: string;
  slideIndex: number;
  place: MatchPlace;
  start: number;
  end: number;
  /** The element is locked; replacing skips it. */
  locked?: boolean;
  /** Short excerpt around the match for display: before / match / after. */
  context: [string, string, string];
}

const MAX_QUERY = 500;
const MAX_MATCHES = 5000;

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Builds the matcher; returns null for an empty or oversized query. */
export function findPattern(query: string, opts: FindOptions = {}): RegExp | null {
  if (!query || query.length > MAX_QUERY) return null;
  let src = escapeRe(query);
  // Word boundaries that understand Unicode letters/digits, not only ASCII.
  if (opts.wholeWord) src = `(?<![\\p{L}\\p{N}_])${src}(?![\\p{L}\\p{N}_])`;
  return new RegExp(src, `gu${opts.matchCase ? '' : 'i'}`);
}

function ranges(text: string, re: RegExp): [number, number][] {
  const out: [number, number][] = [];
  re.lastIndex = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m[0].length === 0) { re.lastIndex++; continue; }
    out.push([m.index, m.index + m[0].length]);
  }
  return out;
}

const paraText = (p: Paragraph) => p.runs.map((r) => r.text).join('');

function excerpt(text: string, s: number, e: number): [string, string, string] {
  const pre = text.slice(Math.max(0, s - 28), s);
  const post = text.slice(e, e + 40);
  return [(s > 28 ? '…' : '') + pre, text.slice(s, e), post + (e + 40 < text.length ? '…' : '')];
}

interface Field {
  place: MatchPlace;
  text: string;
  locked?: boolean;
}

function fieldsOf(slide: Slide, opts: FindOptions): Field[] {
  const out: Field[] = [];
  const visit = (el: SlideElement) => {
    const n = out.length;
    visitInner(el);
    if (el.locked) for (let i = n; i < out.length; i++) out[i]!.locked = true;
  };
  const visitInner = (el: SlideElement) => {
    if (el.type === 'text' || el.type === 'shape') {
      el.paragraphs.forEach((p, i) => out.push({ place: { kind: 'text', elementId: el.id, paragraph: i }, text: paraText(p) }));
    } else if (el.type === 'table' && opts.tables !== false) {
      el.rows.forEach((row, r) => row.forEach((c, col) => out.push({ place: { kind: 'cell', elementId: el.id, row: r, col }, text: c.text })));
    } else if (el.type === 'chart' && opts.charts !== false) {
      if (el.title) out.push({ place: { kind: 'chart', elementId: el.id, field: 'title', index: 0 }, text: el.title });
      el.categories.forEach((c, i) => out.push({ place: { kind: 'chart', elementId: el.id, field: 'category', index: i }, text: c }));
      el.series.forEach((s, i) => out.push({ place: { kind: 'chart', elementId: el.id, field: 'series', index: i }, text: s.name }));
    }
    if (opts.altText && el.type === 'image' && el.alt) out.push({ place: { kind: 'alt', elementId: el.id }, text: el.alt });
  };
  slide.elements.forEach(visit);
  if (opts.notes !== false && slide.notes) out.push({ place: { kind: 'notes' }, text: slide.notes });
  return out;
}

const placeKey = (p: MatchPlace) =>
  p.kind === 'text' ? `t:${p.elementId}:${p.paragraph}`
  : p.kind === 'cell' ? `c:${p.elementId}:${p.row}:${p.col}`
  : p.kind === 'chart' ? `h:${p.elementId}:${p.field}:${p.index}`
  : p.kind === 'alt' ? `a:${p.elementId}`
  : 'n';

/** All matches in document order (slides, then element stacking order, then notes). */
export function findInPresentation(pres: Presentation, query: string, opts: FindOptions = {}): FindMatch[] {
  const re = findPattern(query, opts);
  if (!re) return [];
  const out: FindMatch[] = [];
  pres.slides.forEach((slide, slideIndex) => {
    for (const f of fieldsOf(slide, opts)) {
      for (const [start, end] of ranges(f.text, re)) {
        if (out.length >= MAX_MATCHES) return;
        out.push({ key: `${slide.id}|${placeKey(f.place)}|${start}`, slideId: slide.id, slideIndex, place: f.place, start, end, context: excerpt(f.text, start, end), ...(f.locked ? { locked: true } : {}) });
      }
    }
  });
  return out;
}

/** Replace [s,e) ranges (sorted, non-overlapping) in a paragraph while keeping run formatting. */
function replaceInParagraph(p: Paragraph, hits: [number, number][], replacement: string): Paragraph {
  let runs = p.runs.map((r) => ({ ...r }));
  for (let h = hits.length - 1; h >= 0; h--) {
    const [s, e] = hits[h]!;
    let pos = 0;
    let placed = false;
    const next: typeof runs = [];
    for (const r of runs) {
      const rs = pos;
      const re = pos + r.text.length;
      pos = re;
      if (re <= s || rs >= e) { next.push(r); continue; }
      const text = r.text.slice(0, Math.max(0, s - rs)) + (placed ? '' : replacement) + r.text.slice(Math.min(r.text.length, e - rs));
      if (!placed || text.length) next.push({ ...r, text });
      placed = true;
    }
    runs = next.length ? next : [{ text: '' }];
  }
  return { ...p, runs };
}

function replaceInString(text: string, hits: [number, number][], replacement: string) {
  let out = text;
  for (let h = hits.length - 1; h >= 0; h--) {
    const [s, e] = hits[h]!;
    out = out.slice(0, s) + replacement + out.slice(e);
  }
  return out;
}

export interface ReplaceResult {
  presentation: Presentation;
  count: number;
}

/**
 * Replace matches. With `only`, replaces just the matches whose keys are listed
 * (keys from `findInPresentation` on the same document state); otherwise all.
 * Locked elements are left untouched (their matches are reported with `locked: true`).
 */
export function replaceInPresentation(pres: Presentation, query: string, replacement: string, opts: FindOptions = {}, only?: Iterable<string>): ReplaceResult {
  const matches = findInPresentation(pres, query, opts);
  const want = only ? new Set(only) : null;
  const byField = new Map<string, [number, number][]>();
  for (const m of matches) {
    if (want && !want.has(m.key)) continue;
    const fk = `${m.slideId}|${placeKey(m.place)}`;
    const list = byField.get(fk) ?? [];
    list.push([m.start, m.end]);
    byField.set(fk, list);
  }
  let count = 0;
  const repl = replacement.slice(0, 10_000);
  const slides = pres.slides.map((slide) => {
    const hitsFor = (p: MatchPlace) => byField.get(`${slide.id}|${placeKey(p)}`);
    let changed = false;
    const elements = slide.elements.map((el): SlideElement => {
      if (el.locked) return el;
      if (el.type === 'text' || el.type === 'shape') {
        let touched = false;
        const paragraphs = el.paragraphs.map((p, i) => {
          const hits = hitsFor({ kind: 'text', elementId: el.id, paragraph: i });
          if (!hits) return p;
          touched = true;
          count += hits.length;
          return replaceInParagraph(p, hits, repl);
        });
        if (!touched) return el;
        changed = true;
        return { ...el, paragraphs };
      }
      let next: SlideElement = el;
      if (el.type === 'table') {
        let touched = false;
        const rows = el.rows.map((row, r) => row.map((c, col): TableCell => {
          const hits = hitsFor({ kind: 'cell', elementId: el.id, row: r, col });
          if (!hits) return c;
          touched = true;
          count += hits.length;
          return { ...c, text: replaceInString(c.text, hits, repl) };
        }));
        if (touched) next = { ...el, rows };
      } else if (el.type === 'chart') {
        const th = hitsFor({ kind: 'chart', elementId: el.id, field: 'title', index: 0 });
        let ch = el;
        if (th && el.title) { ch = { ...ch, title: replaceInString(el.title, th, repl) }; count += th.length; }
        let catTouched = false;
        const categories = el.categories.map((c, i) => {
          const h = hitsFor({ kind: 'chart', elementId: el.id, field: 'category', index: i });
          if (!h) return c;
          catTouched = true; count += h.length;
          return replaceInString(c, h, repl);
        });
        let serTouched = false;
        const series = el.series.map((s, i) => {
          const h = hitsFor({ kind: 'chart', elementId: el.id, field: 'series', index: i });
          if (!h) return s;
          serTouched = true; count += h.length;
          return { ...s, name: replaceInString(s.name, h, repl) };
        });
        if (catTouched) ch = { ...ch, categories };
        if (serTouched) ch = { ...ch, series };
        next = ch;
      } else if (el.type === 'image') {
        const h = hitsFor({ kind: 'alt', elementId: el.id });
        if (h) { next = { ...el, alt: replaceInString(el.alt, h, repl) }; count += h.length; }
      }
      if (next !== el) changed = true;
      return next;
    });
    const noteHits = hitsFor({ kind: 'notes' });
    const notes = noteHits ? replaceInString(slide.notes, noteHits, repl) : slide.notes;
    if (noteHits) { count += noteHits.length; changed = true; }
    return changed ? { ...slide, elements, notes } : slide;
  });
  return { presentation: count ? { ...pres, slides } : pres, count };
}
