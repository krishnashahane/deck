import type JSZip from 'jszip';
import { parseXml, serialize, type XNode } from './xml';

/* ───────────── content sniffing ───────────── */

export type Sniffed =
  | 'image/png'
  | 'image/jpeg'
  | 'image/gif'
  | 'image/webp'
  | 'image/svg+xml'
  | 'image/bmp'
  | 'image/tiff'
  | 'video/mp4'
  | 'video/webm'
  | 'video/quicktime'
  | 'audio/mpeg'
  | 'audio/wav'
  | 'audio/ogg'
  | 'audio/mp4'
  | 'application/zip'
  | 'application/pdf'
  | 'unknown';

const starts = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);
const ascii = (b: Uint8Array, at: number, len: number) => String.fromCharCode(...b.subarray(at, at + len));

/** Identify a file by its bytes, never by its extension. */
export function sniff(b: Uint8Array): Sniffed {
  if (b.length < 4) return 'unknown';
  if (starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (starts(b, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a') return 'image/gif';
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'image/webp';
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WAVE') return 'audio/wav';
  if (ascii(b, 0, 2) === 'BM') return 'image/bmp';
  if (starts(b, [0x49, 0x49, 0x2a, 0x00]) || starts(b, [0x4d, 0x4d, 0x00, 0x2a])) return 'image/tiff';
  if (starts(b, [0x1a, 0x45, 0xdf, 0xa3])) return 'video/webm';
  if (ascii(b, 0, 4) === 'OggS') return 'audio/ogg';
  if (ascii(b, 0, 3) === 'ID3' || (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0)) return 'audio/mpeg';
  if (ascii(b, 4, 4) === 'ftyp') {
    const brand = ascii(b, 8, 4);
    if (brand === 'qt  ') return 'video/quicktime';
    if (brand.startsWith('M4A')) return 'audio/mp4';
    return 'video/mp4';
  }
  if (starts(b, [0x50, 0x4b, 0x03, 0x04])) return 'application/zip';
  if (ascii(b, 0, 5) === '%PDF-') return 'application/pdf';
  const head = new TextDecoder().decode(b.subarray(0, Math.min(b.length, 1024))).trimStart().toLowerCase();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'image/svg+xml';
  return 'unknown';
}

export const IMAGE_TYPES = new Set<Sniffed>(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp']);
export const MEDIA_TYPES = new Set<Sniffed>(['video/mp4', 'video/webm', 'video/quicktime', 'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4']);

export const MAX_ASSET_BYTES = 50 * 1024 * 1024;

/* ───────────── safe ZIP ───────────── */

export interface ZipLimits {
  maxEntries: number;
  maxTotalBytes: number; // declared uncompressed total
  maxEntryBytes: number;
  maxRatio: number; // uncompressed / compressed per entry
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxEntries: 10_000,
  maxTotalBytes: 1024 * 1024 * 1024,
  maxEntryBytes: 256 * 1024 * 1024,
  maxRatio: 200,
};

export class UnsafeArchiveError extends Error {}

/** Reject absolute paths, parent traversal, backslashes, drive letters and control characters. */
export function safeZipPath(name: string): boolean {
  if (!name || name.length > 1024) return false;
  if (name.startsWith('/') || name.includes('\\') || /^[a-zA-Z]:/.test(name)) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(name)) return false;
  return !name.split('/').some((seg) => seg === '..');
}

interface ZipEntryInternals {
  _data?: { uncompressedSize?: number; compressedSize?: number };
}

/**
 * Open a ZIP with bomb and traversal defences. Declared sizes are checked
 * from the central directory before anything is inflated; actual inflated
 * sizes are re-checked by `readEntry`.
 */
export async function openZipSafely(bytes: Uint8Array, limits: ZipLimits = DEFAULT_ZIP_LIMITS): Promise<SafeZip> {
  if (sniff(bytes) !== 'application/zip') throw new UnsafeArchiveError('Not a ZIP package (content check failed)');
  const { default: JSZipImpl } = await import('jszip');
  const zip = await JSZipImpl.loadAsync(bytes, { checkCRC32: true, createFolders: false });
  const names = Object.keys(zip.files);
  if (names.length > limits.maxEntries) throw new UnsafeArchiveError(`Too many entries (${names.length})`);
  let total = 0;
  for (const n of names) {
    if (!safeZipPath(n)) throw new UnsafeArchiveError(`Unsafe entry path: ${JSON.stringify(n.slice(0, 120))}`);
    const f = zip.files[n]! as unknown as ZipEntryInternals & JSZip.JSZipObject;
    if (f.dir) continue;
    const u = f._data?.uncompressedSize ?? 0;
    const c = f._data?.compressedSize ?? 0;
    if (u > limits.maxEntryBytes) throw new UnsafeArchiveError(`Entry too large: ${n}`);
    if (c > 0 && u / c > limits.maxRatio && u > 1024 * 1024) throw new UnsafeArchiveError(`Suspicious compression ratio in ${n}`);
    total += u;
    if (total > limits.maxTotalBytes) throw new UnsafeArchiveError('Archive expands beyond the size limit');
  }
  return new SafeZip(zip, limits);
}

export class SafeZip {
  constructor(readonly zip: JSZip, private limits: ZipLimits) {}

  has(name: string): boolean {
    const f = this.zip.files[name];
    return Boolean(f && !f.dir);
  }

  list(): string[] {
    return Object.keys(this.zip.files).filter((n) => !this.zip.files[n]!.dir);
  }

  async bytes(name: string): Promise<Uint8Array | undefined> {
    const f = this.zip.file(name);
    if (!f) return undefined;
    const out = await f.async('uint8array');
    if (out.length > this.limits.maxEntryBytes) throw new UnsafeArchiveError(`Entry inflated beyond limit: ${name}`);
    return out;
  }

  async text(name: string): Promise<string | undefined> {
    const b = await this.bytes(name);
    return b ? new TextDecoder().decode(b) : undefined;
  }

  async xml(name: string): Promise<XNode | undefined> {
    const t = await this.text(name);
    return t === undefined ? undefined : parseXml(t);
  }
}

/* ───────────── SVG sanitisation (allow-list) ───────────── */

const SVG_ELEMENTS = new Set([
  'svg', 'g', 'defs', 'symbol', 'use', 'title', 'desc', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'textPath', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'pattern', 'filter',
  'feGaussianBlur', 'feOffset', 'feBlend', 'feColorMatrix', 'feComposite', 'feFlood', 'feMerge', 'feMergeNode', 'feDropShadow',
  'marker', 'image', 'style',
]);

const SVG_ATTR = /^(id|class|x|y|x1|y1|x2|y2|cx|cy|r|rx|ry|d|points|width|height|viewBox|preserveAspectRatio|transform|fill|fill-opacity|fill-rule|stroke|stroke-width|stroke-opacity|stroke-linecap|stroke-linejoin|stroke-dasharray|stroke-dashoffset|stroke-miterlimit|opacity|offset|stop-color|stop-opacity|gradientUnits|gradientTransform|spreadMethod|fx|fy|clip-path|clipPathUnits|clip-rule|mask|maskUnits|patternUnits|patternTransform|filter|stdDeviation|dx|dy|in|in2|result|mode|values|type|operator|k1|k2|k3|k4|flood-color|flood-opacity|font-family|font-size|font-weight|font-style|text-anchor|dominant-baseline|letter-spacing|xml:space|xmlns|xmlns:xlink|version|href|xlink:href|markerWidth|markerHeight|refX|refY|orient|markerUnits|style|display|visibility|color|vector-effect|paint-order)$/;

/** Reject URLs that could fetch or execute: only same-document fragments and raster data URIs are allowed. */
function safeRef(v: string): boolean {
  const s = v.trim().toLowerCase();
  return s.startsWith('#') || /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(s);
}

function cleanStyle(css: string): string {
  // Drop anything that can load resources or run expressions.
  return css.replace(/@import[^;]*;?/gi, '').replace(/url\(\s*(?!['"]?#)[^)]*\)/gi, 'none').replace(/expression\s*\(/gi, '').replace(/javascript:/gi, '');
}

/** Sanitise SVG markup with a strict allow-list. Throws if it is not an SVG document. */
export function sanitizeSvg(src: string): string {
  const doc = parseXml(src.replace(/^﻿/, ''));
  const root = doc.children.find((c) => c.name === 'svg');
  if (!root) throw new Error('Not an SVG document');
  const clean = (n: XNode): XNode | null => {
    if (n.name === '#text') return n;
    if (!SVG_ELEMENTS.has(n.name)) return null;
    const attrs: Record<string, string> = {};
    for (const [k, v] of Object.entries(n.attrs)) {
      if (/^on/i.test(k) || !SVG_ATTR.test(k)) continue;
      if ((k === 'href' || k === 'xlink:href') && !safeRef(v)) continue;
      if (/url\(/i.test(v) && !/url\(\s*['"]?#/.test(v)) continue;
      attrs[k] = k === 'style' ? cleanStyle(v) : v;
    }
    const kids = n.children.map(clean).filter((x): x is XNode => x !== null);
    if (n.name === 'style') return { ...n, attrs: {}, children: kids.map((k) => ({ ...k, text: cleanStyle(k.text) })) };
    return { ...n, attrs, children: kids };
  };
  const out = clean(root)!;
  if (!out.attrs.xmlns) out.attrs.xmlns = 'http://www.w3.org/2000/svg';
  return serialize(out);
}

/* ───────────── URLs ───────────── */

/** Hyperlinks: only http(s) and mailto are allowed to be activated. */
export function safeHref(url: string): string | null {
  try {
    const u = new URL(url);
    return ['http:', 'https:', 'mailto:'].includes(u.protocol) ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Strip every non-printing / bidi-override char from user-visible names. */
export function cleanLabel(s: string, max = 200): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, '').slice(0, max);
}
