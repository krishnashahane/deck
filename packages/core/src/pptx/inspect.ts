import { openZipSafely } from '../security';
import { attr, child, children, findAll } from '../xml';
import { REL } from './ns';
import { resolvePart } from './import';

/**
 * Structural validation of an Open XML presentation package. Used by tests
 * and by the import dialog to show what a file contains before it is opened.
 */
export interface PackageReport {
  parts: string[];
  slideCount: number;
  slideSize: { cx: number; cy: number };
  slides: { part: string; shapes: number; pictures: number; connectors: number; frames: number; groups: number; hasTiming: boolean; transition: string | null; hidden: boolean; notes: boolean; text: string[] }[];
  errors: string[];
  macros: boolean;
}

export async function inspectPptx(bytes: Uint8Array): Promise<PackageReport> {
  const zip = await openZipSafely(bytes);
  const errors: string[] = [];
  const parts = zip.list().sort();
  const partSet = new Set(parts);
  const ct = await zip.xml('[Content_Types].xml');
  if (!ct) errors.push('missing [Content_Types].xml');
  const defaults = new Set(findAll(ct, 'Default').map((d) => (attr(d, 'Extension') ?? '').toLowerCase()));
  const overrides = new Set(findAll(ct, 'Override').map((o) => (attr(o, 'PartName') ?? '').slice(1)));
  for (const o of overrides) if (!partSet.has(o)) errors.push(`override for missing part ${o}`);
  for (const p of parts) {
    const ext = p.split('.').pop()!.toLowerCase();
    if (!overrides.has(p) && !defaults.has(ext)) errors.push(`no content type for ${p}`);
  }
  // Every internal relationship must resolve to an existing part.
  for (const rp of parts.filter((p) => p.endsWith('.rels'))) {
    const src = rp.replace(/_rels\//, '').replace(/\.rels$/, '');
    const x = await zip.xml(rp);
    const ids = new Set<string>();
    for (const r of findAll(x, 'Relationship')) {
      const id = attr(r, 'Id') ?? '';
      if (ids.has(id)) errors.push(`duplicate relationship id ${id} in ${rp}`);
      ids.add(id);
      if (attr(r, 'TargetMode') === 'External') continue;
      const target = resolvePart(src === '' || rp === '_rels/.rels' ? '' : src, attr(r, 'Target') ?? '');
      if (!target || !partSet.has(target)) errors.push(`broken relationship ${id} in ${rp} → ${attr(r, 'Target')}`);
    }
  }
  const pres = await zip.xml('ppt/presentation.xml');
  const presNode = findAll(pres, 'p:presentation')[0];
  const sz = child(presNode, 'p:sldSz');
  const relsX = await zip.xml('ppt/_rels/presentation.xml.rels');
  const relMap = new Map(findAll(relsX, 'Relationship').map((r) => [attr(r, 'Id'), attr(r, 'Target')]));
  const slides: PackageReport['slides'] = [];
  for (const sid of children(child(presNode, 'p:sldIdLst'), 'p:sldId')) {
    const target = relMap.get(attr(sid, 'r:id'));
    if (!target) { errors.push(`slide id ${attr(sid, 'id')} has no relationship`); continue; }
    const part = resolvePart('ppt/presentation.xml', target)!;
    const sx = await zip.xml(part);
    const sld = findAll(sx, 'p:sld')[0];
    if (!sld) { errors.push(`slide part ${part} invalid`); continue; }
    const tree = findAll(sld, 'p:spTree')[0];
    const srels = await zip.xml(part.replace('slides/', 'slides/_rels/') + '.rels');
    const tr = child(sld, 'p:transition');
    slides.push({
      part,
      shapes: findAll(tree, 'p:sp').length,
      pictures: findAll(tree, 'p:pic').length,
      connectors: findAll(tree, 'p:cxnSp').length,
      frames: findAll(tree, 'p:graphicFrame').length,
      groups: findAll(tree, 'p:grpSp').length,
      hasTiming: Boolean(child(sld, 'p:timing')),
      transition: tr ? (children(tr)[0]?.name ?? 'none') : null,
      hidden: attr(sld, 'show') === '0',
      notes: findAll(srels, 'Relationship').some((r) => attr(r, 'Type') === REL.notesSlide),
      text: findAll(tree, 'a:t').map((t) => t.text),
    });
  }
  return {
    parts,
    slideCount: slides.length,
    slideSize: { cx: Number(attr(sz, 'cx')), cy: Number(attr(sz, 'cy')) },
    slides,
    errors,
    macros: parts.some((p) => /vbaProject\.bin$/i.test(p)),
  };
}
