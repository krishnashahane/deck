import JSZip from 'jszip';
import { buildSteps } from '../animation';
import { layoutById } from '../layouts';
import type {
  Animation,
  ChartElement,
  Fill,
  ImageElement,
  LineElement,
  MediaElement,
  Paragraph,
  Presentation,
  ShapeElement,
  ShapeKind,
  Slide,
  SlideElement,
  Stroke,
  TableElement,
  TextElement,
  TextStyle,
  Transition,
} from '../model';
import { escAttr as ea, esc as et, xmlSafe } from '../xml';
import { ANGLE, CT, EMU, MEDIA_EXT_URI, NS, REL, SECTION_EXT_URI } from './ns';

export interface ExportOptions {
  /** Asset bytes by asset id. */
  assets: Record<string, Uint8Array>;
  /** Optional rasteriser for SVG images (browser only) so consumers without SVG support get a PNG fallback. */
  rasterizeSvg?: (svg: Uint8Array, w: number, h: number) => Promise<Uint8Array>;
  /** Application name written to docProps/app.xml. */
  appName?: string;
}

export interface ExportResult {
  bytes: Uint8Array;
  warnings: string[];
}

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const e = (v: number) => Math.round(v * EMU);
const hex = (c: string) => {
  const m = /^#?([0-9a-f]{6})/i.exec(c.trim());
  return (m ? m[1]! : '000000').toUpperCase();
};
const alpha = (c: string) => {
  const m = /^#?[0-9a-f]{6}([0-9a-f]{2})$/i.exec(c.trim());
  return m ? Math.round((parseInt(m[1]!, 16) / 255) * 100000) : null;
};
const clr = (c: string) => {
  const a = alpha(c);
  return a === null ? `<a:srgbClr val="${hex(c)}"/>` : `<a:srgbClr val="${hex(c)}"><a:alpha val="${a}"/></a:srgbClr>`;
};
const t = (s: string) => et(xmlSafe(s));

const PRST: Record<ShapeKind, string> = {
  rect: 'rect',
  roundRect: 'roundRect',
  ellipse: 'ellipse',
  triangle: 'triangle',
  diamond: 'diamond',
  pentagon: 'pentagon',
  hexagon: 'hexagon',
  star: 'star5',
  arrowRight: 'rightArrow',
  chevron: 'chevron',
  speech: 'wedgeRoundRectCallout',
  cloud: 'cloud',
  heart: 'heart',
  plus: 'mathPlus',
};

class Rels {
  private items: { id: string; type: string; target: string; external?: boolean }[] = [];
  add(type: string, target: string, external = false): string {
    const found = this.items.find((i) => i.type === type && i.target === target);
    if (found) return found.id;
    const id = `rId${this.items.length + 1}`;
    this.items.push({ id, type, target, external });
    return id;
  }
  xml(): string {
    return (
      XML_DECL +
      `<Relationships xmlns="${NS.rel}">` +
      this.items.map((i) => `<Relationship Id="${i.id}" Type="${i.type}" Target="${ea(i.target)}"${i.external ? ' TargetMode="External"' : ''}/>`).join('') +
      '</Relationships>'
    );
  }
}

function extFor(mime: string): string {
  const m: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpeg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/bmp': 'bmp',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/ogg': 'ogg',
    'audio/mp4': 'm4a',
  };
  return m[mime] ?? 'bin';
}

// 1×1 dark PNG used as a poster frame when a video has none.
const POSTER_PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

/* ───────────── fills & lines ───────────── */

function fillXml(f: Fill | null | undefined, rels?: Rels, media?: MediaRegistry): string {
  if (!f || f.kind === 'none') return '<a:noFill/>';
  switch (f.kind) {
    case 'solid':
      return `<a:solidFill>${clr(f.color)}</a:solidFill>`;
    case 'linear':
    case 'radial': {
      const stops = f.stops.map((s) => `<a:gs pos="${Math.round(s.offset * 100000)}">${clr(s.color)}</a:gs>`).join('');
      const kind = f.kind === 'linear' ? `<a:lin ang="${Math.round((((f.angle + 270) % 360) + 360) % 360 * ANGLE)}" scaled="0"/>` : '<a:path path="circle"><a:fillToRect l="50000" t="50000" r="50000" b="50000"/></a:path>';
      return `<a:gradFill rotWithShape="1"><a:gsLst>${stops}</a:gsLst>${kind}</a:gradFill>`;
    }
    case 'image': {
      const rid = rels && media ? media.ref(f.src, rels) : null;
      if (!rid) return '<a:noFill/>';
      return `<a:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></a:blipFill>`;
    }
  }
}

function lineXml(s: Stroke | null | undefined, extra = ''): string {
  if (!s) return '<a:ln><a:noFill/></a:ln>';
  const dash = s.dash === 'dash' ? '<a:prstDash val="dash"/>' : s.dash === 'dot' ? '<a:prstDash val="sysDot"/>' : '';
  return `<a:ln w="${e(s.width)}"><a:solidFill>${clr(s.color)}</a:solidFill>${dash}${extra}</a:ln>`;
}

function xfrm(el: SlideElement, flip = ''): string {
  const rot = el.rotation ? ` rot="${Math.round((((el.rotation % 360) + 360) % 360) * ANGLE)}"` : '';
  return `<a:xfrm${rot}${flip}><a:off x="${e(el.x)}" y="${e(el.y)}"/><a:ext cx="${Math.max(0, e(el.w))}" cy="${Math.max(0, e(el.h))}"/></a:xfrm>`;
}

/* ───────────── text ───────────── */

function runXml(r: Paragraph['runs'][number], style: TextStyle, rels: Rels, lang = 'en-US'): string {
  const attrs = [`lang="${lang}"`, `sz="${Math.round((r.size ?? style.size) * 100)}"`];
  const bold = r.bold ?? style.bold;
  const italic = r.italic ?? style.italic;
  if (bold) attrs.push('b="1"');
  if (italic) attrs.push('i="1"');
  if (r.underline) attrs.push('u="sng"');
  if (r.strike) attrs.push('strike="sngStrike"');
  if (style.letterSpacing) attrs.push(`spc="${Math.round(style.letterSpacing * (r.size ?? style.size) * 100)}"`);
  const font = r.font ?? style.font;
  let inner = `<a:solidFill>${clr(r.color ?? style.color)}</a:solidFill>`;
  if (style.effect === 'shadow') inner = `<a:effectLst><a:outerShdw blurRad="38100" dist="25400" dir="5400000"><a:srgbClr val="000000"><a:alpha val="45000"/></a:srgbClr></a:outerShdw></a:effectLst>` + inner;
  if (r.highlight) inner += `<a:highlight>${clr(r.highlight)}</a:highlight>`;
  inner += `<a:latin typeface="${ea(font)}"/><a:ea typeface="${ea(font)}"/><a:cs typeface="${ea(font)}"/>`;
  if (r.link) inner += `<a:hlinkClick r:id="${rels.add(REL.hyperlink, r.link, true)}"/>`;
  // Line breaks inside a run become <a:br/>.
  const parts = r.text.split('\n');
  return parts.map((p, i) => (i ? `<a:br><a:rPr ${attrs.join(' ')}/></a:br>` : '') + `<a:r><a:rPr ${attrs.join(' ')}>${inner}</a:rPr><a:t>${t(p)}</a:t></a:r>`).join('');
}

function paragraphsXml(ps: Paragraph[], style: TextStyle, rels: Rels): string {
  const algn = (a?: string) => ({ left: 'l', center: 'ctr', right: 'r', justify: 'just' })[a ?? style.align] ?? 'l';
  return ps
    .map((p) => {
      const lvl = p.level ?? 0;
      const size = p.runs[0]?.size ?? style.size;
      const indentEmu = Math.round(size * 1.1 * 12700);
      const attrs = [`algn="${algn(p.align)}"`];
      if (lvl) attrs.push(`lvl="${lvl}"`);
      let bu = '<a:buNone/>';
      if (p.bullet === 'bullet' || p.bullet === 'number') {
        attrs.push(`marL="${indentEmu * (lvl + 1)}"`, `indent="${-indentEmu}"`);
        bu = p.bullet === 'bullet' ? '<a:buFont typeface="Arial"/><a:buChar char="•"/>' : '<a:buFont typeface="+mj-lt"/><a:buAutoNum type="arabicPeriod"/>';
      } else attrs.push('marL="0"', 'indent="0"');
      const lh = `<a:lnSpc><a:spcPct val="${Math.round((p.lineHeight ?? style.lineHeight) * 100000)}"/></a:lnSpc>`;
      const sb = `<a:spcBef><a:spcPts val="${Math.round((p.spaceBefore ?? 0) * 100)}"/></a:spcBef>`;
      const sa = `<a:spcAft><a:spcPts val="${Math.round((p.spaceAfter ?? 0) * 100)}"/></a:spcAft>`;
      const runs = p.runs.filter((r) => r.text.length).map((r) => runXml(r, style, rels)).join('');
      const end = `<a:endParaRPr lang="en-US" sz="${Math.round(size * 100)}" dirty="0"/>`;
      return `<a:p><a:pPr ${attrs.join(' ')}>${lh}${sb}${sa}${bu}</a:pPr>${runs}${end}</a:p>`;
    })
    .join('');
}

function bodyPr(style: TextStyle, wrap = true): string {
  const ins = e(style.padding);
  const anchor = { top: 't', middle: 'ctr', bottom: 'b' }[style.valign];
  const fit = style.autofit === 'shrink' ? '<a:normAutofit/>' : '<a:noAutofit/>';
  return `<a:bodyPr wrap="${wrap ? 'square' : 'none'}" lIns="${ins}" tIns="${ins}" rIns="${ins}" bIns="${ins}" anchor="${anchor}" rtlCol="0">${fit}</a:bodyPr>`;
}

function txBody(ps: Paragraph[], style: TextStyle, rels: Rels): string {
  const paras = ps.length ? ps : [{ runs: [] }];
  return `<p:txBody>${bodyPr(style)}<a:lstStyle/>${paragraphsXml(paras, style, rels)}</p:txBody>`;
}

/* ───────────── media registry ───────────── */

class MediaRegistry {
  private byAsset = new Map<string, string>(); // asset id → part path
  private counter = 0;
  readonly parts = new Map<string, Uint8Array>();
  readonly defaults = new Map<string, string>(); // ext → mime
  constructor(private pres: Presentation, private opts: ExportOptions, private warnings: string[]) {}

  /** Register an asset (asset:<id> or data: URL) and return a relationship id from `rels`. */
  ref(src: string, rels: Rels, type = REL.image): string | null {
    const part = this.part(src);
    return part ? rels.add(type, `../media/${part.split('/').pop()}`) : null;
  }

  part(src: string): string | null {
    let id: string, bytes: Uint8Array | undefined, mime: string;
    if (src.startsWith('asset:')) {
      id = src.slice(6);
      bytes = this.opts.assets[id];
      mime = this.pres.assets[id]?.mime ?? 'application/octet-stream';
    } else if (src.startsWith('data:')) {
      const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(src);
      if (!m) return null;
      id = `data-${src.length}-${src.slice(-24)}`;
      mime = m[1]!;
      bytes = m[2] ? Uint8Array.from(atob(m[3]!), (c) => c.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(m[3]!));
    } else {
      this.warnings.push(`External media reference not embedded: ${src.slice(0, 80)}`);
      return null;
    }
    if (!bytes) {
      this.warnings.push(`Missing bytes for asset ${id}`);
      return null;
    }
    const existing = this.byAsset.get(id);
    if (existing) return existing;
    const ext = extFor(mime);
    const name = `ppt/media/media${++this.counter}.${ext}`;
    this.parts.set(name, bytes);
    this.defaults.set(ext, mime);
    this.byAsset.set(id, name);
    return name;
  }

  addRaw(bytes: Uint8Array, ext: string, mime: string): string {
    const name = `ppt/media/media${++this.counter}.${ext}`;
    this.parts.set(name, bytes);
    this.defaults.set(ext, mime);
    return name;
  }
}

/* ───────────── elements ───────────── */

interface Ctx {
  rels: Rels;
  media: MediaRegistry;
  warnings: string[];
  slideIndex: number;
  nextId: () => number;
  spid: Map<string, number>;
  charts: { name: string; xml: string }[];
  slidePaths: Map<string, string>;
  opts: ExportOptions;
  rasterJobs: Promise<void>[];
  els: Map<string, SlideElement>;
}

function nvPr(el: SlideElement, _ctx: Ctx, extra = ''): string {
  const ph =
    el.placeholder === 'title' ? '<p:ph type="title"/>' : el.placeholder === 'subtitle' ? '<p:ph type="subTitle" idx="1"/>' : el.placeholder === 'body' ? '<p:ph idx="1"/>' : '';
  return `<p:nvPr>${ph}${extra}</p:nvPr>`;
}

function cNvPr(el: SlideElement, ctx: Ctx, descr = ''): string {
  const id = ctx.nextId();
  ctx.spid.set(el.id, id);
  let link = '';
  if (el.link?.kind === 'url') link = `<a:hlinkClick r:id="${ctx.rels.add(REL.hyperlink, el.link.url, true)}"/>`;
  else if (el.link?.kind === 'slide') {
    const target = ctx.slidePaths.get(el.link.slideId);
    if (target) link = `<a:hlinkClick r:id="${ctx.rels.add(REL.slide, target)}" action="ppaction://hlinksldjump"/>`;
  }
  const hidden = el.hidden ? ' hidden="1"' : '';
  const name = el.name || el.type;
  return `<p:cNvPr id="${id}" name="${ea(xmlSafe(name))}"${descr ? ` descr="${ea(xmlSafe(descr))}"` : ''}${hidden}>${link}</p:cNvPr>`;
}

function shadowXml(s: ShapeElement['shadow']): string {
  if (!s) return '';
  const dist = Math.round(Math.hypot(s.x, s.y) * EMU);
  const dir = Math.round(((((Math.atan2(s.y, s.x) * 180) / Math.PI) % 360) + 360) % 360 * ANGLE);
  return `<a:effectLst><a:outerShdw blurRad="${e(s.blur)}" dist="${dist}" dir="${dir}" algn="ctr" rotWithShape="0">${clr(s.color)}</a:outerShdw></a:effectLst>`;
}

function textEl(el: TextElement, ctx: Ctx): string {
  const geom = '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>';
  return (
    `<p:sp><p:nvSpPr>${cNvPr(el, ctx)}<p:cNvSpPr txBox="1"/>${nvPr(el, ctx)}</p:nvSpPr>` +
    `<p:spPr>${xfrm(el)}${geom}${fillXml(el.fill, ctx.rels, ctx.media)}${lineXml(el.stroke)}</p:spPr>` +
    txBody(el.paragraphs, el.style, ctx.rels) +
    '</p:sp>'
  );
}

function shapeEl(el: ShapeElement, ctx: Ctx): string {
  const prst = PRST[el.shape];
  const av = el.shape === 'roundRect' ? `<a:gd name="adj" fmla="val ${Math.round(Math.min(50000, (el.cornerRadius / Math.max(1, Math.min(el.w, el.h))) * 100000))}"/>` : '';
  return (
    `<p:sp><p:nvSpPr>${cNvPr(el, ctx)}<p:cNvSpPr/>${nvPr(el, ctx)}</p:nvSpPr>` +
    `<p:spPr>${xfrm(el)}<a:prstGeom prst="${prst}"><a:avLst>${av}</a:avLst></a:prstGeom>${fillXml(el.fill, ctx.rels, ctx.media)}${lineXml(el.stroke)}${shadowXml(el.shadow)}</p:spPr>` +
    txBody(el.paragraphs, el.style, ctx.rels) +
    '</p:sp>'
  );
}

function imageEl(el: ImageElement, ctx: Ctx): string {
  const part = ctx.media.part(el.src);
  if (!part) return '';
  let rid = ctx.rels.add(REL.image, `../media/${part.split('/').pop()}`);
  let svgExt = '';
  if (part.endsWith('.svg')) {
    // SVG is referenced through the svgBlip extension; the main blip must be a raster fallback.
    const svgRid = rid;
    const raster = ctx.opts.rasterizeSvg;
    const bytes = ctx.media.parts.get(part)!;
    if (raster) {
      const placeholder = ctx.media.addRaw(POSTER_PNG, 'png', 'image/png');
      rid = ctx.rels.add(REL.image, `../media/${placeholder.split('/').pop()}`);
      ctx.rasterJobs.push(raster(bytes, el.w, el.h).then((png) => void ctx.media.parts.set(placeholder, png)));
    } else ctx.warnings.push(`Slide ${ctx.slideIndex + 1}: SVG “${el.name}” exported without raster fallback`);
    svgExt = `<a:extLst><a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}"><asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="${svgRid}"/></a:ext></a:extLst>`;
  }
  const c = el.crop;
  const src = c.left || c.top || c.right || c.bottom ? `<a:srcRect l="${Math.round(c.left * 100000)}" t="${Math.round(c.top * 100000)}" r="${Math.round(c.right * 100000)}" b="${Math.round(c.bottom * 100000)}"/>` : '';
  const geom = el.mask === 'circle' ? 'ellipse' : el.mask === 'rounded' ? 'roundRect' : 'rect';
  const alphaMod = el.opacity < 1 ? `<a:alphaModFix amt="${Math.round(el.opacity * 100000)}"/>` : '';
  return (
    `<p:pic><p:nvPicPr>${cNvPr(el, ctx, el.alt)}<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr>${nvPr(el, ctx)}</p:nvPicPr>` +
    `<p:blipFill><a:blip r:embed="${rid}">${alphaMod}${svgExt}</a:blip>${src}<a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
    `<p:spPr>${xfrm(el)}<a:prstGeom prst="${geom}"><a:avLst/></a:prstGeom>${lineXml(el.stroke)}${shadowXml(el.shadow)}</p:spPr></p:pic>`
  );
}

function mediaEl(el: MediaElement, ctx: Ctx): string {
  const part = ctx.media.part(el.src);
  if (!part) return '';
  const file = `../media/${part.split('/').pop()}`;
  const linkRid = ctx.rels.add(el.kind === 'video' ? REL.video : REL.audio, file);
  const mediaRid = ctx.rels.add(REL.media, file);
  const posterPart = el.poster ? ctx.media.part(el.poster) : null;
  const poster = posterPart ?? ctx.media.addRaw(POSTER_PNG, 'png', 'image/png');
  const posterRid = ctx.rels.add(REL.image, `../media/${poster.split('/').pop()}`);
  const fileTag = el.kind === 'video' ? `<a:videoFile r:link="${linkRid}"/>` : `<a:audioFile r:link="${linkRid}"/>`;
  const ext = `<p:extLst><p:ext uri="${MEDIA_EXT_URI}"><p14:media xmlns:p14="${NS.p14}" r:embed="${mediaRid}"/></p:ext></p:extLst>`;
  return (
    `<p:pic><p:nvPicPr>${cNvPr(el, ctx)}<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr>${nvPr(el, ctx, fileTag + ext)}</p:nvPicPr>` +
    `<p:blipFill><a:blip r:embed="${posterRid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
    `<p:spPr>${xfrm(el)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
  );
}

function lineEl(el: LineElement, ctx: Ctx): string {
  const flipH = el.x2 < el.x1 ? ' flipH="1"' : '';
  const flipV = el.y2 < el.y1 ? ' flipV="1"' : '';
  const prst = el.curve === 'elbow' ? 'bentConnector3' : el.curve === 'curved' ? 'curvedConnector3' : 'line';
  const end = (k: string, tag: string) => (k === 'arrow' ? `<a:${tag} type="triangle" w="med" len="med"/>` : k === 'dot' ? `<a:${tag} type="oval" w="med" len="med"/>` : '');
  const box = { ...el, x: Math.min(el.x1, el.x2), y: Math.min(el.y1, el.y2), w: Math.abs(el.x2 - el.x1), h: Math.abs(el.y2 - el.y1) };
  // Connection sites of rect/roundRect presets: 0 top, 1 left, 2 bottom, 3 right.
  const site = (targetId: string | undefined, x: number, y: number): string => {
    const t = targetId ? ctx.els.get(targetId) : undefined;
    const sp = targetId ? ctx.spid.get(targetId) : undefined;
    if (!t || sp === undefined || !(t.type === 'text' || (t.type === 'shape' && (t.shape === 'rect' || t.shape === 'roundRect')))) return '';
    const d = [Math.abs(y - t.y), Math.abs(x - t.x), Math.abs(y - (t.y + t.h)), Math.abs(x - (t.x + t.w))];
    return `${sp}" idx="${d.indexOf(Math.min(...d))}`;
  };
  const from = site(el.from, el.x1, el.y1);
  const to = site(el.to, el.x2, el.y2);
  const cxn = `<p:cNvCxnSpPr>${from ? `<a:stCxn id="${from}"/>` : ''}${to ? `<a:endCxn id="${to}"/>` : ''}</p:cNvCxnSpPr>`;
  return (
    `<p:cxnSp><p:nvCxnSpPr>${cNvPr(el, ctx)}${cxn}<p:nvPr/></p:nvCxnSpPr>` +
    `<p:spPr>${xfrm(box, flipH + flipV)}<a:prstGeom prst="${prst}"><a:avLst/></a:prstGeom>${lineXml(el.stroke, end(el.startArrow, 'headEnd') + end(el.endArrow, 'tailEnd'))}</p:spPr></p:cxnSp>`
  );
}

function tableEl(el: TableElement, ctx: Ctx): string {
  const cols = el.colWidths.map((f) => `<a:gridCol w="${e(el.w * f)}"/>`).join('');
  const rowH = e(el.h / Math.max(1, el.rows.length));
  const border = (tag: string) => `<a:${tag} w="9525"><a:solidFill>${clr(el.style.border)}</a:solidFill></a:${tag}>`;
  const rows = el.rows
    .map((row, ri) => {
      const header = el.headerRow && ri === 0;
      const band = el.bandedRows && !header && ri % 2 === 0;
      const cells = row
        .map((cell) => {
          const fill = cell.fill ?? (header ? el.style.headerFill : band ? el.style.bandFill : null);
          const style: TextStyle = { font: el.style.font, size: el.style.size, color: cell.color ?? el.style.color, bold: cell.bold ?? header, align: cell.align ?? 'left', valign: 'middle', lineHeight: 1.2, letterSpacing: 0, autofit: 'none', padding: 8 };
          const paras = cell.text.split('\n').map((l) => ({ runs: [{ text: l }] }));
          const body = `<a:txBody><a:bodyPr/><a:lstStyle/>${paragraphsXml(paras, style, ctx.rels)}</a:txBody>`;
          return `<a:tc>${body}<a:tcPr anchor="ctr">${border('lnL')}${border('lnR')}${border('lnT')}${border('lnB')}${fill ? `<a:solidFill>${clr(fill)}</a:solidFill>` : '<a:noFill/>'}</a:tcPr></a:tc>`;
        })
        .join('');
      return `<a:tr h="${rowH}">${cells}</a:tr>`;
    })
    .join('');
  return (
    `<p:graphicFrame><p:nvGraphicFramePr>${cNvPr(el, ctx)}<p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>` +
    `<p:xfrm><a:off x="${e(el.x)}" y="${e(el.y)}"/><a:ext cx="${e(el.w)}" cy="${e(el.h)}"/></p:xfrm>` +
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="${el.headerRow ? 1 : 0}" bandRow="${el.bandedRows ? 1 : 0}"/><a:tblGrid>${cols}</a:tblGrid>${rows}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`
  );
}

const DEFAULT_SERIES = ['4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47'];

export function chartXml(el: ChartElement, palette: string[]): string {
  const strCache = (vals: string[]) => `<c:strCache><c:ptCount val="${vals.length}"/>${vals.map((v, i) => `<c:pt idx="${i}"><c:v>${t(v)}</c:v></c:pt>`).join('')}</c:strCache>`;
  const numCache = (vals: number[]) => `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${vals.length}"/>${vals.map((v, i) => `<c:pt idx="${i}"><c:v>${Number.isFinite(v) ? v : 0}</c:v></c:pt>`).join('')}</c:numCache>`;
  const color = (i: number, s: ChartElement['series'][number]) => hex(s.color ?? palette[i % palette.length] ?? `#${DEFAULT_SERIES[i % 6]}`);
  const isPie = el.chart === 'pie' || el.chart === 'donut';
  const series = el.series
    .map((s, i) => {
      const spPr = isPie
        ? ''
        : el.chart === 'line' || el.chart === 'scatter'
          ? `<c:spPr><a:ln w="38100"><a:solidFill><a:srgbClr val="${color(i, s)}"/></a:solidFill></a:ln></c:spPr>`
          : `<c:spPr><a:solidFill><a:srgbClr val="${color(i, s)}"/></a:solidFill></c:spPr>`;
      const dPts = isPie ? el.categories.map((_, ci) => `<c:dPt><c:idx val="${ci}"/><c:bubble3D val="0"/><c:spPr><a:solidFill><a:srgbClr val="${hex(palette[ci % palette.length] ?? `#${DEFAULT_SERIES[ci % 6]}`)}"/></a:solidFill></c:spPr></c:dPt>`).join('') : '';
      const labels = el.dataLabels ? '<c:dLbls><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>' : '';
      const tx = `<c:tx><c:strRef><c:f>Sheet1!$${String.fromCharCode(66 + i)}$1</c:f>${strCache([s.name])}</c:strRef></c:tx>`;
      const marker = el.chart === 'line' ? '<c:marker><c:symbol val="none"/></c:marker>' : el.chart === 'scatter' ? '<c:marker><c:symbol val="circle"/><c:size val="7"/></c:marker>' : '';
      if (el.chart === 'scatter') {
        const xs = el.categories.map((c, ci) => (Number.isFinite(Number(c)) ? Number(c) : ci + 1));
        return `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>${tx}${spPr}${marker}${labels}<c:xVal><c:numRef><c:f>Sheet1!$A$2:$A$${xs.length + 1}</c:f>${numCache(xs)}</c:numRef></c:xVal><c:yVal><c:numRef><c:f>Sheet1!$${String.fromCharCode(66 + i)}$2:$${String.fromCharCode(66 + i)}$${s.values.length + 1}</c:f>${numCache(s.values)}</c:numRef></c:yVal><c:smooth val="0"/></c:ser>`;
      }
      return `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>${tx}${spPr}${marker}${dPts}${labels}<c:cat><c:strRef><c:f>Sheet1!$A$2:$A$${el.categories.length + 1}</c:f>${strCache(el.categories)}</c:strRef></c:cat><c:val><c:numRef><c:f>Sheet1!$${String.fromCharCode(66 + i)}$2:$${String.fromCharCode(66 + i)}$${s.values.length + 1}</c:f>${numCache(s.values)}</c:numRef></c:val>${el.chart === 'line' ? '<c:smooth val="0"/>' : ''}</c:ser>`;
    })
    .join('');
  const axes = '<c:axId val="111"/><c:axId val="222"/>';
  const txPr = `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1400"><a:solidFill>${clr(el.style.color)}</a:solidFill><a:latin typeface="${ea(el.style.font)}"/></a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>`;
  const gridLn = `<c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill>${clr(el.style.grid)}</a:solidFill></a:ln></c:spPr></c:majorGridlines>`;
  let plot: string;
  let axXml = '';
  const catAx = `<c:catAx><c:axId val="111"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${el.chart === 'bar' ? 'l' : 'b'}"/><c:numFmt formatCode="General" sourceLinked="0"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln><a:solidFill>${clr(el.style.grid)}</a:solidFill></a:ln></c:spPr>${txPr}<c:crossAx val="222"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/></c:catAx>`;
  const valAx = (id: string, cross: string, pos: string) => `<c:valAx><c:axId val="${id}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${pos}"/>${id === '222' ? gridLn : ''}<c:numFmt formatCode="General" sourceLinked="0"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln><a:noFill/></a:ln></c:spPr>${txPr}<c:crossAx val="${cross}"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>`;
  switch (el.chart) {
    case 'bar':
    case 'column':
      plot = `<c:barChart><c:barDir val="${el.chart === 'bar' ? 'bar' : 'col'}"/><c:grouping val="clustered"/><c:varyColors val="0"/>${series}<c:gapWidth val="80"/>${axes}</c:barChart>`;
      axXml = catAx + valAx('222', '111', el.chart === 'bar' ? 'b' : 'l');
      break;
    case 'line':
      plot = `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${series}<c:marker val="1"/>${axes}</c:lineChart>`;
      axXml = catAx + valAx('222', '111', 'l');
      break;
    case 'area':
      plot = `<c:areaChart><c:grouping val="standard"/><c:varyColors val="0"/>${series}${axes}</c:areaChart>`;
      axXml = catAx + valAx('222', '111', 'l');
      break;
    case 'scatter':
      plot = `<c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>${series}${axes}</c:scatterChart>`;
      axXml = valAx('111', '222', 'b').replace('<c:crossBetween val="between"/>', '<c:crossBetween val="midCat"/>') + valAx('222', '111', 'l');
      break;
    case 'pie':
      plot = `<c:pieChart><c:varyColors val="1"/>${series}<c:firstSliceAng val="0"/></c:pieChart>`;
      break;
    case 'donut':
      plot = `<c:doughnutChart><c:varyColors val="1"/>${series}<c:firstSliceAng val="0"/><c:holeSize val="55"/></c:doughnutChart>`;
      break;
  }
  const title = el.title ? `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="1800" b="1"><a:solidFill>${clr(el.style.color)}</a:solidFill></a:rPr><a:t>${t(el.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>` : '<c:autoTitleDeleted val="1"/>';
  const legend = el.legend ? `<c:legend><c:legendPos val="b"/><c:overlay val="0"/>${txPr}</c:legend>` : '';
  return (
    XML_DECL +
    `<c:chartSpace xmlns:c="${NS.c}" xmlns:a="${NS.a}" xmlns:r="${NS.r}"><c:roundedCorners val="0"/><c:chart>${title}<c:plotArea><c:layout/>${plot}${axXml}<c:spPr><a:noFill/></c:spPr></c:plotArea>${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>${txPr}</c:chartSpace>`
  );
}

function chartEl(el: ChartElement, ctx: Ctx, palette: string[]): string {
  const n = ctx.charts.length + 1;
  const name = `ppt/charts/chart${n}.xml`;
  ctx.charts.push({ name, xml: chartXml(el, palette) });
  const rid = ctx.rels.add(REL.chart, `../charts/chart${n}.xml`);
  return (
    `<p:graphicFrame><p:nvGraphicFramePr>${cNvPr(el, ctx)}<p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>` +
    `<p:xfrm><a:off x="${e(el.x)}" y="${e(el.y)}"/><a:ext cx="${e(el.w)}" cy="${e(el.h)}"/></p:xfrm>` +
    `<a:graphic><a:graphicData uri="${NS.c}"><c:chart xmlns:c="${NS.c}" r:id="${rid}"/></a:graphicData></a:graphic></p:graphicFrame>`
  );
}

function elementXml(el: SlideElement, ctx: Ctx, palette: string[], theme: Presentation['theme']): string {
  switch (el.type) {
    case 'text': return textEl(el, ctx);
    case 'shape': return shapeEl(el, ctx);
    case 'image': return imageEl(el, ctx);
    case 'media': return mediaEl(el, ctx);
    case 'line': return lineEl(el, ctx);
    case 'table': return tableEl(el, ctx);
    case 'chart': return chartEl(el, ctx, palette);
    case 'equation': {
      // No equation markup is written; the LaTeX source is kept as text and the element name marks it for DECK re-import.
      ctx.warnings.push(`Slide ${ctx.slideIndex + 1}: equation exported as LaTeX text`);
      const asText: TextElement = {
        ...el,
        type: 'text',
        name: `DECK Equation`,
        paragraphs: [{ runs: [{ text: el.latex }], align: 'center' }],
        style: { font: theme.fonts.mono, size: Math.max(12, el.size * 0.6), color: el.color, align: 'center', valign: 'middle', lineHeight: 1.2, letterSpacing: 0, autofit: 'shrink', padding: 0 },
        fill: { kind: 'none' },
        stroke: null,
      };
      return textEl(asText, ctx);
    }
    case 'raw': {
      if (/\br:(id|embed|link)=/.test(el.xml)) {
        ctx.warnings.push(`Slide ${ctx.slideIndex + 1}: preserved object “${el.name}” references package parts and could not be re-exported`);
        return '';
      }
      ctx.nextId();
      return el.xml;
    }
  }
}

/* ───────────── transitions & timing ───────────── */

function transitionXml(tr: Transition): string {
  if (tr.kind === 'none' && !tr.advanceAfter) return '';
  const spd = tr.duration < 600 ? 'fast' : tr.duration < 900 ? 'med' : 'slow';
  const dir = ({ left: 'l', right: 'r', up: 'u', down: 'd' } as const)[tr.direction];
  const adv = tr.advanceAfter ? ` advTm="${Math.round(tr.advanceAfter)}"` : '';
  let inner = '';
  switch (tr.kind) {
    case 'fade': case 'smart-move': case 'flip': inner = '<p:fade/>'; break;
    case 'push': inner = `<p:push dir="${dir}"/>`; break;
    case 'wipe': inner = `<p:wipe dir="${dir}"/>`; break;
    case 'cover': inner = `<p:cover dir="${dir}"/>`; break;
    case 'zoom': inner = '<p:zoom/>'; break;
    case 'split': inner = '<p:split orient="horz" dir="out"/>'; break;
    case 'none': inner = ''; break;
  }
  return `<p:transition spd="${spd}"${adv}>${inner}</p:transition>`;
}

const PRESET: Record<string, { id: number; cls: string; sub?: (a: Animation) => number }> = {
  'entrance:appear': { id: 1, cls: 'entr' },
  'entrance:fly': { id: 2, cls: 'entr', sub: (a) => ({ up: 4, down: 1, left: 2, right: 8 })[a.direction] },
  'entrance:rise': { id: 2, cls: 'entr', sub: () => 4 },
  'entrance:fade': { id: 10, cls: 'entr' },
  'entrance:blur': { id: 10, cls: 'entr' },
  'entrance:wipe': { id: 22, cls: 'entr', sub: (a) => ({ up: 4, down: 1, left: 2, right: 8 })[a.direction] },
  'entrance:zoom': { id: 53, cls: 'entr', sub: () => 16 },
  'exit:appear': { id: 1, cls: 'exit' },
  'exit:fly': { id: 2, cls: 'exit', sub: (a) => ({ up: 1, down: 4, left: 8, right: 2 })[a.direction] },
  'exit:fade': { id: 10, cls: 'exit' },
  'exit:blur': { id: 10, cls: 'exit' },
  'exit:wipe': { id: 22, cls: 'exit', sub: (a) => ({ up: 1, down: 4, left: 8, right: 2 })[a.direction] },
  'exit:zoom': { id: 53, cls: 'exit', sub: () => 16 },
  'emphasis:pulse': { id: 26, cls: 'emph' },
  'emphasis:grow': { id: 6, cls: 'emph' },
  'emphasis:spin': { id: 8, cls: 'emph' },
  'emphasis:shake': { id: 26, cls: 'emph' },
  'emphasis:color': { id: 26, cls: 'emph' },
  'motion:path': { id: 0, cls: 'path' },
};

function timingXml(slide: Slide, ctx: Ctx, size: { w: number; h: number }): string {
  if (!slide.animations.length) return '';
  let id = 2;
  const nid = () => ++id;
  const tgt = (a: Animation) => `<p:tgtEl><p:spTgt spid="${ctx.spid.get(a.elementId)}"/></p:tgtEl>`;
  const set = (a: Animation, delay: number, val: 'visible' | 'hidden') =>
    `<p:set><p:cBhvr><p:cTn id="${nid()}" dur="1" fill="hold"><p:stCondLst><p:cond delay="${delay}"/></p:stCondLst></p:cTn>${tgt(a)}<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="${val}"/></p:to></p:set>`;
  const anim = (a: Animation, attr: string, from: string, to: string) =>
    `<p:anim calcmode="lin" valueType="num"><p:cBhvr additive="base"><p:cTn id="${nid()}" dur="${a.duration}" fill="hold"/>${tgt(a)}<p:attrNameLst><p:attrName>${attr}</p:attrName></p:attrNameLst></p:cBhvr><p:tavLst><p:tav tm="0"><p:val><p:strVal val="${from}"/></p:val></p:tav><p:tav tm="100000"><p:val><p:strVal val="${to}"/></p:val></p:tav></p:tavLst></p:anim>`;
  const behaviors = (a: Animation): string => {
    const enter = a.class === 'entrance';
    const dir = enter ? 'in' : 'out';
    const vis = enter ? set(a, 0, 'visible') : '';
    const hide = a.class === 'exit' ? set(a, Math.max(0, a.duration - 1), 'hidden') : '';
    const effect = (filter: string) => `<p:animEffect transition="${dir}" filter="${filter}"><p:cBhvr><p:cTn id="${nid()}" dur="${a.duration}"/>${tgt(a)}</p:cBhvr></p:animEffect>`;
    switch (`${a.class}:${a.effect}`) {
      case 'entrance:appear': return vis;
      case 'exit:appear': return set(a, 0, 'hidden');
      case 'entrance:fade': case 'entrance:blur': case 'exit:fade': case 'exit:blur': return vis + effect('fade') + hide;
      case 'entrance:wipe': case 'exit:wipe': return vis + effect(`wipe(${({ up: 'up', down: 'down', left: 'left', right: 'right' } as const)[a.direction]})`) + hide;
      case 'entrance:fly': case 'entrance:rise': case 'exit:fly': {
        const d = a.effect === 'rise' ? 'down' : a.direction;
        const off = { left: ['0-#ppt_w/2', '#ppt_y'], right: ['1+#ppt_w/2', '#ppt_y'], up: ['#ppt_x', '0-#ppt_h/2'], down: ['#ppt_x', '1+#ppt_h/2'] }[enter ? ({ left: 'right', right: 'left', up: 'down', down: 'up' } as const)[d] : d];
        const [ox, oy] = off as [string, string];
        return enter
          ? vis + anim(a, 'ppt_x', ox, '#ppt_x') + anim(a, 'ppt_y', oy, '#ppt_y')
          : anim(a, 'ppt_x', '#ppt_x', ox) + anim(a, 'ppt_y', '#ppt_y', oy) + hide;
      }
      case 'entrance:zoom': return vis + anim(a, 'ppt_w', '0', '#ppt_w') + anim(a, 'ppt_h', '0', '#ppt_h') + effect('fade');
      case 'exit:zoom': return anim(a, 'ppt_w', '#ppt_w', '0') + anim(a, 'ppt_h', '#ppt_h', '0') + effect('fade') + hide;
      case 'emphasis:grow': return `<p:animScale><p:cBhvr><p:cTn id="${nid()}" dur="${a.duration}" fill="hold"/>${tgt(a)}</p:cBhvr><p:by x="125000" y="125000"/></p:animScale>`;
      case 'emphasis:spin': return `<p:animRot by="21600000"><p:cBhvr><p:cTn id="${nid()}" dur="${a.duration}" fill="hold"/>${tgt(a)}<p:attrNameLst><p:attrName>r</p:attrName></p:attrNameLst></p:cBhvr></p:animRot>`;
      case 'emphasis:pulse': case 'emphasis:shake': case 'emphasis:color':
        return `<p:animScale><p:cBhvr><p:cTn id="${nid()}" dur="${Math.round(a.duration / 2)}" autoRev="1" fill="hold"/>${tgt(a)}</p:cBhvr><p:by x="105000" y="105000"/></p:animScale>`;
      case 'motion:path': {
        const pts = a.path?.length ? a.path : [{ x: 0, y: 0 }, { x: 200, y: 0 }];
        const d = pts.map((p, i) => `${i ? 'L' : 'M'} ${(p.x / size.w).toFixed(5)} ${(p.y / size.h).toFixed(5)}`).join(' ') + ' E';
        return `<p:animMotion origin="layout" path="${d}" pathEditMode="relative" ptsTypes=""><p:cBhvr><p:cTn id="${nid()}" dur="${a.duration}" fill="hold"/>${tgt(a)}<p:attrNameLst><p:attrName>ppt_x</p:attrName><p:attrName>ppt_y</p:attrName></p:attrNameLst></p:cBhvr></p:animMotion>`;
      }
    }
    return '';
  };
  const { auto, steps } = buildSteps(slide);
  const effectPar = (it: { anim: Animation; start: number }, nodeType: string) => {
    const a = it.anim;
    const p = PRESET[`${a.class}:${a.effect}`]!;
    const sub = p.sub ? ` presetSubtype="${p.sub(a)}"` : ' presetSubtype="0"';
    const inner = `<p:par><p:cTn id="${nid()}" presetID="${p.id}" presetClass="${p.cls}"${sub} fill="hold" grpId="0" nodeType="${nodeType}"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>${behaviors(a)}</p:childTnLst></p:cTn></p:par>`;
    return `<p:par><p:cTn id="${nid()}" fill="hold"><p:stCondLst><p:cond delay="${Math.round(it.start)}"/></p:stCondLst><p:childTnLst>${inner}</p:childTnLst></p:cTn></p:par>`;
  };
  const stepPar = (s: NonNullable<typeof auto>, first: 'clickEffect' | 'afterEffect' | 'withEffect', delay: string) => {
    const items = s.items.map((it, i) => effectPar(it, i === 0 ? first : it.anim.trigger === 'after' ? 'afterEffect' : 'withEffect')).join('');
    return `<p:par><p:cTn id="${nid()}" fill="hold"><p:stCondLst><p:cond delay="${delay}"/></p:stCondLst><p:childTnLst>${items}</p:childTnLst></p:cTn></p:par>`;
  };
  const pars: string[] = [];
  if (auto) pars.push(stepPar(auto, auto.items[0]!.anim.trigger === 'after' ? 'afterEffect' : 'withEffect', '0'));
  const interactive: string[] = [];
  for (const s of steps) {
    if (s.triggerElementId && ctx.spid.has(s.triggerElementId)) {
      const trig = ctx.spid.get(s.triggerElementId);
      const items = s.items.map((it, i) => effectPar(it, i === 0 ? 'clickEffect' : it.anim.trigger === 'after' ? 'afterEffect' : 'withEffect')).join('');
      interactive.push(`<p:seq concurrent="1" nextAc="seek"><p:cTn id="${nid()}" restart="whenNotActive" fill="hold" evtFilter="cancelBubble" nodeType="interactiveSeq"><p:stCondLst><p:cond evt="onClick" delay="0"><p:tgtEl><p:spTgt spid="${trig}"/></p:tgtEl></p:cond></p:stCondLst><p:endSync evt="end" delay="0"><p:rtn val="all"/></p:endSync><p:childTnLst><p:par><p:cTn id="${nid()}" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>${items}</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn><p:nextCondLst><p:cond evt="onClick" delay="0"><p:tgtEl><p:spTgt spid="${trig}"/></p:tgtEl></p:cond></p:nextCondLst></p:seq>`);
    } else pars.push(stepPar(s, 'clickEffect', 'indefinite'));
  }
  const main = `<p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>${pars.join('')}</p:childTnLst></p:cTn><p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst><p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq>`;
  const animated = [...new Set(slide.animations.map((a) => ctx.spid.get(a.elementId)).filter((x): x is number => x !== undefined))];
  const bld = animated.length ? `<p:bldLst>${animated.map((s) => `<p:bldP spid="${s}" grpId="0"/>`).join('')}</p:bldLst>` : '';
  return `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>${main}${interactive.join('')}</p:childTnLst></p:cTn></p:par></p:tnLst>${bld}</p:timing>`;
}

/* ───────────── package parts ───────────── */

function themeXml(pres: Presentation, name = 'DECK'): string {
  const c = pres.theme.colors;
  const sys = (tag: string, v: string) => `<a:${tag}><a:srgbClr val="${hex(v)}"/></a:${tag}>`;
  const fontScheme = `<a:fontScheme name="${ea(pres.theme.name)}"><a:majorFont><a:latin typeface="${ea(pres.theme.fonts.heading)}"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="${ea(pres.theme.fonts.body)}"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>`;
  const fill = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
  const fmt = `<a:fmtScheme name="DECK"><a:fillStyleLst>${fill}${fill}${fill}</a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst>${fill}${fill}${fill}</a:bgFillStyleLst></a:fmtScheme>`;
  return (
    XML_DECL +
    `<a:theme xmlns:a="${NS.a}" name="${ea(name)}"><a:themeElements><a:clrScheme name="${ea(pres.theme.name)}">` +
    sys('dk1', c.text) + sys('lt1', c.background) + sys('dk2', c.muted) + sys('lt2', c.surface) +
    sys('accent1', c.accent) + sys('accent2', c.accent2) + sys('accent3', c.accent3) + sys('accent4', c.accent4) + sys('accent5', c.muted) + sys('accent6', c.text) +
    sys('hlink', c.accent2) + sys('folHlink', c.muted) +
    `</a:clrScheme>${fontScheme}${fmt}</a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`
  );
}

const CLR_MAP = '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>';
const SPTREE_HEAD = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
const ROOT_NS = `xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"`;

function masterXml(layoutCount: number): string {
  const ids = Array.from({ length: layoutCount }, (_, i) => `<p:sldLayoutId id="${2147483649 + i}" r:id="rId${i + 1}"/>`).join('');
  const lvl = (sz: number) => `<a:lvl1pPr><a:defRPr sz="${sz}"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr>`;
  return (
    XML_DECL +
    `<p:sldMaster ${ROOT_NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${SPTREE_HEAD}</p:spTree></p:cSld>${CLR_MAP}` +
    `<p:sldLayoutIdLst>${ids}</p:sldLayoutIdLst><p:txStyles><p:titleStyle>${lvl(4400)}</p:titleStyle><p:bodyStyle>${lvl(2400)}</p:bodyStyle><p:otherStyle>${lvl(1800)}</p:otherStyle></p:txStyles></p:sldMaster>`
  );
}

function layoutXml(name: string, type: string): string {
  return XML_DECL + `<p:sldLayout ${ROOT_NS} type="${type}" preserve="1"><p:cSld name="${ea(name)}"><p:spTree>${SPTREE_HEAD}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
}

const LAYOUT_TYPE: Record<string, string> = {
  title: 'title',
  'title-content': 'obj',
  section: 'secHead',
  'two-column': 'twoObj',
  'title-only': 'titleOnly',
  'big-number': 'cust',
  quote: 'cust',
  'image-left': 'picTx',
  blank: 'blank',
};

function bgXml(slide: Slide, ctx: Ctx, pres: Presentation): string {
  const fill: Fill = slide.background ?? { kind: 'solid', color: pres.theme.colors.background };
  return `<p:bg><p:bgPr>${fillXml(fill, ctx.rels, ctx.media)}<a:effectLst/></p:bgPr></p:bg>`;
}

function notesXml(text: string, slideNum: number): string {
  const paras = text.split('\n').map((l) => `<a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>${t(l)}</a:t></a:r></a:p>`).join('');
  return (
    XML_DECL +
    `<p:notes ${ROOT_NS}><p:cSld><p:spTree>${SPTREE_HEAD}` +
    `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image ${slideNum}"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>` +
    `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes ${slideNum}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${paras}</p:txBody></p:sp>` +
    `</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`
  );
}

function notesMasterXml(): string {
  return (
    XML_DECL +
    `<p:notesMaster ${ROOT_NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${SPTREE_HEAD}` +
    `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg" idx="2"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="381000" y="685800"/><a:ext cx="6096000" cy="3429000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:sp>` +
    `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="4343400"/><a:ext cx="5486400" cy="4114800"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>` +
    `</p:spTree></p:cSld>${CLR_MAP}<p:notesStyle><a:lvl1pPr><a:defRPr sz="1200"/></a:lvl1pPr></p:notesStyle></p:notesMaster>`
  );
}

/** Export a presentation to an ECMA-376 .pptx package. */
export async function exportPptx(pres: Presentation, opts: ExportOptions): Promise<ExportResult> {
  const warnings: string[] = [];
  const zip = new JSZip();
  const media = new MediaRegistry(pres, opts, warnings);
  const palette = [pres.theme.colors.accent, pres.theme.colors.accent2, pres.theme.colors.accent3, pres.theme.colors.accent4, pres.theme.colors.muted, pres.theme.colors.text];
  const overrides: { part: string; type: string }[] = [];
  const layouts = ['title', 'title-content', 'section', 'two-column', 'title-only', 'big-number', 'quote', 'image-left', 'blank'] as const;
  const slidePaths = new Map(pres.slides.map((s, i) => [s.id, `slide${i + 1}.xml`]));
  const charts: Ctx['charts'] = [];
  const hasNotes = pres.slides.some((s) => s.notes.trim());
  const rasterJobs: Promise<void>[] = [];

  // Slides
  pres.slides.forEach((slide, i) => {
    const rels = new Rels();
    rels.add(REL.slideLayout, `../slideLayouts/slideLayout${layouts.indexOf(slide.layout as (typeof layouts)[number]) + 1 || layouts.length}.xml`);
    let n = 1;
    const ctx: Ctx = { rels, media, warnings, slideIndex: i, nextId: () => ++n, spid: new Map(), charts, slidePaths, opts, rasterJobs, els: new Map(slide.elements.map((x) => [x.id, x])) };
    const bg = bgXml(slide, ctx, pres);
    const shapes = slide.elements.map((el) => elementXml(el, ctx, palette, pres.theme)).join('');
    const timing = timingXml(slide, ctx, { w: pres.width, h: pres.height });
    const show = slide.hidden ? ' show="0"' : '';
    const xml =
      XML_DECL +
      `<p:sld ${ROOT_NS}${show}><p:cSld>${bg}<p:spTree>${SPTREE_HEAD}${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>${transitionXml(slide.transition)}${timing}</p:sld>`;
    if (slide.notes.trim()) {
      rels.add(REL.notesSlide, `../notesSlides/notesSlide${i + 1}.xml`);
      const nrels = new Rels();
      nrels.add(REL.notesMaster, '../notesMasters/notesMaster1.xml');
      nrels.add(REL.slide, `../slides/slide${i + 1}.xml`);
      zip.file(`ppt/notesSlides/notesSlide${i + 1}.xml`, notesXml(slide.notes, i + 1));
      zip.file(`ppt/notesSlides/_rels/notesSlide${i + 1}.xml.rels`, nrels.xml());
      overrides.push({ part: `/ppt/notesSlides/notesSlide${i + 1}.xml`, type: CT.notesSlide });
    }
    zip.file(`ppt/slides/slide${i + 1}.xml`, xml);
    zip.file(`ppt/slides/_rels/slide${i + 1}.xml.rels`, rels.xml());
    overrides.push({ part: `/ppt/slides/slide${i + 1}.xml`, type: CT.slide });
    if (slide.transition.kind === 'smart-move' || slide.transition.kind === 'flip') warnings.push(`Slide ${i + 1}: “${slide.transition.kind}” transition exported as fade`);
    for (const a of slide.animations) if (['blur', 'shake', 'color', 'rise'].includes(a.effect)) warnings.push(`Slide ${i + 1}: “${a.effect}” animation exported as the nearest standard preset`);
  });
  await Promise.all(rasterJobs);

  for (const c of charts) {
    zip.file(c.name, c.xml);
    overrides.push({ part: `/${c.name}`, type: CT.chart });
  }

  // Layouts & master
  const mrels = new Rels();
  layouts.forEach((id, i) => {
    const r = new Rels();
    r.add(REL.slideMaster, '../slideMasters/slideMaster1.xml');
    zip.file(`ppt/slideLayouts/slideLayout${i + 1}.xml`, layoutXml(layoutById(id).name, LAYOUT_TYPE[id]!));
    zip.file(`ppt/slideLayouts/_rels/slideLayout${i + 1}.xml.rels`, r.xml());
    overrides.push({ part: `/ppt/slideLayouts/slideLayout${i + 1}.xml`, type: CT.slideLayout });
    mrels.add(REL.slideLayout, `../slideLayouts/slideLayout${i + 1}.xml`);
  });
  mrels.add(REL.theme, '../theme/theme1.xml');
  zip.file('ppt/slideMasters/slideMaster1.xml', masterXml(layouts.length));
  zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', mrels.xml());
  overrides.push({ part: '/ppt/slideMasters/slideMaster1.xml', type: CT.slideMaster });
  zip.file('ppt/theme/theme1.xml', themeXml(pres));
  overrides.push({ part: '/ppt/theme/theme1.xml', type: CT.theme });

  if (hasNotes) {
    const r = new Rels();
    r.add(REL.theme, '../theme/theme2.xml');
    zip.file('ppt/notesMasters/notesMaster1.xml', notesMasterXml());
    zip.file('ppt/notesMasters/_rels/notesMaster1.xml.rels', r.xml());
    zip.file('ppt/theme/theme2.xml', themeXml(pres, 'Notes'));
    overrides.push({ part: '/ppt/notesMasters/notesMaster1.xml', type: CT.notesMaster }, { part: '/ppt/theme/theme2.xml', type: CT.theme });
  }

  // presentation.xml
  const prels = new Rels();
  prels.add(REL.slideMaster, 'slideMasters/slideMaster1.xml');
  const sldIds = pres.slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="${prels.add(REL.slide, `slides/slide${i + 1}.xml`)}"/>`).join('');
  const notesId = hasNotes ? `<p:notesMasterIdLst><p:notesMasterId r:id="${prels.add(REL.notesMaster, 'notesMasters/notesMaster1.xml')}"/></p:notesMasterIdLst>` : '';
  prels.add(REL.presProps, 'presProps.xml');
  prels.add(REL.viewProps, 'viewProps.xml');
  prels.add(REL.theme, 'theme/theme1.xml');
  prels.add(REL.tableStyles, 'tableStyles.xml');
  let sections = '';
  if (pres.slides.some((s) => s.section)) {
    const groups: { name: string; ids: number[] }[] = [];
    pres.slides.forEach((s, i) => {
      const name = s.section ?? groups[groups.length - 1]?.name ?? 'Default Section';
      if (!groups.length || (s.section && s.section !== groups[groups.length - 1]!.name) || (!s.section && i === 0)) groups.push({ name, ids: [] });
      groups[groups.length - 1]!.ids.push(256 + i);
    });
    const guid = (i: number) => `{${(0xdec0000 + i).toString(16).toUpperCase().padStart(8, '0')}-0000-4000-8000-${String(i).padStart(12, '0')}}`;
    sections = `<p:extLst><p:ext uri="${SECTION_EXT_URI}"><p14:sectionLst xmlns:p14="${NS.p14}">${groups.map((g, i) => `<p14:section name="${ea(g.name)}" id="${guid(i)}"><p14:sldIdLst>${g.ids.map((id) => `<p14:sldId id="${id}"/>`).join('')}</p14:sldIdLst></p14:section>`).join('')}</p14:sectionLst></p:ext></p:extLst>`;
  }
  zip.file(
    'ppt/presentation.xml',
    XML_DECL +
      `<p:presentation ${ROOT_NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>${notesId}<p:sldIdLst>${sldIds}</p:sldIdLst>` +
      `<p:sldSz cx="${e(pres.width)}" cy="${e(pres.height)}"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:defaultTextStyle>${sections}</p:presentation>`,
  );
  if (!sldIds) warnings.push('Presentation has no slides');
  zip.file('ppt/_rels/presentation.xml.rels', prels.xml());
  zip.file('ppt/presProps.xml', XML_DECL + `<p:presentationPr ${ROOT_NS}/>`);
  zip.file('ppt/viewProps.xml', XML_DECL + `<p:viewPr ${ROOT_NS}><p:normalViewPr/><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>`);
  zip.file('ppt/tableStyles.xml', XML_DECL + `<a:tblStyleLst xmlns:a="${NS.a}" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`);
  overrides.push(
    { part: '/ppt/presentation.xml', type: CT.presentation },
    { part: '/ppt/presProps.xml', type: CT.presProps },
    { part: '/ppt/viewProps.xml', type: CT.viewProps },
    { part: '/ppt/tableStyles.xml', type: CT.tableStyles },
    { part: '/docProps/core.xml', type: CT.core },
    { part: '/docProps/app.xml', type: CT.app },
  );

  // Media
  for (const [name, bytes] of media.parts) zip.file(name, bytes);

  // docProps
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  zip.file(
    'docProps/core.xml',
    XML_DECL +
      `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${t(pres.title)}</dc:title><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`,
  );
  zip.file(
    'docProps/app.xml',
    XML_DECL + `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>${t(opts.appName ?? 'DECK')}</Application><Slides>${pres.slides.length}</Slides><HiddenSlides>${pres.slides.filter((s) => s.hidden).length}</HiddenSlides></Properties>`,
  );
  const root = new Rels();
  root.add(REL.officeDocument, 'ppt/presentation.xml');
  root.add(REL.coreProps, 'docProps/core.xml');
  root.add(REL.extProps, 'docProps/app.xml');
  zip.file('_rels/.rels', root.xml());

  const defaults = [
    ['rels', CT.rels],
    ['xml', 'application/xml'],
    ...media.defaults.entries(),
  ];
  zip.file(
    '[Content_Types].xml',
    XML_DECL +
      `<Types xmlns="${NS.ct}">${defaults.map(([ext, type]) => `<Default Extension="${ext}" ContentType="${type}"/>`).join('')}${overrides.map((o) => `<Override PartName="${o.part}" ContentType="${o.type}"/>`).join('')}</Types>`,
  );

  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 }, mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
  return { bytes, warnings: [...new Set(warnings)] };
}
