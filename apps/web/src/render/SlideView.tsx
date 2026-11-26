import { memo, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

/* KaTeX (~270 kB with fonts/CSS) is loaded only when a slide contains an equation. */
type Katex = typeof import('katex').default;
let katexMod: Katex | null = null;
let katexLoad: Promise<Katex> | null = null;
function loadKatex(): Promise<Katex> {
  katexLoad ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([m]) => (katexMod = m.default));
  return katexLoad;
}
function useKatex(): Katex | null {
  const [k, setK] = useState<Katex | null>(katexMod);
  useEffect(() => {
    if (!k) void loadKatex().then(setK);
  }, [k]);
  return k;
}

function EquationBody({ el }: { el: Extract<SlideElement, { type: 'equation' }> }) {
  const katex = useKatex();
  let html = '';
  if (katex) {
    try {
      html = katex.renderToString(el.latex, { throwOnError: false, displayMode: true, trust: false, strict: 'ignore', maxSize: 50, maxExpand: 500 });
    } catch {
      html = '';
    }
  }
  return (
    <foreignObject x={el.x} y={el.y} width={el.w} height={el.h}>
      {katex ? (
        <div style={{ width: el.w, height: el.h, display: 'grid', placeItems: 'center', color: el.color, fontSize: el.size * (96 / 72), overflow: 'hidden' }} dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <div style={{ width: el.w, height: el.h, display: 'grid', placeItems: 'center', color: el.color, fontSize: el.size * (96 / 72) * 0.6, fontFamily: 'monospace', opacity: 0.6 }}>{el.latex}</div>
      )}
    </foreignObject>
  );
}
import { UNITS_PER_POINT, type DeckDoc, type Fill, type Paragraph, type Presentation, type Slide, type SlideElement, type TextStyle } from '@deck/core';
import { assetUrl } from '../lib/assets';
import { shapePath } from './shapes';
import { ChartView } from './Chart';

export interface SlideViewProps {
  slide: Slide;
  pres: Presentation;
  deck: DeckDoc;
  /** Rendered pixel width; height follows the slide aspect ratio. */
  width: number;
  /** Elements to hide (editing overlay, animation state). */
  hidden?: Set<string>;
  /** Live mode enables media controls and link cursors. */
  live?: boolean;
  onElementClick?: (el: SlideElement) => void;
  className?: string;
  style?: CSSProperties;
  /** Thumbnails skip expensive autofit measurement. */
  lite?: boolean;
}

const pt = (v: number) => v * UNITS_PER_POINT;

export function fillPaint(f: Fill | null | undefined, gid: string, deck: DeckDoc): { paint: string; defs: ReactNode } {
  if (!f || f.kind === 'none') return { paint: 'none', defs: null };
  if (f.kind === 'solid') return { paint: f.color, defs: null };
  if (f.kind === 'linear') {
    const a = ((f.angle - 90) * Math.PI) / 180;
    const x = Math.cos(a) / 2, y = Math.sin(a) / 2;
    return {
      paint: `url(#${gid})`,
      defs: (
        <linearGradient id={gid} x1={0.5 - x} y1={0.5 - y} x2={0.5 + x} y2={0.5 + y}>
          {f.stops.map((s, i) => <stop key={i} offset={s.offset} stopColor={s.color} />)}
        </linearGradient>
      ),
    };
  }
  if (f.kind === 'radial') {
    return {
      paint: `url(#${gid})`,
      defs: (
        <radialGradient id={gid}>
          {f.stops.map((s, i) => <stop key={i} offset={s.offset} stopColor={s.color} />)}
        </radialGradient>
      ),
    };
  }
  const url = assetUrl(deck, f.src);
  return {
    paint: url ? `url(#${gid})` : 'none',
    defs: url ? (
      <pattern id={gid} patternUnits="objectBoundingBox" width="1" height="1">
        <image href={url} width="1" height="1" preserveAspectRatio={f.fit === 'contain' ? 'xMidYMid meet' : f.fit === 'stretch' ? 'none' : 'xMidYMid slice'} />
      </pattern>
    ) : null,
  };
}

function cssFill(f: Fill | null, deck: DeckDoc, fallback: string): string {
  if (!f) return fallback;
  switch (f.kind) {
    case 'solid': return f.color;
    case 'linear': return `linear-gradient(${f.angle}deg, ${f.stops.map((s) => `${s.color} ${s.offset * 100}%`).join(', ')})`;
    case 'radial': return `radial-gradient(circle, ${f.stops.map((s) => `${s.color} ${s.offset * 100}%`).join(', ')})`;
    case 'image': {
      const u = assetUrl(deck, f.src);
      return u ? `center / ${f.fit === 'stretch' ? '100% 100%' : f.fit} no-repeat url("${u}")` : fallback;
    }
    case 'none': return 'transparent';
  }
}

export function textEffect(style: TextStyle): CSSProperties {
  switch (style.effect) {
    case 'shadow': return { textShadow: '0 0.06em 0.18em rgba(0,0,0,0.45)' };
    case 'outline': return { WebkitTextStroke: `0.03em ${style.color}`, color: 'transparent' };
    case 'glow': return { textShadow: `0 0 0.25em ${style.color}, 0 0 0.6em ${style.color}` };
    default: return {};
  }
}

/** Paragraphs → HTML. Shared by renderer and text editor so editing is WYSIWYG. */
export function ParagraphsHtml({ paragraphs, style }: { paragraphs: Paragraph[]; style: TextStyle }) {
  const counters: number[] = [];
  return (
    <>
      {paragraphs.map((p, i) => {
        const level = p.level ?? 0;
        if (p.bullet === 'number') {
          counters.length = level + 1;
          counters[level] = (counters[level] ?? 0) + 1;
        } else counters.length = 0;
        const size = pt(p.runs[0]?.size ?? style.size);
        const indent = p.bullet && p.bullet !== 'none' ? size * 1.1 : 0;
        const marker = p.bullet === 'bullet' ? '•' : p.bullet === 'number' ? `${counters[level]}.` : null;
        const empty = p.runs.every((r) => !r.text);
        return (
          <p
            key={i}
            data-p={i}
            style={{
              margin: 0,
              marginTop: pt(p.spaceBefore ?? 0),
              marginBottom: pt(p.spaceAfter ?? 0),
              textAlign: p.align ?? style.align,
              lineHeight: p.lineHeight ?? style.lineHeight,
              paddingLeft: indent * (level + 1),
              textIndent: marker ? -indent : 0,
            }}
          >
            {marker && <span contentEditable={false} style={{ display: 'inline-block', width: indent, textIndent: 0, color: p.runs[0]?.color ?? style.color, userSelect: 'none' }}>{marker}</span>}
            {empty ? <br /> : p.runs.map((r, j) => {
              const s: CSSProperties = {};
              if (r.bold !== undefined) s.fontWeight = r.bold ? 700 : 400;
              if (r.italic !== undefined) s.fontStyle = r.italic ? 'italic' : 'normal';
              const deco = [r.underline && 'underline', r.strike && 'line-through'].filter(Boolean).join(' ');
              if (deco) s.textDecoration = deco;
              if (r.color) s.color = r.color;
              if (r.size) s.fontSize = pt(r.size);
              if (r.font) s.fontFamily = `"${r.font}"`;
              if (r.highlight) s.backgroundColor = r.highlight;
              return (
                <span key={j} style={s} data-link={r.link || undefined}>
                  {r.text}
                </span>
              );
            })}
          </p>
        );
      })}
    </>
  );
}

function TextBlock({ el, lite, fillCss }: { el: Extract<SlideElement, { type: 'text' | 'shape' }>; lite?: boolean; fillCss?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const st = el.style;
  useLayoutEffect(() => {
    if (lite || st.autofit !== 'shrink' || !ref.current) {
      if (scale !== 1) setScale(1);
      return;
    }
    const box = ref.current;
    let s = 1;
    box.style.fontSize = `${pt(st.size)}px`;
    for (let i = 0; i < 8 && box.scrollHeight > box.clientHeight + 1; i++) {
      s *= 0.9;
      box.style.zoom = String(s);
    }
    box.style.zoom = '';
    if (Math.abs(s - scale) > 0.001) setScale(s);
  });
  const justify = st.valign === 'middle' ? 'center' : st.valign === 'bottom' ? 'flex-end' : 'flex-start';
  return (
    <div
      ref={ref}
      style={{
        width: el.w,
        height: el.h,
        padding: st.padding,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: justify,
        fontFamily: `"${st.font}", system-ui, sans-serif`,
        fontSize: pt(st.size),
        fontWeight: st.bold ? 700 : 400,
        fontStyle: st.italic ? 'italic' : 'normal',
        color: st.color,
        letterSpacing: `${st.letterSpacing}em`,
        lineHeight: st.lineHeight,
        overflow: 'hidden',
        overflowWrap: 'break-word',
        whiteSpace: 'pre-wrap',
        background: fillCss,
        zoom: scale !== 1 ? scale : undefined,
        boxSizing: 'border-box',
        ...textEffect(st),
      }}
    >
      <div>
        <ParagraphsHtml paragraphs={el.paragraphs} style={st} />
      </div>
    </div>
  );
}

function Markers({ id, color }: { id: string; color: string }) {
  return (
    <defs>
      <marker id={`${id}-arrow`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
        <path d="M0,0L10,5L0,10Z" fill={color} />
      </marker>
      <marker id={`${id}-dot`} viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4">
        <circle cx="5" cy="5" r="5" fill={color} />
      </marker>
    </defs>
  );
}

export function linePath(el: Extract<SlideElement, { type: 'line' }>): string {
  const { x1, y1, x2, y2 } = el;
  if (el.curve === 'elbow') {
    const mx = (x1 + x2) / 2;
    return `M${x1},${y1}H${mx}V${y2}H${x2}`;
  }
  if (el.curve === 'curved') {
    const mx = (x1 + x2) / 2;
    return `M${x1},${y1}C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
  }
  return `M${x1},${y1}L${x2},${y2}`;
}

const dashArray = (d: string, w: number) => (d === 'dash' ? `${w * 3} ${w * 2}` : d === 'dot' ? `${w} ${w * 1.6}` : undefined);

/** Resolve connector endpoints that follow attached elements. */
export function resolveConnector(el: Extract<SlideElement, { type: 'line' }>, byId: Map<string, SlideElement>) {
  const anchor = (id: string | undefined, toward: { x: number; y: number }) => {
    const t = id ? byId.get(id) : undefined;
    if (!t) return null;
    const cx = t.x + t.w / 2, cy = t.y + t.h / 2;
    const dx = toward.x - cx, dy = toward.y - cy;
    if (Math.abs(dx) * t.h > Math.abs(dy) * t.w) return { x: dx > 0 ? t.x + t.w : t.x, y: cy };
    return { x: cx, y: dy > 0 ? t.y + t.h : t.y };
  };
  const toEl = el.to ? byId.get(el.to) : undefined;
  const fromEl = el.from ? byId.get(el.from) : undefined;
  const a = anchor(el.from, toEl ? { x: toEl.x + toEl.w / 2, y: toEl.y + toEl.h / 2 } : { x: el.x2, y: el.y2 });
  const b = anchor(el.to, fromEl ? { x: fromEl.x + fromEl.w / 2, y: fromEl.y + fromEl.h / 2 } : { x: el.x1, y: el.y1 });
  if (!a && !b) return el;
  return { ...el, x1: a?.x ?? el.x1, y1: a?.y ?? el.y1, x2: b?.x ?? el.x2, y2: b?.y ?? el.y2 };
}

export function ElementView({ el, deck, uid, live, lite, byId }: { el: SlideElement; deck: DeckDoc; uid: string; live?: boolean; lite?: boolean; byId: Map<string, SlideElement> }) {
  const gid = `${uid}-${el.id}`;
  const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
  const tf = el.rotation ? `rotate(${el.rotation} ${cx} ${cy})` : undefined;
  let body: ReactNode = null;
  switch (el.type) {
    case 'text': {
      const bg = el.fill.kind !== 'none' ? cssFill(el.fill, deck, 'transparent') : undefined;
      body = (
        <>
          <foreignObject x={el.x} y={el.y} width={Math.max(1, el.w)} height={Math.max(1, el.h)} style={{ overflow: 'visible' }}>
            <TextBlock el={el} lite={lite} fillCss={bg} />
          </foreignObject>
          {el.stroke && <rect x={el.x} y={el.y} width={el.w} height={el.h} fill="none" stroke={el.stroke.color} strokeWidth={el.stroke.width} strokeDasharray={dashArray(el.stroke.dash, el.stroke.width)} />}
        </>
      );
      break;
    }
    case 'shape': {
      const { paint, defs } = fillPaint(el.fill, `${gid}-f`, deck);
      const d = shapePath(el.shape, el.w, el.h, el.cornerRadius);
      const hasText = el.paragraphs.some((p) => p.runs.some((r) => r.text));
      body = (
        <>
          <defs>
            {defs}
            {el.shadow && (
              <filter id={`${gid}-sh`} x="-50%" y="-50%" width="200%" height="200%">
                <feDropShadow dx={el.shadow.x} dy={el.shadow.y} stdDeviation={el.shadow.blur / 2} floodColor={el.shadow.color.slice(0, 7)} floodOpacity={el.shadow.color.length === 9 ? parseInt(el.shadow.color.slice(7), 16) / 255 : 0.5} />
              </filter>
            )}
          </defs>
          <path transform={`translate(${el.x} ${el.y})`} d={d} fill={paint} stroke={el.stroke?.color ?? 'none'} strokeWidth={el.stroke?.width ?? 0} strokeDasharray={el.stroke ? dashArray(el.stroke.dash, el.stroke.width) : undefined} filter={el.shadow ? `url(#${gid}-sh)` : undefined} />
          {hasText && (
            <foreignObject x={el.x} y={el.y} width={Math.max(1, el.w)} height={Math.max(1, el.h)}>
              <TextBlock el={el} lite={lite} />
            </foreignObject>
          )}
        </>
      );
      break;
    }
    case 'image': {
      const url = assetUrl(deck, el.src);
      const { left, top, right, bottom } = el.crop;
      const iw = el.w / Math.max(0.01, 1 - left - right);
      const ih = el.h / Math.max(0.01, 1 - top - bottom);
      const clip = el.mask === 'circle' ? <ellipse cx={cx} cy={cy} rx={el.w / 2} ry={el.h / 2} /> : el.mask === 'rounded' ? <rect x={el.x} y={el.y} width={el.w} height={el.h} rx={Math.min(el.w, el.h) * 0.08} /> : <rect x={el.x} y={el.y} width={el.w} height={el.h} />;
      body = (
        <>
          <defs>
            <clipPath id={`${gid}-c`}>{clip}</clipPath>
          </defs>
          {url ? (
            <image href={url} x={el.x - left * iw} y={el.y - top * ih} width={iw} height={ih} preserveAspectRatio="none" clipPath={`url(#${gid}-c)`}>
              {el.alt && <title>{el.alt}</title>}
            </image>
          ) : (
            <rect x={el.x} y={el.y} width={el.w} height={el.h} fill="#8884" />
          )}
          {el.stroke && <g clipPath={`url(#${gid}-c)`}>{el.mask === 'circle' ? <ellipse cx={cx} cy={cy} rx={el.w / 2} ry={el.h / 2} fill="none" stroke={el.stroke.color} strokeWidth={el.stroke.width * 2} /> : <rect x={el.x} y={el.y} width={el.w} height={el.h} rx={el.mask === 'rounded' ? Math.min(el.w, el.h) * 0.08 : 0} fill="none" stroke={el.stroke.color} strokeWidth={el.stroke.width * 2} />}</g>}
        </>
      );
      break;
    }
    case 'line': {
      const l = resolveConnector(el, byId);
      body = (
        <>
          <Markers id={gid} color={l.stroke.color} />
          <path d={linePath(l)} fill="none" stroke={l.stroke.color} strokeWidth={l.stroke.width} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dashArray(l.stroke.dash, l.stroke.width)} markerStart={l.startArrow !== 'none' ? `url(#${gid}-${l.startArrow})` : undefined} markerEnd={l.endArrow !== 'none' ? `url(#${gid}-${l.endArrow})` : undefined} />
          <path d={linePath(l)} fill="none" stroke="transparent" strokeWidth={Math.max(16, l.stroke.width + 12)} data-hit="1" />
        </>
      );
      break;
    }
    case 'table': {
      const st = el.style;
      body = (
        <foreignObject x={el.x} y={el.y} width={el.w} height={el.h}>
          <table style={{ width: el.w, height: el.h, borderCollapse: 'collapse', tableLayout: 'fixed', fontFamily: `"${st.font}", system-ui`, fontSize: pt(st.size), color: st.color }}>
            <colgroup>{el.colWidths.map((w, i) => <col key={i} style={{ width: `${w * 100}%` }} />)}</colgroup>
            <tbody>
              {el.rows.map((row, ri) => {
                const header = el.headerRow && ri === 0;
                const band = el.bandedRows && !header && ri % 2 === 0;
                return (
                  <tr key={ri}>
                    {row.map((c, ci) => (
                      <td key={ci} data-cell={`${ri}:${ci}`} style={{ border: `1px solid ${st.border}`, padding: '0 0.5em', background: c.fill ?? (header ? st.headerFill : band ? st.bandFill : 'transparent'), fontWeight: c.bold ?? header ? 700 : 400, textAlign: c.align ?? 'left', color: c.color ?? (header ? contrastInk(st.headerFill) : st.color), whiteSpace: 'pre-wrap', overflow: 'hidden', verticalAlign: 'middle' }}>
                        {c.text}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </foreignObject>
      );
      break;
    }
    case 'chart':
      body = <ChartView el={el} palette={[deckPalette(deck)].flat()} />;
      break;
    case 'media': {
      const url = assetUrl(deck, el.src);
      const poster = assetUrl(deck, el.poster);
      body = live && url ? (
        <foreignObject x={el.x} y={el.y} width={el.w} height={el.h}>
          {el.kind === 'video' ? (
            <video src={url} poster={poster} controls autoPlay={el.autoplay} loop={el.loop} muted={el.muted} playsInline style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }} />
          ) : (
            <audio src={url} controls autoPlay={el.autoplay} loop={el.loop} style={{ width: '100%', height: '100%' }} />
          )}
        </foreignObject>
      ) : (
        <g>
          <rect x={el.x} y={el.y} width={el.w} height={el.h} rx={el.kind === 'audio' ? el.h / 2 : 8} fill="#000" opacity={0.85} />
          {poster && <image href={poster} x={el.x} y={el.y} width={el.w} height={el.h} preserveAspectRatio="xMidYMid meet" />}
          <circle cx={cx} cy={cy} r={Math.min(el.w, el.h) * 0.18} fill="#fff" opacity={0.92} />
          <path d={`M${cx - Math.min(el.w, el.h) * 0.06},${cy - Math.min(el.w, el.h) * 0.09}L${cx + Math.min(el.w, el.h) * 0.1},${cy}L${cx - Math.min(el.w, el.h) * 0.06},${cy + Math.min(el.w, el.h) * 0.09}Z`} fill="#111" />
        </g>
      );
      break;
    }
    case 'equation':
      body = <EquationBody el={el} />;
      break;
    case 'raw':
      body = (
        <g>
          <rect x={el.x} y={el.y} width={el.w} height={el.h} fill="rgba(127,127,127,0.08)" stroke="rgba(127,127,127,0.6)" strokeDasharray="12 8" strokeWidth={2} />
          <foreignObject x={el.x} y={el.y} width={el.w} height={el.h}>
            <div style={{ width: el.w, height: el.h, display: 'grid', placeItems: 'center', font: '600 22px system-ui', color: 'rgba(127,127,127,0.9)', textAlign: 'center', padding: 12 }}>Preserved: {el.reason}</div>
          </foreignObject>
        </g>
      );
      break;
  }
  return (
    <g data-el={el.id} transform={tf} opacity={el.opacity} style={{ transformBox: 'fill-box', transformOrigin: 'center', cursor: live && el.link ? 'pointer' : undefined }}>
      {body}
    </g>
  );
}

function contrastInk(bg: string): string {
  const m = /^#?([0-9a-f]{6})/i.exec(bg);
  if (!m) return '#fff';
  const n = parseInt(m[1]!, 16);
  const l = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return l > 0.6 ? '#111' : '#fff';
}

function deckPalette(deck: DeckDoc): string[] {
  const c = deck.presentation.theme.colors;
  return [c.accent, c.accent2, c.accent3, c.accent4, c.muted, c.text];
}

function SlideViewInner({ slide, pres, deck, width, hidden, live, onElementClick, className, style, lite }: SlideViewProps) {
  const uid = useId().replace(/:/g, '');
  const height = (width * pres.height) / pres.width;
  const { paint, defs } = fillPaint(slide.background ?? { kind: 'solid', color: pres.theme.colors.background }, `${uid}-bg`, deck);
  const byId = new Map(slide.elements.map((e) => [e.id, e]));
  return (
    <svg
      className={className}
      style={{ display: 'block', ...style }}
      width={width}
      height={height}
      viewBox={`0 0 ${pres.width} ${pres.height}`}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={`Slide: ${slideTitle(slide)}`}
      onClick={(e) => {
        if (!onElementClick) return;
        const g = (e.target as Element).closest('[data-el]');
        const el = g && byId.get(g.getAttribute('data-el')!);
        if (el) onElementClick(el);
      }}
    >
      <defs>{defs}</defs>
      <rect width={pres.width} height={pres.height} fill={paint} />
      {slide.elements.map((el) => (el.hidden || hidden?.has(el.id) ? <g key={el.id} data-el={el.id} style={{ visibility: 'hidden' }} /> : <ElementView key={el.id} el={el} deck={deck} uid={uid} live={live} lite={lite} byId={byId} />))}
    </svg>
  );
}

export const SlideView = memo(SlideViewInner);

export function slideTitle(s: Slide): string {
  const t = s.elements.find((e) => e.placeholder === 'title') ?? s.elements.find((e) => e.type === 'text');
  if (t && (t.type === 'text' || t.type === 'shape')) {
    const s2 = t.paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join(' ').trim();
    if (s2) return s2.slice(0, 80);
  }
  return 'Untitled slide';
}
