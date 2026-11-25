import { XMLParser } from 'fast-xml-parser';

/**
 * Minimal, safe XML tree.
 *
 * Security: documents containing a DOCTYPE or ENTITY declaration are rejected
 * outright, so no external-entity (XXE) or entity-expansion ("billion laughs")
 * processing can happen. fast-xml-parser never fetches external resources.
 */
export interface XNode {
  name: string;
  attrs: Record<string, string>;
  children: XNode[];
  text: string;
}

export class UnsafeXmlError extends Error {}

export const MAX_XML_BYTES = 64 * 1024 * 1024;

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
  allowBooleanAttributes: true,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: false,
  processEntities: true, // only the five predefined XML entities + numeric refs
  htmlEntities: false,
});

export function parseXml(src: string): XNode {
  if (src.length > MAX_XML_BYTES) throw new UnsafeXmlError('XML part exceeds size limit');
  if (/<!DOCTYPE/i.test(src) || /<!ENTITY/i.test(src)) throw new UnsafeXmlError('XML DOCTYPE/ENTITY declarations are not allowed');
  const raw = parser.parse(src) as unknown[];
  const root: XNode = { name: '#document', attrs: {}, children: convert(raw), text: '' };
  return root;
}

function convert(list: unknown[]): XNode[] {
  const out: XNode[] = [];
  for (const item of list) {
    const obj = item as Record<string, unknown>;
    const attrs = (obj[':@'] as Record<string, string>) ?? {};
    for (const key of Object.keys(obj)) {
      if (key === ':@') continue;
      if (key === '#text') {
        out.push({ name: '#text', attrs: {}, children: [], text: String(obj[key]) });
        continue;
      }
      if (key.startsWith('?')) continue; // processing instruction / xml decl
      const kids = convert((obj[key] as unknown[]) ?? []);
      out.push({ name: key, attrs, children: kids, text: kids.filter((k) => k.name === '#text').map((k) => k.text).join('') });
    }
  }
  return out;
}

/* ───────────── query helpers ───────────── */

export function child(n: XNode | undefined, name: string): XNode | undefined {
  return n?.children.find((c) => c.name === name);
}

export function children(n: XNode | undefined, name?: string): XNode[] {
  if (!n) return [];
  return name ? n.children.filter((c) => c.name === name) : n.children.filter((c) => c.name !== '#text');
}

/** Follow a path of element names: path(n, 'p:cSld', 'p:spTree'). */
export function path(n: XNode | undefined, ...names: string[]): XNode | undefined {
  let cur = n;
  for (const nm of names) cur = child(cur, nm);
  return cur;
}

/** Depth-first search for all descendants named `name`. */
export function findAll(n: XNode | undefined, name: string, out: XNode[] = []): XNode[] {
  if (!n) return out;
  for (const c of n.children) {
    if (c.name === name) out.push(c);
    findAll(c, name, out);
  }
  return out;
}

export function attr(n: XNode | undefined, name: string): string | undefined {
  return n?.attrs[name];
}

export function num(n: XNode | undefined, name: string, fallback = 0): number {
  const v = n?.attrs[name];
  if (v === undefined) return fallback;
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

/** Serialise a node back to XML (used to preserve unsupported content verbatim). */
export function serialize(n: XNode): string {
  if (n.name === '#text') return esc(n.text);
  const a = Object.entries(n.attrs).map(([k, v]) => ` ${k}="${escAttr(v)}"`).join('');
  const kids = n.children.map(serialize).join('');
  return kids ? `<${n.name}${a}>${kids}</${n.name}>` : `<${n.name}${a}/>`;
}

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escAttr(s: string): string {
  return esc(s).replace(/"/g, '&quot;');
}

/** Strip characters that are illegal in XML 1.0. */
export function xmlSafe(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '');
}
