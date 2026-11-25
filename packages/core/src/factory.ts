import type {
  Animation,
  ChartElement,
  EquationElement,
  ImageElement,
  LineElement,
  MediaElement,
  Paragraph,
  Presentation,
  ShapeElement,
  ShapeKind,
  Slide,
  TableElement,
  TextElement,
  TextStyle,
  Theme,
  Transition,
} from './model';
import { THEMES } from './themes';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Collision-resistant id using the platform CSPRNG. */
export function uid(prefix = ''): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % 36];
  return prefix ? `${prefix}_${out}` : out;
}

export function para(text: string, extra: Partial<Paragraph> = {}): Paragraph {
  return { runs: [{ text }], ...extra };
}

export function plainText(paragraphs: Paragraph[]): string {
  return paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join('\n');
}

export function textStyle(theme: Theme, overrides: Partial<TextStyle> = {}): TextStyle {
  return {
    font: theme.fonts.body,
    size: 24,
    color: theme.colors.text,
    align: 'left',
    valign: 'top',
    lineHeight: 1.25,
    letterSpacing: 0,
    autofit: 'none',
    padding: 12,
    effect: 'none',
    ...overrides,
  };
}

export function defaultTransition(): Transition {
  return { kind: 'none', duration: 600, direction: 'left', advanceAfter: 0 };
}

export function createText(theme: Theme, init: Partial<TextElement> = {}): TextElement {
  return {
    id: uid('el'),
    type: 'text',
    name: 'Text',
    x: 160,
    y: 160,
    w: 800,
    h: 120,
    rotation: 0,
    opacity: 1,
    paragraphs: [para('')],
    style: textStyle(theme),
    fill: { kind: 'none' },
    stroke: null,
    ...init,
  };
}

export function createShape(theme: Theme, shape: ShapeKind, init: Partial<ShapeElement> = {}): ShapeElement {
  return {
    id: uid('el'),
    type: 'shape',
    name: shapeName(shape),
    shape,
    x: 760,
    y: 340,
    w: 400,
    h: 400,
    rotation: 0,
    opacity: 1,
    fill: { kind: 'solid', color: theme.colors.accent },
    stroke: null,
    shadow: null,
    cornerRadius: shape === 'roundRect' ? 32 : 0,
    paragraphs: [para('')],
    style: textStyle(theme, { align: 'center', valign: 'middle', color: theme.colors.background }),
    ...init,
  };
}

export function createImage(src: string, w: number, h: number, init: Partial<ImageElement> = {}): ImageElement {
  return {
    id: uid('el'),
    type: 'image',
    name: 'Image',
    x: 160,
    y: 160,
    w,
    h,
    rotation: 0,
    opacity: 1,
    src,
    alt: '',
    crop: { left: 0, top: 0, right: 0, bottom: 0 },
    mask: 'none',
    stroke: null,
    shadow: null,
    ...init,
  };
}

export function createLine(theme: Theme, x1: number, y1: number, x2: number, y2: number, init: Partial<LineElement> = {}): LineElement {
  const el: LineElement = {
    id: uid('el'),
    type: 'line',
    name: 'Line',
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    rotation: 0,
    opacity: 1,
    x1,
    y1,
    x2,
    y2,
    stroke: { color: theme.colors.text, width: 4, dash: 'solid' },
    startArrow: 'none',
    endArrow: 'none',
    curve: 'straight',
    ...init,
  };
  return syncLineBox(el);
}

export function syncLineBox<T extends LineElement>(el: T): T {
  el.x = Math.min(el.x1, el.x2);
  el.y = Math.min(el.y1, el.y2);
  el.w = Math.abs(el.x2 - el.x1);
  el.h = Math.abs(el.y2 - el.y1);
  return el;
}

export function createTable(theme: Theme, rows = 4, cols = 3, init: Partial<TableElement> = {}): TableElement {
  return {
    id: uid('el'),
    type: 'table',
    name: 'Table',
    x: 260,
    y: 300,
    w: 1400,
    h: rows * 90,
    rotation: 0,
    opacity: 1,
    rows: Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (_, c) => ({ text: r === 0 ? `Column ${c + 1}` : '' })),
    ),
    colWidths: Array.from({ length: cols }, () => 1 / cols),
    headerRow: true,
    bandedRows: true,
    style: {
      font: theme.fonts.body,
      size: 20,
      color: theme.colors.text,
      border: theme.colors.muted,
      headerFill: theme.colors.accent,
      bandFill: theme.colors.surface,
    },
    ...init,
  };
}

export function createChart(theme: Theme, chart: ChartElement['chart'] = 'column', init: Partial<ChartElement> = {}): ChartElement {
  return {
    id: uid('el'),
    type: 'chart',
    name: 'Chart',
    x: 260,
    y: 240,
    w: 1400,
    h: 700,
    rotation: 0,
    opacity: 1,
    chart,
    categories: ['Q1', 'Q2', 'Q3', 'Q4'],
    series: [
      { name: 'Series A', values: [4, 6, 5, 8] },
      { name: 'Series B', values: [3, 4, 6, 7] },
    ],
    title: '',
    legend: true,
    dataLabels: false,
    style: { font: theme.fonts.body, color: theme.colors.text, grid: theme.colors.muted },
    ...init,
  };
}

export function createMedia(kind: 'video' | 'audio', src: string, init: Partial<MediaElement> = {}): MediaElement {
  return {
    id: uid('el'),
    type: 'media',
    name: kind === 'video' ? 'Video' : 'Audio',
    kind,
    x: 360,
    y: 190,
    w: kind === 'video' ? 1200 : 480,
    h: kind === 'video' ? 675 : 96,
    rotation: 0,
    opacity: 1,
    src,
    autoplay: false,
    loop: false,
    muted: false,
    ...init,
  };
}

export function createEquation(theme: Theme, latex = 'e^{i\\pi} + 1 = 0', init: Partial<EquationElement> = {}): EquationElement {
  return {
    id: uid('el'),
    type: 'equation',
    name: 'Equation',
    x: 560,
    y: 440,
    w: 800,
    h: 200,
    rotation: 0,
    opacity: 1,
    latex,
    color: theme.colors.text,
    size: 44,
    ...init,
  };
}

export function createAnimation(elementId: string, init: Partial<Animation> = {}): Animation {
  return {
    id: uid('an'),
    elementId,
    class: 'entrance',
    effect: 'fade',
    trigger: 'click',
    delay: 0,
    duration: 500,
    direction: 'up',
    easing: 'ease-out',
    ...init,
  };
}

export function createSlide(init: Partial<Slide> = {}): Slide {
  return {
    id: uid('sl'),
    layout: 'blank',
    background: null,
    elements: [],
    notes: '',
    hidden: false,
    transition: defaultTransition(),
    animations: [],
    ...init,
  };
}

export function createPresentation(init: Partial<Presentation> = {}): Presentation {
  return {
    id: uid('dk'),
    title: 'Untitled presentation',
    width: 1920,
    height: 1080,
    theme: structuredClone(THEMES[0]!),
    slides: [],
    assets: {},
    ...init,
  };
}

function shapeName(s: ShapeKind): string {
  const map: Record<ShapeKind, string> = {
    rect: 'Rectangle',
    roundRect: 'Rounded rectangle',
    ellipse: 'Ellipse',
    triangle: 'Triangle',
    diamond: 'Diamond',
    pentagon: 'Pentagon',
    hexagon: 'Hexagon',
    star: 'Star',
    arrowRight: 'Arrow',
    chevron: 'Chevron',
    speech: 'Callout',
    cloud: 'Cloud',
    heart: 'Heart',
    plus: 'Plus',
  };
  return map[s];
}

/** Deep-clone a slide with fresh ids, remapping internal references (animations, connectors, groups). */
export function cloneSlide(slide: Slide): Slide {
  const copy = structuredClone(slide);
  copy.id = uid('sl');
  const idMap = new Map<string, string>();
  const groupMap = new Map<string, string>();
  for (const el of copy.elements) {
    const nid = uid('el');
    idMap.set(el.id, nid);
    el.id = nid;
    if (el.groupId) {
      if (!groupMap.has(el.groupId)) groupMap.set(el.groupId, uid('gr'));
      el.groupId = groupMap.get(el.groupId);
    }
  }
  for (const el of copy.elements) {
    if (el.type === 'line') {
      if (el.from) el.from = idMap.get(el.from);
      if (el.to) el.to = idMap.get(el.to);
    }
  }
  copy.animations = copy.animations
    .filter((a) => idMap.has(a.elementId))
    .map((a) => ({
      ...a,
      id: uid('an'),
      elementId: idMap.get(a.elementId)!,
      triggerElementId: a.triggerElementId ? idMap.get(a.triggerElementId) : undefined,
    }));
  return copy;
}
