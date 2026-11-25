import { createAnimation, defaultTransition, uid } from '../factory';
import type {
  Animation,
  AnimationEffect,
  ChartElement,
  Fill,
  ImportWarning,
  LayoutId,
  Paragraph,
  Presentation,
  ShapeKind,
  Slide,
  SlideElement,
  Stroke,
  TableCell,
  TextRun,
  TextStyle,
  Theme,
  Transition,
} from '../model';
import { IMAGE_TYPES, MEDIA_TYPES, openZipSafely, sanitizeSvg, sniff, type SafeZip } from '../security';
import { THEMES } from '../themes';
import { attr, child, children, findAll, num, path, serialize, type XNode } from '../xml';
import { ANGLE, EMU, REL } from './ns';

export interface ImportResult {
  presentation: Presentation;
  assets: Record<string, Uint8Array>;
}

type Rel = { id: string; type: string; target: string; external: boolean };

/* ───────────── package helpers ───────────── */

function dirname(p: string) {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}

/** Resolve a relationship target relative to its source part, refusing to escape the package root. */
export function resolvePart(from: string, target: string): string | null {
  if (/^[a-z]+:/i.test(target)) return null;
  const parts = (target.startsWith('/') ? target.slice(1) : `${dirname(from)}/${target}`).split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (!p || p === '.') continue;
    if (p === '..') {
      if (!out.length) return null;
      out.pop();
    } else out.push(p);
  }
  return out.join('/');
}

async function readRels(zip: SafeZip, part: string): Promise<Map<string, Rel>> {
  const relPath = `${dirname(part) ? dirname(part) + '/' : ''}_rels/${part.split('/').pop()}.rels`;
  const x = await zip.xml(relPath);
  const map = new Map<string, Rel>();
  for (const r of findAll(x, 'Relationship')) {
    const external = attr(r, 'TargetMode') === 'External';
    const target = attr(r, 'Target') ?? '';
    map.set(attr(r, 'Id') ?? '', { id: attr(r, 'Id') ?? '', type: attr(r, 'Type') ?? '', target: external ? target : resolvePart(part, target) ?? '', external });
  }
  return map;
}

/* ───────────── colours ───────────── */

interface ColorCtx {
  scheme: Record<string, string>; // dk1, lt1, accent1 …
  map: Record<string, string>; // bg1 → lt1 …
}

const PRESET_COLORS: Record<string, string> = { black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00', gray: '808080', orange: 'FFA500' };

function hexToRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r: number, g: number, b: number) {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `${c(r)}${c(g)}${c(b)}`.toUpperCase();
}
function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function hslToRgb([h, s, l]: [number, number, number]): [number, number, number] {
  if (!s) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

/** Resolve a DrawingML colour element (srgbClr/schemeClr/sysClr/prstClr + modifiers) to #RRGGBB[AA]. */
function color(n: XNode | undefined, cc: ColorCtx, phClr?: string): string | undefined {
  if (!n) return undefined;
  const c = n.children.find((k) => ['a:srgbClr', 'a:schemeClr', 'a:sysClr', 'a:prstClr', 'a:scrgbClr', 'a:hslClr'].includes(k.name));
  if (!c) return undefined;
  let base: string | undefined;
  switch (c.name) {
    case 'a:srgbClr': base = attr(c, 'val'); break;
    case 'a:sysClr': base = attr(c, 'lastClr') ?? (attr(c, 'val') === 'window' ? 'FFFFFF' : '000000'); break;
    case 'a:prstClr': base = PRESET_COLORS[attr(c, 'val') ?? ''] ?? '000000'; break;
    case 'a:scrgbClr': base = rgbToHex((num(c, 'r') / 100000) * 255, (num(c, 'g') / 100000) * 255, (num(c, 'b') / 100000) * 255); break;
    case 'a:schemeClr': {
      const v = attr(c, 'val') ?? '';
      if (v === 'phClr') base = phClr?.replace('#', '');
      else base = cc.scheme[cc.map[v] ?? v];
      break;
    }
  }
  if (!base) return undefined;
  let rgb = hexToRgb(base);
  let a = 1;
  for (const m of c.children) {
    const v = num(m, 'val') / 100000;
    switch (m.name) {
      case 'a:lumMod': { const h = rgbToHsl(rgb); h[2] *= v; rgb = hslToRgb(h); break; }
      case 'a:lumOff': { const h = rgbToHsl(rgb); h[2] = Math.min(1, h[2] + v); rgb = hslToRgb(h); break; }
      case 'a:tint': rgb = rgb.map((x) => x + (255 - x) * (1 - v)) as typeof rgb; break;
      case 'a:shade': rgb = rgb.map((x) => x * v) as typeof rgb; break;
      case 'a:alpha': a = v; break;
    }
  }
  const hex = `#${rgbToHex(...rgb)}`;
  return a < 1 ? hex + Math.round(a * 255).toString(16).padStart(2, '0').toUpperCase() : hex;
}

/* ───────────── context ───────────── */

interface PhInfo {
  xfrm?: XNode;
  bodyPr?: XNode;
  lstStyle?: XNode;
  spPr?: XNode;
}

interface SlideCtx {
  zip: SafeZip;
  part: string;
  rels: Map<string, Rel>;
  cc: ColorCtx;
  theme: Theme;
  fonts: { major: string; minor: string };
  layoutPh: Map<string, PhInfo>;
  masterPh: Map<string, PhInfo>;
  masterStyles: { title?: XNode; body?: XNode; other?: XNode };
  assets: Record<string, Uint8Array>;
  assetMeta: Presentation['assets'];
  warnings: ImportWarning[];
  slideNo: number;
  idMap: Map<string, string>; // OOXML spid → element id
  slideTargets: Map<string, string>; // slide part → slide id
}

async function addAsset(ctx: SlideCtx, bytes: Uint8Array, name: string): Promise<string | null> {
  let mime = sniff(bytes);
  if (mime === 'image/svg+xml') {
    try {
      bytes = new TextEncoder().encode(sanitizeSvg(new TextDecoder().decode(bytes)));
    } catch {
      ctx.warnings.push({ slide: ctx.slideNo, code: 'svg-invalid', message: `Rejected malformed SVG ${name}` });
      return null;
    }
  }
  if (!IMAGE_TYPES.has(mime) && !MEDIA_TYPES.has(mime) && mime !== 'image/tiff') {
    ctx.warnings.push({ slide: ctx.slideNo, code: 'media-unknown', message: `Skipped ${name}: content is not a recognised image/media format` });
    return null;
  }
  if (mime === 'image/tiff') {
    ctx.warnings.push({ slide: ctx.slideNo, code: 'media-tiff', message: `${name} is TIFF, which browsers cannot display` });
    mime = 'image/tiff';
  }
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
  const id = Array.from(digest.subarray(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
  if (!ctx.assets[id]) {
    ctx.assets[id] = bytes;
    ctx.assetMeta[id] = { id, mime, name: name.split('/').pop() ?? name, size: bytes.length };
  }
  return `asset:${id}`;
}

async function relBytes(ctx: SlideCtx, rid: string | undefined): Promise<{ bytes: Uint8Array; name: string } | null> {
  if (!rid) return null;
  const rel = ctx.rels.get(rid);
  if (!rel) return null;
  if (rel.external) {
    ctx.warnings.push({ slide: ctx.slideNo, code: 'external-link', message: `External linked file not fetched: ${rel.target.slice(0, 100)}` });
    return null;
  }
  const bytes = await ctx.zip.bytes(rel.target);
  return bytes ? { bytes, name: rel.target } : null;
}

/* ───────────── geometry ───────────── */

interface Xf {
  x: number; y: number; w: number; h: number; rot: number; flipH: boolean; flipV: boolean;
}

function readXfrm(x: XNode | undefined): Xf | undefined {
  if (!x) return undefined;
  const off = child(x, 'a:off'), ext = child(x, 'a:ext');
  if (!off || !ext) return undefined;
  return {
    x: num(off, 'x') / EMU,
    y: num(off, 'y') / EMU,
    w: num(ext, 'cx') / EMU,
    h: num(ext, 'cy') / EMU,
    rot: num(x, 'rot') / ANGLE,
    flipH: attr(x, 'flipH') === '1',
    flipV: attr(x, 'flipV') === '1',
  };
}

type GroupTf = (xf: Xf) => Xf;
const identity: GroupTf = (x) => x;

function phKey(ph: XNode | undefined): string[] {
  if (!ph) return [];
  const type = attr(ph, 'type') ?? 'body';
  const idx = attr(ph, 'idx');
  const keys: string[] = [];
  if (idx) keys.push(`idx:${idx}`);
  keys.push(`type:${type}`);
  if (type === 'ctrTitle') keys.push('type:title');
  if (type === 'subTitle') keys.push('type:body');
  return keys;
}

function lookupPh(map: Map<string, PhInfo>, keys: string[]): PhInfo | undefined {
  for (const k of keys) {
    const v = map.get(k);
    if (v) return v;
  }
  return undefined;
}

function collectPh(tree: XNode | undefined): Map<string, PhInfo> {
  const out = new Map<string, PhInfo>();
  for (const sp of findAll(tree, 'p:sp')) {
    const ph = path(sp, 'p:nvSpPr', 'p:nvPr', 'p:ph');
    if (!ph) continue;
    const info: PhInfo = { xfrm: path(sp, 'p:spPr', 'a:xfrm'), bodyPr: path(sp, 'p:txBody', 'a:bodyPr'), lstStyle: path(sp, 'p:txBody', 'a:lstStyle'), spPr: child(sp, 'p:spPr') };
    for (const k of phKey(ph)) if (!out.has(k)) out.set(k, info);
  }
  return out;
}

/* ───────────── fills & lines ───────────── */

async function readFill(spPr: XNode | undefined, ctx: SlideCtx): Promise<Fill | undefined> {
  if (!spPr) return undefined;
  if (child(spPr, 'a:noFill')) return { kind: 'none' };
  const solid = child(spPr, 'a:solidFill');
  if (solid) {
    const c = color(solid, ctx.cc);
    return c ? { kind: 'solid', color: c } : undefined;
  }
  const grad = child(spPr, 'a:gradFill');
  if (grad) {
    const stops = children(child(grad, 'a:gsLst'), 'a:gs').map((g) => ({ offset: num(g, 'pos') / 100000, color: color(g, ctx.cc) ?? '#000000' }));
    if (child(grad, 'a:path')) return { kind: 'radial', stops };
    const ang = num(child(grad, 'a:lin'), 'ang') / ANGLE;
    return { kind: 'linear', angle: (ang + 90) % 360, stops };
  }
  const blip = child(spPr, 'a:blipFill');
  if (blip) {
    const f = await relBytes(ctx, attr(child(blip, 'a:blip'), 'r:embed'));
    const src = f ? await addAsset(ctx, f.bytes, f.name) : null;
    return src ? { kind: 'image', src, fit: 'cover' } : { kind: 'none' };
  }
  if (child(spPr, 'a:pattFill')) {
    const fg = color(path(spPr, 'a:pattFill', 'a:fgClr'), ctx.cc);
    ctx.warnings.push({ slide: ctx.slideNo, code: 'pattern-fill', message: 'Pattern fill approximated by its foreground colour' });
    return fg ? { kind: 'solid', color: fg } : undefined;
  }
  return undefined;
}

function readLine(spPr: XNode | undefined, ctx: SlideCtx, styleLn?: string): Stroke | null | undefined {
  const ln = child(spPr, 'a:ln');
  if (!ln) return styleLn ? { color: styleLn, width: 1, dash: 'solid' } : undefined;
  if (child(ln, 'a:noFill')) return null;
  const c = color(child(ln, 'a:solidFill'), ctx.cc) ?? styleLn;
  if (!c) return undefined;
  const dash = attr(child(ln, 'a:prstDash'), 'val') ?? 'solid';
  return { color: c, width: Math.max(0.5, num(ln, 'w', 12700) / EMU), dash: dash === 'solid' ? 'solid' : /dot/i.test(dash) ? 'dot' : 'dash' };
}

/* ───────────── text ───────────── */

interface RunDefaults {
  size: number;
  color?: string;
  font?: string;
  bold?: boolean;
  italic?: boolean;
  bullet?: 'none' | 'bullet' | 'number';
  align?: TextStyle['align'];
  lineHeight?: number;
}

function mergeLvl(target: RunDefaults, lvl: XNode | undefined, ctx: SlideCtx) {
  if (!lvl) return;
  const rpr = child(lvl, 'a:defRPr');
  if (rpr) {
    if (rpr.attrs.sz) target.size = num(rpr, 'sz') / 100;
    if (rpr.attrs.b) target.bold = rpr.attrs.b === '1';
    if (rpr.attrs.i) target.italic = rpr.attrs.i === '1';
    const c = color(child(rpr, 'a:solidFill'), ctx.cc);
    if (c) target.color = c;
    const f = attr(child(rpr, 'a:latin'), 'typeface');
    if (f) target.font = fontName(f, ctx);
  }
  if (child(lvl, 'a:buNone')) target.bullet = 'none';
  else if (child(lvl, 'a:buAutoNum')) target.bullet = 'number';
  else if (child(lvl, 'a:buChar')) target.bullet = 'bullet';
  const al = attr(lvl, 'algn');
  if (al) target.align = ALIGN[al] ?? target.align;
  const lh = path(lvl, 'a:lnSpc', 'a:spcPct');
  if (lh) target.lineHeight = num(lh, 'val') / 100000;
}

const ALIGN: Record<string, TextStyle['align']> = { l: 'left', ctr: 'center', r: 'right', just: 'justify', dist: 'justify' };

function fontName(f: string, ctx: SlideCtx): string {
  if (f.startsWith('+mj')) return ctx.fonts.major;
  if (f.startsWith('+mn')) return ctx.fonts.minor;
  return f;
}

function defaultsFor(level: number, phType: string | undefined, phLst: XNode[], ctx: SlideCtx): RunDefaults {
  const d: RunDefaults = { size: 18, font: ctx.fonts.minor };
  const lv = `a:lvl${level + 1}pPr`;
  const master = phType === 'title' || phType === 'ctrTitle' ? ctx.masterStyles.title : phType ? ctx.masterStyles.body : ctx.masterStyles.other;
  if (phType === 'title' || phType === 'ctrTitle') d.font = ctx.fonts.major;
  mergeLvl(d, child(master, lv), ctx);
  if (!phType) d.bullet = 'none';
  for (const lst of phLst) mergeLvl(d, child(lst, lv), ctx);
  return d;
}

function readParagraphs(txBody: XNode | undefined, ctx: SlideCtx, phType: string | undefined, phLst: XNode[]): { paragraphs: Paragraph[]; base: RunDefaults } {
  const ps = children(txBody, 'a:p');
  const lst = child(txBody, 'a:lstStyle');
  const allLst = lst ? [...phLst, lst] : phLst;
  const base = defaultsFor(0, phType, allLst, ctx);
  const paragraphs: Paragraph[] = ps.map((p) => {
    const pPr = child(p, 'a:pPr');
    const level = num(pPr, 'lvl');
    const d = defaultsFor(level, phType, allLst, ctx);
    mergeLvl(d, pPr, ctx);
    const runs: TextRun[] = [];
    for (const n of p.children) {
      if (n.name === 'a:r' || n.name === 'a:fld') {
        const rPr = child(n, 'a:rPr');
        const run: TextRun = { text: children(n, 'a:t').map((x) => x.text).join('') };
        const sz = rPr?.attrs.sz ? num(rPr, 'sz') / 100 : d.size;
        if (sz !== base.size) run.size = sz;
        const b = rPr?.attrs.b !== undefined ? rPr.attrs.b === '1' : d.bold;
        const i = rPr?.attrs.i !== undefined ? rPr.attrs.i === '1' : d.italic;
        if (b) run.bold = true;
        if (i) run.italic = true;
        if (rPr?.attrs.u && rPr.attrs.u !== 'none') run.underline = true;
        if (rPr?.attrs.strike && rPr.attrs.strike !== 'noStrike') run.strike = true;
        const c = color(child(rPr, 'a:solidFill'), ctx.cc) ?? d.color;
        if (c && c !== base.color) run.color = c;
        const f = attr(child(rPr, 'a:latin'), 'typeface');
        const font = f ? fontName(f, ctx) : d.font;
        if (font && font !== base.font) run.font = font;
        const hl = color(child(rPr, 'a:highlight'), ctx.cc);
        if (hl) run.highlight = hl;
        const link = ctx.rels.get(attr(child(rPr, 'a:hlinkClick'), 'r:id') ?? '');
        if (link?.external) run.link = link.target;
        runs.push(run);
      } else if (n.name === 'a:br') runs.push({ text: '\n' });
    }
    const para: Paragraph = { runs: mergeRuns(runs), level: level || undefined };
    const al = attr(pPr, 'algn');
    para.align = al ? ALIGN[al] : d.align;
    para.bullet = d.bullet ?? 'none';
    if (d.lineHeight) para.lineHeight = d.lineHeight;
    const sb = path(pPr, 'a:spcBef', 'a:spcPts');
    const sa = path(pPr, 'a:spcAft', 'a:spcPts');
    if (sb) para.spaceBefore = num(sb, 'val') / 100;
    if (sa) para.spaceAfter = num(sa, 'val') / 100;
    return para;
  });
  return { paragraphs: paragraphs.length ? paragraphs : [{ runs: [{ text: '' }] }], base };
}

function mergeRuns(runs: TextRun[]): TextRun[] {
  const out: TextRun[] = [];
  for (const r of runs) {
    const prev = out[out.length - 1];
    if (prev && JSON.stringify({ ...prev, text: '' }) === JSON.stringify({ ...r, text: '' })) prev.text += r.text;
    else out.push({ ...r });
  }
  return out.length ? out : [{ text: '' }];
}

function readTextStyle(txBody: XNode | undefined, phBodyPr: XNode | undefined, base: RunDefaults, ctx: SlideCtx): TextStyle {
  const bp = child(txBody, 'a:bodyPr');
  const pick = (k: string) => bp?.attrs[k] ?? phBodyPr?.attrs[k];
  const anchor = pick('anchor');
  const ins = (k: string, d: number) => (pick(k) !== undefined ? Number(pick(k)) / EMU : d);
  return {
    font: base.font ?? ctx.fonts.minor,
    size: base.size,
    color: base.color ?? ctx.theme.colors.text,
    bold: base.bold,
    italic: base.italic,
    align: base.align ?? 'left',
    valign: anchor === 'ctr' ? 'middle' : anchor === 'b' ? 'bottom' : 'top',
    lineHeight: base.lineHeight ?? 1.0,
    letterSpacing: 0,
    autofit: child(bp, 'a:normAutofit') ? 'shrink' : 'none',
    padding: Math.max(ins('lIns', 9.6), ins('tIns', 4.8)),
  };
}

/* ───────────── shapes ───────────── */

const PRST_TO_KIND: Record<string, ShapeKind> = {
  rect: 'rect', roundRect: 'roundRect', ellipse: 'ellipse', triangle: 'triangle', rtTriangle: 'triangle', diamond: 'diamond', pentagon: 'pentagon', homePlate: 'pentagon',
  hexagon: 'hexagon', star5: 'star', star4: 'star', star6: 'star', rightArrow: 'arrowRight', leftArrow: 'arrowRight', chevron: 'chevron',
  wedgeRoundRectCallout: 'speech', wedgeRectCallout: 'speech', wedgeEllipseCallout: 'speech', cloud: 'cloud', cloudCallout: 'cloud', heart: 'heart', mathPlus: 'plus', plus: 'plus',
  snip1Rect: 'rect', snip2SameRect: 'rect', round1Rect: 'roundRect', round2SameRect: 'roundRect', flowChartProcess: 'rect', flowChartAlternateProcess: 'roundRect',
  flowChartDecision: 'diamond', flowChartConnector: 'ellipse', octagon: 'hexagon', parallelogram: 'rect', trapezoid: 'rect',
};

async function readSp(sp: XNode, ctx: SlideCtx, tf: GroupTf): Promise<SlideElement | null> {
  const nv = child(sp, 'p:nvSpPr');
  const cnv = child(nv, 'p:cNvPr');
  const ph = path(nv, 'p:nvPr', 'p:ph');
  const keys = phKey(ph);
  const lph = lookupPh(ctx.layoutPh, keys);
  const mph = lookupPh(ctx.masterPh, keys);
  const spPr = child(sp, 'p:spPr');
  const xf = readXfrm(child(spPr, 'a:xfrm')) ?? readXfrm(lph?.xfrm) ?? readXfrm(mph?.xfrm);
  if (!xf) {
    ctx.warnings.push({ slide: ctx.slideNo, code: 'no-geometry', message: `Shape “${attr(cnv, 'name')}” has no position and was skipped` });
    return null;
  }
  const g = tf(xf);
  const phType = ph ? attr(ph, 'type') ?? 'body' : undefined;
  const phLst = [mph?.lstStyle, lph?.lstStyle].filter((x): x is XNode => Boolean(x));
  const txBody = child(sp, 'p:txBody');
  const { paragraphs, base } = readParagraphs(txBody, ctx, phType, phLst);
  const style = readTextStyle(txBody, lph?.bodyPr ?? mph?.bodyPr, base, ctx);
  const styleRef = child(sp, 'p:style');
  const styleFill = color(child(styleRef, 'a:fillRef'), ctx.cc);
  const styleLn = color(child(styleRef, 'a:lnRef'), ctx.cc);
  const fontRef = color(child(styleRef, 'a:fontRef'), ctx.cc);
  if (fontRef && !base.color) style.color = fontRef;
  const fill = (await readFill(spPr, ctx)) ?? (await readFill(lph?.spPr, ctx)) ?? (styleFill && attr(child(styleRef, 'a:fillRef'), 'idx') !== '0' ? { kind: 'solid' as const, color: styleFill } : { kind: 'none' as const });
  const stroke = readLine(spPr, ctx, attr(child(styleRef, 'a:lnRef'), 'idx') !== '0' ? styleLn : undefined) ?? null;
  const geomNode = child(spPr, 'a:prstGeom');
  const prst = attr(geomNode, 'prst') ?? (child(spPr, 'a:custGeom') ? 'custom' : 'rect');
  const name = attr(cnv, 'name') ?? 'Shape';
  const id = uid('el');
  ctx.idMap.set(attr(cnv, 'id') ?? '', id);
  const link = await readLink(cnv, ctx);
  const common = {
    id,
    name,
    x: g.x, y: g.y, w: g.w, h: g.h,
    rotation: g.rot,
    opacity: 1,
    hidden: attr(cnv, 'hidden') === '1' || undefined,
    placeholder: phType ? (phType === 'title' || phType === 'ctrTitle' ? ('title' as const) : phType === 'subTitle' ? ('subtitle' as const) : ('body' as const)) : undefined,
    link,
  };
  if (name === 'DECK Equation') {
    const latex = paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join('\n');
    return { ...common, type: 'equation', name: 'Equation', latex, color: style.color, size: style.size / 0.6 };
  }
  if (prst === 'custom') {
    ctx.warnings.push({ slide: ctx.slideNo, code: 'custom-geometry', message: `Freeform shape “${name}” approximated by a rectangle` });
  } else if (prst !== 'rect' && !PRST_TO_KIND[prst]) {
    ctx.warnings.push({ slide: ctx.slideNo, code: 'preset-geometry', message: `Shape “${name}” (${prst}) approximated by a rectangle` });
  }
  if (xf.flipH || xf.flipV) ctx.warnings.push({ slide: ctx.slideNo, code: 'flip', message: `Flip on “${name}” is not preserved` });
  const isTextBox = attr(child(nv, 'p:cNvSpPr'), 'txBox') === '1' || ((prst === 'rect' || prst === 'custom') && fill.kind === 'none' && !stroke);
  if (isTextBox) return { ...common, type: 'text', paragraphs, style, fill, stroke };
  const kind = PRST_TO_KIND[prst] ?? 'rect';
  const adj = attr(child(child(geomNode, 'a:avLst'), 'a:gd'), 'fmla');
  const adjVal = adj ? Number(adj.replace(/^val\s+/, '')) : 16667;
  const shadowN = path(spPr, 'a:effectLst', 'a:outerShdw');
  const shadow = shadowN
    ? (() => {
        const dist = num(shadowN, 'dist') / EMU;
        const dir = (num(shadowN, 'dir') / ANGLE) * (Math.PI / 180);
        return { x: Math.cos(dir) * dist, y: Math.sin(dir) * dist, blur: num(shadowN, 'blurRad') / EMU, color: color(shadowN, ctx.cc) ?? '#00000066' };
      })()
    : null;
  return {
    ...common,
    type: 'shape',
    shape: kind,
    fill,
    stroke,
    shadow,
    cornerRadius: kind === 'roundRect' ? (Math.min(g.w, g.h) * (Number.isFinite(adjVal) ? adjVal : 16667)) / 100000 : 0,
    paragraphs,
    style: { ...style, align: paragraphs[0]?.align ?? style.align },
  };
}

async function readLink(cnv: XNode | undefined, ctx: SlideCtx): Promise<SlideElement['link']> {
  const h = child(cnv, 'a:hlinkClick');
  if (!h) return undefined;
  const rel = ctx.rels.get(attr(h, 'r:id') ?? '');
  if (!rel) return undefined;
  if (rel.external) return { kind: 'url', url: rel.target };
  if (rel.type === REL.slide) {
    const sid = ctx.slideTargets.get(rel.target);
    if (sid) return { kind: 'slide', slideId: sid };
  }
  return undefined;
}

async function readPic(pic: XNode, ctx: SlideCtx, tf: GroupTf): Promise<SlideElement | null> {
  const nv = child(pic, 'p:nvPicPr');
  const cnv = child(nv, 'p:cNvPr');
  const nvPr = child(nv, 'p:nvPr');
  const spPr = child(pic, 'p:spPr');
  const keys = phKey(child(nvPr, 'p:ph'));
  const xf = readXfrm(child(spPr, 'a:xfrm')) ?? readXfrm(lookupPh(ctx.layoutPh, keys)?.xfrm);
  if (!xf) return null;
  const g = tf(xf);
  const id = uid('el');
  ctx.idMap.set(attr(cnv, 'id') ?? '', id);
  const base = { id, name: attr(cnv, 'name') ?? 'Picture', x: g.x, y: g.y, w: g.w, h: g.h, rotation: g.rot, opacity: 1, link: await readLink(cnv, ctx) };
  const blip = path(pic, 'p:blipFill', 'a:blip');
  const video = child(nvPr, 'a:videoFile');
  const audio = child(nvPr, 'a:audioFile');
  if (video || audio) {
    const embedded = findAll(nvPr, 'p14:media')[0];
    const f = (await relBytes(ctx, attr(embedded, 'r:embed'))) ?? (await relBytes(ctx, attr(video ?? audio, 'r:link')));
    const src = f ? await addAsset(ctx, f.bytes, f.name) : null;
    if (!src) {
      ctx.warnings.push({ slide: ctx.slideNo, code: 'media-missing', message: `Media “${base.name}” could not be embedded` });
      return null;
    }
    const pf = await relBytes(ctx, attr(blip, 'r:embed'));
    const poster = pf ? (await addAsset(ctx, pf.bytes, pf.name)) ?? undefined : undefined;
    return { ...base, type: 'media', kind: video ? 'video' : 'audio', src, poster, autoplay: false, loop: false, muted: false };
  }
  // Prefer an SVG original when the svgBlip extension is present.
  const svg = findAll(blip, 'asvg:svgBlip')[0];
  const f = (svg && (await relBytes(ctx, attr(svg, 'r:embed')))) || (await relBytes(ctx, attr(blip, 'r:embed')));
  const src = f ? await addAsset(ctx, f.bytes, f.name) : null;
  if (!src) return null;
  const sr = path(pic, 'p:blipFill', 'a:srcRect');
  const crop = { left: num(sr, 'l') / 100000, top: num(sr, 't') / 100000, right: num(sr, 'r') / 100000, bottom: num(sr, 'b') / 100000 };
  const prst = attr(child(spPr, 'a:prstGeom'), 'prst');
  const alphaFix = child(blip, 'a:alphaModFix');
  return {
    ...base,
    opacity: alphaFix ? num(alphaFix, 'amt', 100000) / 100000 : 1,
    type: 'image',
    src,
    alt: attr(cnv, 'descr') ?? '',
    crop,
    mask: prst === 'ellipse' ? 'circle' : prst === 'roundRect' ? 'rounded' : 'none',
    stroke: readLine(spPr, ctx) ?? null,
    shadow: null,
  };
}

function readCxn(cx: XNode, ctx: SlideCtx, tf: GroupTf): SlideElement | null {
  const spPr = child(cx, 'p:spPr');
  const xf0 = readXfrm(child(spPr, 'a:xfrm'));
  if (!xf0) return null;
  const xf = tf(xf0);
  const cnv = path(cx, 'p:nvCxnSpPr', 'p:cNvPr');
  const id = uid('el');
  ctx.idMap.set(attr(cnv, 'id') ?? '', id);
  const stroke = readLine(spPr, ctx, color(path(cx, 'p:style', 'a:lnRef'), ctx.cc)) ?? { color: ctx.theme.colors.text, width: 2, dash: 'solid' as const };
  const ln = child(spPr, 'a:ln');
  const arrow = (n: XNode | undefined) => {
    const ty = attr(n, 'type');
    return !ty || ty === 'none' ? 'none' : ty === 'oval' ? 'dot' : 'arrow';
  };
  const prst = attr(child(spPr, 'a:prstGeom'), 'prst') ?? 'line';
  const x1 = xf.flipH ? xf.x + xf.w : xf.x, x2 = xf.flipH ? xf.x : xf.x + xf.w;
  const y1 = xf.flipV ? xf.y + xf.h : xf.y, y2 = xf.flipV ? xf.y : xf.y + xf.h;
  const st = attr(path(cx, 'p:nvCxnSpPr', 'p:cNvCxnSpPr', 'a:stCxn'), 'id');
  const en = attr(path(cx, 'p:nvCxnSpPr', 'p:cNvCxnSpPr', 'a:endCxn'), 'id');
  return {
    id, type: 'line', name: attr(cnv, 'name') ?? 'Connector',
    x: xf.x, y: xf.y, w: xf.w, h: xf.h, rotation: xf.rot, opacity: 1,
    x1, y1, x2, y2,
    stroke: { ...stroke, color: stroke?.color ?? ctx.theme.colors.text },
    startArrow: arrow(child(ln, 'a:headEnd')),
    endArrow: arrow(child(ln, 'a:tailEnd')),
    curve: prst.startsWith('bent') ? 'elbow' : prst.startsWith('curved') ? 'curved' : 'straight',
    from: st ? `ooxml:${st}` : undefined,
    to: en ? `ooxml:${en}` : undefined,
  };
}

function readTable(tbl: XNode, ctx: SlideCtx, g: Xf, base: { id: string; name: string }): SlideElement {
  const grid = children(child(tbl, 'a:tblGrid'), 'a:gridCol').map((c) => num(c, 'w'));
  const total = grid.reduce((a, b) => a + b, 0) || 1;
  const tblPr = child(tbl, 'a:tblPr');
  let font = ctx.fonts.minor, size = 18, tcolor = ctx.theme.colors.text;
  const rows: TableCell[][] = children(tbl, 'a:tr').map((tr) =>
    children(tr, 'a:tc').map((tc) => {
      const body = child(tc, 'a:txBody');
      const ps = children(body, 'a:p');
      const text = ps.map((p) => findAll(p, 'a:t').map((x) => x.text).join('')).join('\n');
      const rPr = findAll(body, 'a:rPr')[0];
      if (rPr?.attrs.sz) size = num(rPr, 'sz') / 100;
      const f = attr(child(rPr, 'a:latin'), 'typeface');
      if (f) font = fontName(f, ctx);
      const c = color(child(rPr, 'a:solidFill'), ctx.cc);
      const cell: TableCell = { text };
      if (c) { cell.color = c; tcolor = c; }
      if (rPr?.attrs.b === '1') cell.bold = true;
      const fill = color(path(tc, 'a:tcPr', 'a:solidFill'), ctx.cc);
      if (fill) cell.fill = fill;
      const al = attr(child(ps[0], 'a:pPr'), 'algn');
      if (al) cell.align = ALIGN[al];
      if (attr(tc, 'gridSpan') || attr(tc, 'hMerge') || attr(tc, 'rowSpan') || attr(tc, 'vMerge')) ctx.warnings.push({ slide: ctx.slideNo, code: 'table-merge', message: 'Merged table cells are imported unmerged' });
      return cell;
    }),
  );
  return {
    ...base, type: 'table', x: g.x, y: g.y, w: g.w, h: g.h, rotation: 0, opacity: 1,
    rows, colWidths: grid.map((w) => w / total),
    headerRow: attr(tblPr, 'firstRow') === '1', bandedRows: attr(tblPr, 'bandRow') === '1',
    style: { font, size, color: tcolor, border: ctx.theme.colors.muted, headerFill: ctx.theme.colors.accent, bandFill: ctx.theme.colors.surface },
  };
}

async function readChart(part: string, ctx: SlideCtx, g: Xf, base: { id: string; name: string }): Promise<SlideElement | null> {
  const x = await ctx.zip.xml(part);
  const plot = findAll(x, 'c:plotArea')[0];
  if (!plot) return null;
  const kinds: [string, ChartElement['chart']][] = [['c:barChart', 'column'], ['c:bar3DChart', 'column'], ['c:lineChart', 'line'], ['c:line3DChart', 'line'], ['c:areaChart', 'area'], ['c:pieChart', 'pie'], ['c:pie3DChart', 'pie'], ['c:doughnutChart', 'donut'], ['c:scatterChart', 'scatter']];
  const found = kinds.find(([n]) => child(plot, n));
  if (!found) {
    ctx.warnings.push({ slide: ctx.slideNo, code: 'chart-type', message: `Unsupported chart type in ${part}` });
    return null;
  }
  const node = child(plot, found[0])!;
  let kind = found[1];
  if (kind === 'column' && attr(child(node, 'c:barDir'), 'val') === 'bar') kind = 'bar';
  if (found[0].includes('3D')) ctx.warnings.push({ slide: ctx.slideNo, code: 'chart-3d', message: '3-D chart imported as 2-D' });
  const pts = (n: XNode | undefined) => {
    const cache = n ? findAll(n, 'c:pt') : [];
    const out: string[] = [];
    for (const p of cache) out[num(p, 'idx')] = child(p, 'c:v')?.text ?? '';
    return out;
  };
  const series = children(node, 'c:ser').map((s, i) => {
    const vals = pts(child(s, 'c:val') ?? child(s, 'c:yVal')).map((v) => Number(v) || 0);
    return { name: pts(child(s, 'c:tx'))[0] ?? `Series ${i + 1}`, values: vals, color: kind === 'pie' || kind === 'donut' ? undefined : color(path(s, 'c:spPr', 'a:solidFill'), ctx.cc) ?? color(path(s, 'c:spPr', 'a:ln', 'a:solidFill'), ctx.cc) };
  });
  const first = children(node, 'c:ser')[0];
  const categories = pts(child(first, 'c:cat') ?? child(first, 'c:xVal'));
  const title = findAll(findAll(x, 'c:title')[0], 'a:t').map((t) => t.text).join('');
  return {
    ...base, type: 'chart', x: g.x, y: g.y, w: g.w, h: g.h, rotation: 0, opacity: 1,
    chart: kind, categories: categories.length ? categories : series[0]?.values.map((_, i) => String(i + 1)) ?? [],
    series, title, legend: Boolean(findAll(x, 'c:legend')[0]), dataLabels: Boolean(findAll(node, 'c:showVal').find((n) => attr(n, 'val') === '1')),
    style: { font: ctx.fonts.minor, color: ctx.theme.colors.text, grid: ctx.theme.colors.muted },
  };
}

async function readGraphicFrame(gf: XNode, ctx: SlideCtx, tf: GroupTf): Promise<SlideElement | null> {
  const cnv = path(gf, 'p:nvGraphicFramePr', 'p:cNvPr');
  const xf0 = readXfrm(child(gf, 'p:xfrm'));
  if (!xf0) return null;
  const g = tf(xf0);
  const data = path(gf, 'a:graphic', 'a:graphicData');
  const uri = attr(data, 'uri') ?? '';
  const id = uid('el');
  ctx.idMap.set(attr(cnv, 'id') ?? '', id);
  const base = { id, name: attr(cnv, 'name') ?? 'Object' };
  const tbl = child(data, 'a:tbl');
  if (tbl) return readTable(tbl, ctx, g, base);
  const ch = child(data, 'c:chart');
  if (ch) {
    const rel = ctx.rels.get(attr(ch, 'r:id') ?? '');
    if (rel && !rel.external) {
      const el = await readChart(rel.target, ctx, g, base);
      if (el) return el;
    }
  }
  const what = uri.includes('diagram') ? 'SmartArt-style diagram' : uri.includes('ole') ? 'embedded OLE object' : `object (${uri.split('/').pop()})`;
  ctx.warnings.push({ slide: ctx.slideNo, code: 'unsupported-object', message: `${what} “${base.name}” kept as a read-only placeholder` });
  if (uri.includes('ole')) ctx.warnings.push({ slide: ctx.slideNo, code: 'ole', message: 'Embedded OLE content is never executed' });
  return { ...base, type: 'raw', x: g.x, y: g.y, w: g.w, h: g.h, rotation: 0, opacity: 1, format: 'ooxml', xml: serialize(gf), reason: what };
}

async function walkTree(nodes: XNode[], ctx: SlideCtx, tf: GroupTf, out: SlideElement[], groupId?: string) {
  for (const n of nodes) {
    let el: SlideElement | null = null;
    switch (n.name) {
      case 'p:sp': el = await readSp(n, ctx, tf); break;
      case 'p:pic': el = await readPic(n, ctx, tf); break;
      case 'p:cxnSp': el = readCxn(n, ctx, tf); break;
      case 'p:graphicFrame': el = await readGraphicFrame(n, ctx, tf); break;
      case 'p:grpSp': {
        const gx = path(n, 'p:grpSpPr', 'a:xfrm');
        const off = child(gx, 'a:off'), ext = child(gx, 'a:ext'), cho = child(gx, 'a:chOff'), che = child(gx, 'a:chExt');
        if (num(gx, 'rot')) ctx.warnings.push({ slide: ctx.slideNo, code: 'group-rotation', message: 'Rotated group flattened without rotation' });
        const sx = num(che, 'cx') ? num(ext, 'cx') / num(che, 'cx') : 1;
        const sy = num(che, 'cy') ? num(ext, 'cy') / num(che, 'cy') : 1;
        const inner: GroupTf = (x) => tf({ ...x, x: (num(off, 'x') + (x.x * EMU - num(cho, 'x')) * sx) / EMU, y: (num(off, 'y') + (x.y * EMU - num(cho, 'y')) * sy) / EMU, w: x.w * sx, h: x.h * sy });
        await walkTree(n.children, ctx, inner, out, groupId ?? uid('gr'));
        continue;
      }
      case 'mc:AlternateContent': {
        const fb = child(n, 'mc:Fallback');
        const choice = child(n, 'mc:Choice');
        await walkTree((fb ?? choice)?.children ?? [], ctx, tf, out, groupId);
        continue;
      }
      case 'p:contentPart':
        ctx.warnings.push({ slide: ctx.slideNo, code: 'ink', message: 'Ink annotation was not imported' });
        continue;
      default:
        continue;
    }
    if (el) {
      if (groupId) el.groupId = groupId;
      out.push(el);
    }
  }
}

/* ───────────── transitions & timing ───────────── */

function readTransition(sld: XNode): Transition {
  let tr = child(sld, 'p:transition');
  if (!tr) {
    const alt = child(sld, 'mc:AlternateContent');
    tr = child(child(alt, 'mc:Fallback'), 'p:transition') ?? child(child(alt, 'mc:Choice'), 'p:transition');
  }
  const t = defaultTransition();
  if (!tr) return t;
  const spd = attr(tr, 'spd');
  const dur = attr(tr, 'p14:dur');
  t.duration = dur ? Number(dur) : spd === 'fast' ? 500 : spd === 'slow' ? 1000 : 750;
  if (attr(tr, 'advTm')) t.advanceAfter = Number(attr(tr, 'advTm'));
  const kid = children(tr).find((k) => k.name.startsWith('p:') || k.name.startsWith('p14:'));
  const dirMap: Record<string, Transition['direction']> = { l: 'left', r: 'right', u: 'up', d: 'down' };
  if (kid) {
    const nm = kid.name.split(':')[1]!;
    const kind = ({ fade: 'fade', push: 'push', wipe: 'wipe', cover: 'cover', pull: 'cover', zoom: 'zoom', split: 'split', cut: 'none', dissolve: 'fade', randomBar: 'wipe', morph: 'smart-move', flip: 'flip' } as Record<string, Transition['kind']>)[nm];
    t.kind = kind ?? 'fade';
    t.direction = dirMap[attr(kid, 'dir') ?? 'l'] ?? 'left';
  }
  return t;
}

const PRESET_EFFECT: Record<string, Record<number, AnimationEffect>> = {
  entr: { 1: 'appear', 2: 'fly', 10: 'fade', 22: 'wipe', 53: 'zoom', 23: 'zoom', 21: 'wipe', 42: 'rise', 47: 'rise', 37: 'rise' },
  exit: { 1: 'appear', 2: 'fly', 10: 'fade', 22: 'wipe', 53: 'zoom', 23: 'zoom', 21: 'wipe' },
  emph: { 6: 'grow', 8: 'spin', 26: 'pulse', 32: 'shake', 3: 'color', 1: 'color' },
};

function readTiming(sld: XNode, ctx: SlideCtx, size: { w: number; h: number }): Animation[] {
  const timing = child(sld, 'p:timing');
  if (!timing) return [];
  const out: Animation[] = [];
  const absStart = new Map<string, number>();
  const effects = findAll(timing, 'p:cTn').filter((c) => attr(c, 'presetClass'));
  for (const c of effects) {
    const cls = attr(c, 'presetClass')!;
    const pid = num(c, 'presetID');
    const sub = num(c, 'presetSubtype');
    const spid = attr(findAll(c, 'p:spTgt')[0], 'spid');
    const elementId = spid ? ctx.idMap.get(spid) : undefined;
    if (!elementId) continue;
    const nodeType = attr(c, 'nodeType');
    const durs = findAll(c, 'p:cTn').map((k) => Number(attr(k, 'dur'))).filter((d) => Number.isFinite(d) && d > 1);
    const duration = durs.length ? Math.max(...durs) : 500;
    const klass = cls === 'entr' ? 'entrance' : cls === 'exit' ? 'exit' : cls === 'emph' ? 'emphasis' : cls === 'path' ? 'motion' : null;
    if (!klass) {
      ctx.warnings.push({ slide: ctx.slideNo, code: 'anim-class', message: `Animation class “${cls}” not supported` });
      continue;
    }
    let effect: AnimationEffect | undefined = klass === 'motion' ? 'path' : PRESET_EFFECT[cls]?.[pid];
    if (!effect) {
      effect = klass === 'emphasis' ? 'pulse' : 'fade';
      ctx.warnings.push({ slide: ctx.slideNo, code: 'anim-preset', message: `Animation preset ${cls}/${pid} approximated as “${effect}”` });
    }
    const dir: Animation['direction'] = klass === 'entrance' ? ({ 1: 'down', 2: 'left', 4: 'up', 8: 'right' } as Record<number, Animation['direction']>)[sub] ?? 'up' : ({ 1: 'up', 2: 'right', 4: 'down', 8: 'left' } as Record<number, Animation['direction']>)[sub] ?? 'down';
    // Delay = offset of the enclosing timeline par (the parent of this effect's par).
    const outerDelay = (() => {
      let delay = 0;
      // find the par that contains c; fast-xml-parser tree has no parent links, so search ancestors by containment
      const pars = findAll(timing, 'p:par');
      for (const p of pars) {
        const ctn = child(p, 'p:cTn');
        if (!ctn || attr(ctn, 'presetClass')) continue;
        if (children(child(ctn, 'p:childTnLst'), 'p:par').some((pp) => child(pp, 'p:cTn') === c)) {
          const d = Number(attr(path(ctn, 'p:stCondLst', 'p:cond'), 'delay'));
          if (Number.isFinite(d)) delay = d;
        }
      }
      return delay;
    })();
    const own = Number(attr(path(c, 'p:stCondLst', 'p:cond'), 'delay'));
    const anim = createAnimation(elementId, {
      class: klass,
      effect,
      trigger: nodeType === 'clickEffect' ? 'click' : nodeType === 'afterEffect' ? 'after' : 'with',
      duration,
      delay: 0,
      direction: dir,
    });
    absStart.set(anim.id, (Number.isFinite(own) ? own : 0) + outerDelay);
    if (klass === 'motion') {
      const m = findAll(c, 'p:animMotion')[0];
      const d = attr(m, 'path') ?? '';
      const nums = d.replace(/[A-Za-z]/g, ' ').trim().split(/\s+/).map(Number).filter(Number.isFinite);
      const pts: { x: number; y: number }[] = [];
      for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i]! * size.w, y: nums[i + 1]! * size.h });
      if (pts.length) anim.path = pts;
    }
    // Interactive trigger: enclosing interactiveSeq with onClick on a shape.
    out.push(anim);
  }
  for (const seq of findAll(timing, 'p:seq')) {
    const ctn = child(seq, 'p:cTn');
    if (attr(ctn, 'nodeType') !== 'interactiveSeq') continue;
    const trig = attr(findAll(child(ctn, 'p:stCondLst'), 'p:spTgt')[0], 'spid');
    const trigId = trig ? ctx.idMap.get(trig) : undefined;
    const ids = new Set(findAll(ctn, 'p:cTn').filter((c) => attr(c, 'presetClass')).map((c) => ctx.idMap.get(attr(findAll(c, 'p:spTgt')[0], 'spid') ?? '')));
    for (const a of out) if (ids.has(a.elementId) && trigId) a.triggerElementId = trigId;
  }
  // Convert absolute step offsets back into per-trigger delays (inverse of buildSteps).
  let prevStart = 0, prevEnd = 0;
  for (const a of out) {
    const s = absStart.get(a.id) ?? 0;
    if (a.trigger === 'click') { a.delay = s; prevStart = s; prevEnd = s + a.duration; continue; }
    a.delay = Math.max(0, Math.round(s - (a.trigger === 'after' ? prevEnd : prevStart)));
    prevStart = s;
    prevEnd = s + a.duration;
  }
  return out;
}

/* ───────────── theme ───────────── */

async function readTheme(zip: SafeZip, part: string | undefined): Promise<{ theme: Theme; scheme: Record<string, string>; fonts: { major: string; minor: string } }> {
  const base = structuredClone(THEMES[2]!);
  const x = part ? await zip.xml(part) : undefined;
  const cs = findAll(x, 'a:clrScheme')[0];
  const scheme: Record<string, string> = {};
  for (const k of children(cs)) {
    const n = k.name.replace('a:', '');
    const v = attr(child(k, 'a:srgbClr'), 'val') ?? attr(child(k, 'a:sysClr'), 'lastClr');
    if (v) scheme[n] = v.toUpperCase();
  }
  const major = attr(path(findAll(x, 'a:majorFont')[0], 'a:latin'), 'typeface') || base.fonts.heading;
  const minor = attr(path(findAll(x, 'a:minorFont')[0], 'a:latin'), 'typeface') || base.fonts.body;
  const h = (k: string, d: string) => (scheme[k] ? `#${scheme[k]}` : d);
  const theme: Theme = {
    id: 'imported',
    name: attr(cs, 'name') ?? 'Imported',
    colors: {
      background: h('lt1', base.colors.background),
      surface: h('lt2', base.colors.surface),
      text: h('dk1', base.colors.text),
      muted: h('dk2', base.colors.muted),
      accent: h('accent1', base.colors.accent),
      accent2: h('accent2', base.colors.accent2),
      accent3: h('accent3', base.colors.accent3),
      accent4: h('accent4', base.colors.accent4),
    },
    fonts: { heading: major, body: minor, mono: base.fonts.mono },
    radius: 8,
  };
  return { theme, scheme, fonts: { major, minor } };
}

async function readBackground(cSld: XNode | undefined, ctx: SlideCtx): Promise<Fill | null | undefined> {
  const bg = child(cSld, 'p:bg');
  if (!bg) return undefined;
  const bgPr = child(bg, 'p:bgPr');
  if (bgPr) return (await readFill(bgPr, ctx)) ?? null;
  const ref = child(bg, 'p:bgRef');
  const c = color(ref, ctx.cc);
  return c ? { kind: 'solid', color: c } : null;
}

function guessLayout(layoutXml: XNode | undefined): LayoutId {
  const type = attr(findAll(layoutXml, 'p:sldLayout')[0], 'type');
  switch (type) {
    case 'title': return 'title';
    case 'obj': case 'tx': return 'title-content';
    case 'secHead': return 'section';
    case 'twoObj': case 'twoTxTwoObj': return 'two-column';
    case 'titleOnly': return 'title-only';
    case 'picTx': return 'image-left';
    default: return 'blank';
  }
}

/* ───────────── entry point ───────────── */

/** Import an ECMA-376 .pptx/.potx package. Throws on unsafe or invalid input. */
export async function importPptx(bytes: Uint8Array, sourceName = 'presentation.pptx'): Promise<ImportResult> {
  const zip = await openZipSafely(bytes);
  const warnings: ImportWarning[] = [];
  const ct = await zip.text('[Content_Types].xml');
  if (!ct) throw new Error('Missing [Content_Types].xml — not an Open XML package');
  await zip.xml('[Content_Types].xml'); // validates (rejects DOCTYPE/ENTITY)
  if (/macroEnabled/i.test(ct) || zip.list().some((n) => /vbaProject\.bin$/i.test(n))) {
    warnings.push({ code: 'macros', message: 'This file contains macros. They were not imported and are never executed.' });
  }
  const rootRels = await readRels(zip, '');
  const presPart = [...rootRels.values()].find((r) => r.type === REL.officeDocument)?.target ?? 'ppt/presentation.xml';
  const presXml = await zip.xml(presPart);
  const presNode = findAll(presXml, 'p:presentation')[0];
  if (!presNode) throw new Error('Package does not contain a presentation part');
  const presRels = await readRels(zip, presPart);
  const sz = child(presNode, 'p:sldSz');
  const width = Math.round(num(sz, 'cx', 12192000) / EMU);
  const height = Math.round(num(sz, 'cy', 6858000) / EMU);

  const masterRel = [...presRels.values()].find((r) => r.type === REL.slideMaster);
  const masterRels = masterRel ? await readRels(zip, masterRel.target) : new Map<string, Rel>();
  const themePart = [...masterRels.values()].find((r) => r.type === REL.theme)?.target ?? [...presRels.values()].find((r) => r.type === REL.theme)?.target;
  const { theme, scheme, fonts } = await readTheme(zip, themePart);

  const slideIds = children(child(presNode, 'p:sldIdLst'), 'p:sldId');
  const slideParts = slideIds.map((s) => ({ sldId: attr(s, 'id') ?? '', part: presRels.get(attr(s, 'r:id') ?? '')?.target })).filter((s): s is { sldId: string; part: string } => Boolean(s.part));
  const slideTargets = new Map(slideParts.map((s) => [s.part, uid('sl')]));

  // Sections
  const sectionOf = new Map<string, string>();
  for (const sec of findAll(presNode, 'p14:section')) for (const sid of findAll(sec, 'p14:sldId')) sectionOf.set(attr(sid, 'id') ?? '', attr(sec, 'name') ?? '');

  const assets: Record<string, Uint8Array> = {};
  const assetMeta: Presentation['assets'] = {};
  const masterCache = new Map<string, { ph: Map<string, PhInfo>; styles: SlideCtx['masterStyles']; map: Record<string, string>; bg?: Fill | null }>();
  const slides: Slide[] = [];

  for (let i = 0; i < slideParts.length; i++) {
    const { part, sldId } = slideParts[i]!;
    const sldXml = await zip.xml(part);
    const sld = findAll(sldXml, 'p:sld')[0];
    if (!sld) {
      warnings.push({ slide: i + 1, code: 'slide-missing', message: `Slide part ${part} is missing or invalid` });
      continue;
    }
    const rels = await readRels(zip, part);
    const layoutPart = [...rels.values()].find((r) => r.type === REL.slideLayout)?.target;
    const layoutXml = layoutPart ? await zip.xml(layoutPart) : undefined;
    const layoutRels = layoutPart ? await readRels(zip, layoutPart) : new Map<string, Rel>();
    const mPart = [...layoutRels.values()].find((r) => r.type === REL.slideMaster)?.target ?? masterRel?.target;
    const baseCc: ColorCtx = { scheme, map: { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' } };
    let master = mPart ? masterCache.get(mPart) : undefined;
    if (!master && mPart) {
      const mx = await zip.xml(mPart);
      const cm = findAll(mx, 'p:clrMap')[0];
      const map = cm ? { ...cm.attrs } : baseCc.map;
      const ts = findAll(mx, 'p:txStyles')[0];
      const tmpCtx = { zip, part: mPart, rels: masterRels, cc: { scheme, map }, theme, fonts, layoutPh: new Map(), masterPh: new Map(), masterStyles: {}, assets, assetMeta, warnings, slideNo: i + 1, idMap: new Map(), slideTargets } as SlideCtx;
      master = { ph: collectPh(findAll(mx, 'p:spTree')[0]), styles: { title: child(ts, 'p:titleStyle'), body: child(ts, 'p:bodyStyle'), other: child(ts, 'p:otherStyle') }, map, bg: await readBackground(findAll(mx, 'p:cSld')[0], tmpCtx) };
      masterCache.set(mPart, master);
    }
    const ovr = path(sld, 'p:clrMapOvr', 'p:overrideClrMapping');
    const cc: ColorCtx = { scheme, map: ovr ? { ...ovr.attrs } : master?.map ?? baseCc.map };
    const ctx: SlideCtx = {
      zip, part, rels, cc, theme, fonts,
      layoutPh: collectPh(findAll(layoutXml, 'p:spTree')[0]),
      masterPh: master?.ph ?? new Map(),
      masterStyles: master?.styles ?? {},
      assets, assetMeta, warnings, slideNo: i + 1, idMap: new Map(), slideTargets,
    };
    const cSld = child(sld, 'p:cSld');
    const elements: SlideElement[] = [];
    await walkTree(child(cSld, 'p:spTree')?.children ?? [], ctx, identity, elements);
    // Resolve connector endpoints now that all shapes have ids.
    for (const el of elements) {
      if (el.type !== 'line') continue;
      if (el.from?.startsWith('ooxml:')) el.from = ctx.idMap.get(el.from.slice(6));
      if (el.to?.startsWith('ooxml:')) el.to = ctx.idMap.get(el.to.slice(6));
    }
    const layoutCtx = { ...ctx, rels: layoutRels, part: layoutPart ?? part };
    const bg = (await readBackground(cSld, ctx)) ?? (layoutXml ? await readBackground(findAll(layoutXml, 'p:cSld')[0], layoutCtx) : undefined) ?? master?.bg ?? null;
    let notes = '';
    const notesRel = [...rels.values()].find((r) => r.type === REL.notesSlide);
    if (notesRel) {
      const nx = await zip.xml(notesRel.target);
      for (const sp of findAll(nx, 'p:sp')) {
        const ph = path(sp, 'p:nvSpPr', 'p:nvPr', 'p:ph');
        if (attr(ph, 'type') === 'body') notes = children(path(sp, 'p:txBody'), 'a:p').map((p) => findAll(p, 'a:t').map((t) => t.text).join('')).join('\n').trim();
      }
    }
    if (findAll(cSld, 'p:custDataLst').length) warnings.push({ slide: i + 1, code: 'custom-data', message: 'Custom XML data attached to the slide was not imported' });
    slides.push({
      id: slideTargets.get(part)!,
      layout: guessLayout(layoutXml),
      background: bg,
      elements,
      notes,
      hidden: attr(sld, 'show') === '0',
      section: sectionOf.get(sldId) || undefined,
      transition: readTransition(sld),
      animations: readTiming(sld, ctx, { w: width, h: height }),
    });
  }
  // Only the first slide of each section carries the section name.
  let last: string | undefined;
  for (const s of slides) {
    if (s.section === last) s.section = undefined;
    else last = s.section;
  }
  const title = findAll(await zip.xml('docProps/core.xml'), 'dc:title')[0]?.text || sourceName.replace(/\.[^.]+$/, '');
  return {
    presentation: {
      id: uid('dk'),
      title,
      width,
      height,
      theme,
      slides,
      assets: assetMeta,
      importReport: { source: sourceName, warnings: dedupeWarnings(warnings) },
    },
    assets,
  };
}

function dedupeWarnings(ws: ImportWarning[]): ImportWarning[] {
  const seen = new Set<string>();
  return ws.filter((w) => {
    const k = `${w.slide}|${w.code}|${w.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
