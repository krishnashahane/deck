import { UNITS_PER_POINT, safeHref, type Paragraph, type TextRun, type TextStyle } from '@deck/core';

/* Values from the document (imports, collaborators) are untrusted: validate before they enter markup. */
export const safeColor = (c: unknown): string | null => (typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c.trim()) ? c.trim() : null);
export const safeNum = (v: unknown, d: number, min = -1e6, max = 1e6): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
};
export const safeFont = (f: unknown): string | null => (typeof f === 'string' && f.length < 100 ? f.replace(/[^\p{L}\p{N} _.-]/gu, '') : null);
const ALIGNS = new Set(['left', 'center', 'right', 'justify']);
const safeAlign = (a: unknown, d: string) => (typeof a === 'string' && ALIGNS.has(a) ? a : d);
const safeBullet = (b: unknown) => (b === 'bullet' || b === 'number' ? b : 'none');

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Paragraphs → editable HTML. Paragraph properties live in data-attributes so the browser carries them across Enter. */
export function toEditableHtml(paragraphs: Paragraph[], style: TextStyle): string {
  return paragraphs
    .map((p) => {
      const size = safeNum(p.runs[0]?.size ?? style.size, 24, 1, 2000) * UNITS_PER_POINT;
      const lh = p.lineHeight !== undefined ? safeNum(p.lineHeight, 1.2, 0.1, 10) : undefined;
      const sb = safeNum(p.spaceBefore ?? 0, 0, 0, 1000), sa = safeNum(p.spaceAfter ?? 0, 0, 0, 1000);
      const align = p.align ? safeAlign(p.align, 'left') : undefined;
      const attrs = [
        `data-bullet="${safeBullet(p.bullet)}"`,
        `data-level="${safeNum(p.level ?? 0, 0, 0, 8)}"`,
        lh ? `data-lh="${lh}"` : '',
        sb ? `data-sb="${sb}"` : '',
        sa ? `data-sa="${sa}"` : '',
        align ? `data-align="${align}"` : '',
      ].filter(Boolean).join(' ');
      const css = [
        `text-align:${align ?? safeAlign(style.align, 'left')}`,
        `line-height:${lh ?? safeNum(style.lineHeight, 1.2, 0.1, 10)}`,
        `margin:${sb * UNITS_PER_POINT}px 0 ${sa * UNITS_PER_POINT}px`,
        `--ind:${size * 1.1}px`,
      ].join(';');
      const runs = p.runs.filter((r) => r.text).map((r) => {
        const s: string[] = [];
        if (r.bold !== undefined) s.push(`font-weight:${r.bold ? 700 : 400}`);
        if (r.italic !== undefined) s.push(`font-style:${r.italic ? 'italic' : 'normal'}`);
        const deco = [r.underline && 'underline', r.strike && 'line-through'].filter(Boolean).join(' ');
        if (deco) s.push(`text-decoration:${deco}`);
        const color = safeColor(r.color), hl = safeColor(r.highlight), font = safeFont(r.font);
        if (color) s.push(`color:${color}`);
        if (r.size) s.push(`font-size:${safeNum(r.size, 24, 1, 2000) * UNITS_PER_POINT}px`);
        if (font) s.push(`font-family:'${font}'`);
        if (hl) s.push(`background-color:${hl}`);
        const href = r.link ? safeHref(r.link) : null;
        const link = href ? ` data-link="${esc(href)}"` : '';
        return `<span style="${esc(s.join(';'))}"${link}>${esc(String(r.text)).replace(/\n/g, '<br>')}</span>`;
      }).join('');
      return `<p ${attrs} style="${css}">${runs || '<br>'}</p>`;
    })
    .join('');
}

function rgbToHex(c: string): string | undefined {
  if (!c) return undefined;
  if (c.startsWith('#')) return c.length === 4 ? `#${[...c.slice(1)].map((x) => x + x).join('')}` : c;
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(c);
  if (!m) return undefined;
  const hex = '#' + [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('');
  const a = m[4] !== undefined ? Number(m[4]) : 1;
  if (a === 0) return undefined;
  return a < 1 ? hex + Math.round(a * 255).toString(16).padStart(2, '0') : hex;
}

interface Fmt {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string;
  size?: number;
  font?: string;
  highlight?: string;
  link?: string;
}

function fmtOf(el: HTMLElement, inherited: Fmt): Fmt {
  const f = { ...inherited };
  const tag = el.tagName;
  if (tag === 'B' || tag === 'STRONG') f.bold = true;
  if (tag === 'I' || tag === 'EM') f.italic = true;
  if (tag === 'U') f.underline = true;
  if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') f.strike = true;
  if (tag === 'FONT') {
    const c = el.getAttribute('color');
    if (c) f.color = rgbToHex(c) ?? c;
    const face = el.getAttribute('face');
    if (face) f.font = face.replace(/["']/g, '').split(',')[0]!.trim();
  }
  if (tag === 'A') {
    const h = el.getAttribute('href');
    if (h) f.link = h;
  }
  const st = el.style;
  if (st.fontWeight) f.bold = st.fontWeight === 'bold' || Number(st.fontWeight) >= 600;
  if (st.fontStyle) f.italic = st.fontStyle === 'italic';
  const deco = st.textDecorationLine || st.textDecoration;
  if (deco) {
    if (deco.includes('underline')) f.underline = true;
    if (deco.includes('line-through')) f.strike = true;
    if (deco === 'none') {
      f.underline = false;
      f.strike = false;
    }
  }
  if (st.color) f.color = rgbToHex(st.color);
  if (st.fontSize && st.fontSize.endsWith('px')) f.size = Math.round((parseFloat(st.fontSize) / UNITS_PER_POINT) * 10) / 10;
  if (st.fontFamily) f.font = st.fontFamily.replace(/["']/g, '').split(',')[0]!.trim();
  if (st.backgroundColor) f.highlight = rgbToHex(st.backgroundColor);
  const dl = el.getAttribute('data-link');
  if (dl) f.link = dl;
  return f;
}

/** Editable DOM → paragraphs. Values equal to the element style are dropped so element-level formatting keeps working. */
export function fromEditableDom(root: HTMLElement, style: TextStyle): Paragraph[] {
  const blocks: HTMLElement[] = [];
  const loose: Node[] = [];
  for (const n of Array.from(root.childNodes)) {
    if (n instanceof HTMLElement && (n.tagName === 'P' || n.tagName === 'DIV')) {
      if (loose.length) {
        const p = document.createElement('p');
        loose.splice(0).forEach((x) => p.appendChild(x.cloneNode(true)));
        blocks.push(p);
      }
      blocks.push(n);
    } else loose.push(n);
  }
  if (loose.length) {
    const p = document.createElement('p');
    loose.forEach((x) => p.appendChild(x.cloneNode(true)));
    blocks.push(p);
  }
  const paras: Paragraph[] = blocks.map((b) => {
    const runs: TextRun[] = [];
    const walk = (node: Node, f: Fmt) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = (node.textContent ?? '').replace(/​/g, '');
        if (text) runs.push(toRun(text, f, style));
        return;
      }
      if (!(node instanceof HTMLElement)) return;
      if (node.tagName === 'BR') {
        if (node !== node.parentElement?.lastChild || node.parentElement !== b) runs.push(toRun('\n', f, style));
        return;
      }
      if (node.getAttribute('contenteditable') === 'false') return;
      const nf = node === b ? f : fmtOf(node, f);
      node.childNodes.forEach((c) => walk(c, nf));
    };
    walk(b, {});
    const merged: TextRun[] = [];
    for (const r of runs) {
      const prev = merged[merged.length - 1];
      if (prev && sameFmt(prev, r)) prev.text += r.text;
      else merged.push(r);
    }
    while (merged.length && merged[merged.length - 1]!.text.endsWith('\n') && merged[merged.length - 1]!.text.length > 0 && merged.length > 0) {
      const last = merged[merged.length - 1]!;
      last.text = last.text.replace(/\n$/, '');
      if (!last.text) merged.pop();
      else break;
    }
    const p: Paragraph = { runs: merged.length ? merged : [{ text: '' }] };
    const bullet = b.getAttribute('data-bullet');
    if (bullet === 'bullet' || bullet === 'number') p.bullet = bullet;
    else p.bullet = 'none';
    const lvl = Number(b.getAttribute('data-level') ?? 0);
    if (lvl) p.level = lvl;
    const al = b.style.textAlign || b.getAttribute('data-align');
    if (al && al !== style.align && ['left', 'center', 'right', 'justify'].includes(al)) p.align = al as Paragraph['align'];
    const lh = b.getAttribute('data-lh');
    if (lh) p.lineHeight = Number(lh);
    const sb = b.getAttribute('data-sb');
    const sa = b.getAttribute('data-sa');
    if (sb) p.spaceBefore = Number(sb);
    if (sa) p.spaceAfter = Number(sa);
    return p;
  });
  return paras.length ? paras : [{ runs: [{ text: '' }] }];
}

function toRun(text: string, f: Fmt, style: TextStyle): TextRun {
  const r: TextRun = { text };
  if (f.bold !== undefined && f.bold !== Boolean(style.bold)) r.bold = f.bold;
  if (f.italic !== undefined && f.italic !== Boolean(style.italic)) r.italic = f.italic;
  if (f.underline) r.underline = true;
  if (f.strike) r.strike = true;
  if (f.color && f.color.toLowerCase() !== style.color.toLowerCase()) r.color = f.color;
  if (f.size && Math.abs(f.size - style.size) > 0.05) r.size = f.size;
  if (f.font && f.font !== style.font) r.font = f.font;
  if (f.highlight) r.highlight = f.highlight;
  if (f.link) r.link = f.link;
  return r;
}

function sameFmt(a: TextRun, b: TextRun) {
  return a.bold === b.bold && a.italic === b.italic && a.underline === b.underline && a.strike === b.strike && a.color === b.color && a.size === b.size && a.font === b.font && a.highlight === b.highlight && a.link === b.link;
}

/** Paragraph <p> elements touched by the current selection inside `root`. */
export function selectedBlocks(root: HTMLElement): HTMLElement[] {
  const sel = window.getSelection();
  const blocks = Array.from(root.children).filter((c): c is HTMLElement => c instanceof HTMLElement);
  if (!sel || !sel.rangeCount) return blocks;
  const range = sel.getRangeAt(0);
  const hit = blocks.filter((b) => range.intersectsNode(b));
  return hit.length ? hit : blocks;
}
