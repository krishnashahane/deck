import type { Fill, Shadow, SlideElement, Stroke, TableElement, TextRun, TextStyle } from './model';

/**
 * Format painter: copy the look of one object and apply it to others.
 * Only appearance is transferred — never content, position, size, links or ids —
 * and only properties the target type actually has.
 */
export interface StyleSnapshot {
  from: SlideElement['type'];
  opacity: number;
  fill?: Fill;
  stroke?: Stroke | null;
  shadow?: Shadow | null;
  cornerRadius?: number;
  text?: TextStyle;
  /** Character formatting of the first run (bold, colour, highlight…), applied uniformly. */
  run?: Omit<TextRun, 'text' | 'link'>;
  table?: TableElement['style'];
  line?: { startArrow: 'none' | 'arrow' | 'dot'; endArrow: 'none' | 'arrow' | 'dot'; curve: 'straight' | 'elbow' | 'curved' };
  color?: string;
  mask?: 'none' | 'circle' | 'rounded';
}

const clone = <T>(v: T): T => (v === undefined || v === null ? v : structuredClone(v));

export function copyStyle(el: SlideElement): StyleSnapshot {
  const s: StyleSnapshot = { from: el.type, opacity: el.opacity };
  switch (el.type) {
    case 'text':
    case 'shape': {
      s.fill = clone(el.fill);
      s.stroke = clone(el.stroke);
      s.text = clone(el.style);
      const r = el.paragraphs[0]?.runs[0];
      if (r) {
        const { text: _t, link: _l, ...rest } = r;
        s.run = rest;
      }
      if (el.type === 'shape') {
        s.shadow = clone(el.shadow);
        s.cornerRadius = el.cornerRadius;
      }
      break;
    }
    case 'image':
      s.stroke = clone(el.stroke);
      s.shadow = clone(el.shadow);
      s.mask = el.mask;
      break;
    case 'line':
      s.stroke = clone(el.stroke);
      s.line = { startArrow: el.startArrow, endArrow: el.endArrow, curve: el.curve };
      break;
    case 'table':
      s.table = clone(el.style);
      break;
    case 'equation':
      s.color = el.color;
      break;
  }
  return s;
}

/** Returns the element with the snapshot's appearance applied (the input is not modified). */
export function pasteStyle(el: SlideElement, s: StyleSnapshot): SlideElement {
  const base = { ...el, opacity: s.opacity };
  switch (base.type) {
    case 'text':
    case 'shape': {
      let out = { ...base };
      if (s.fill) out.fill = clone(s.fill);
      if (s.stroke !== undefined) out.stroke = s.stroke ? clone(s.stroke) : null;
      if (s.text) out.style = clone(s.text);
      if (s.run || s.text) {
        // Uniform formatting: drop per-run overrides, then apply the source's character formatting.
        out.paragraphs = out.paragraphs.map((p) => ({ ...p, runs: p.runs.map((r) => ({ text: r.text, ...(r.link ? { link: r.link } : {}), ...(s.run ?? {}) })) }));
      }
      if (out.type === 'shape') {
        if (s.shadow !== undefined) out = { ...out, shadow: s.shadow ? clone(s.shadow) : null };
        if (s.cornerRadius !== undefined) out = { ...out, cornerRadius: s.cornerRadius };
      }
      return out;
    }
    case 'image': {
      const out = { ...base };
      if (s.stroke !== undefined) out.stroke = s.stroke ? clone(s.stroke) : null;
      if (s.shadow !== undefined) out.shadow = s.shadow ? clone(s.shadow) : null;
      if (s.mask) out.mask = s.mask;
      return out;
    }
    case 'line': {
      const out = { ...base };
      if (s.stroke) out.stroke = clone(s.stroke);
      if (s.line) Object.assign(out, s.line);
      return out;
    }
    case 'table':
      return s.table ? { ...base, style: clone(s.table) } : base;
    case 'equation': {
      const color = s.color ?? s.text?.color ?? s.run?.color;
      return color ? { ...base, color } : base;
    }
    default:
      return base;
  }
}
