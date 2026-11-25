import { createShape, createText, para } from './factory';
import type { LayoutId, Presentation, Slide, SlideElement, Theme } from './model';

/**
 * Layout masters. A layout is a function of (theme, slide size) that produces
 * placeholder elements. Placeholders carry a `placeholder` role so they can be
 * re-flowed when the layout, theme or slide size changes.
 */
export interface LayoutDef {
  id: LayoutId;
  name: string;
  build: (theme: Theme, w: number, h: number) => SlideElement[];
}

const M = 0.0833; // outer margin as fraction of width

function title(theme: Theme, w: number, h: number, text: string, y: number, size: number, extra = {}) {
  return createText(theme, {
    name: 'Title',
    placeholder: 'title',
    x: w * M,
    y,
    w: w * (1 - 2 * M),
    h: size * 2.2,
    paragraphs: [para(text)],
    style: {
      ...createText(theme).style,
      font: theme.fonts.heading,
      size,
      bold: true,
      lineHeight: 1.05,
      letterSpacing: -0.02,
      valign: 'bottom',
      padding: 0,
    },
    ...extra,
  });
}

function body(theme: Theme, x: number, y: number, w: number, h: number, lines: string[], size = 28) {
  return createText(theme, {
    name: 'Body',
    placeholder: 'body',
    x,
    y,
    w,
    h,
    paragraphs: lines.map((l) => para(l, { bullet: 'bullet', spaceAfter: 10 })),
    style: { ...createText(theme).style, size, color: theme.colors.text, lineHeight: 1.35, padding: 0 },
  });
}

export const LAYOUTS: LayoutDef[] = [
  {
    id: 'title',
    name: 'Title',
    build: (t, w, h) => [
      title(t, w, h, 'Presentation title', h * 0.34, 88),
      createText(t, {
        name: 'Subtitle',
        placeholder: 'subtitle',
        x: w * M,
        y: h * 0.34 + 88 * 2.2 + 24,
        w: w * 0.6,
        h: 90,
        paragraphs: [para('Subtitle · presenter · date')],
        style: { ...createText(t).style, size: 32, color: t.colors.muted, padding: 0 },
      }),
    ],
  },
  {
    id: 'title-content',
    name: 'Title & content',
    build: (t, w, h) => [
      title(t, w, h, 'Slide title', h * 0.07, 56),
      body(t, w * M, h * 0.07 + 56 * 2.2 + 40, w * (1 - 2 * M), h * 0.6, ['First point', 'Second point', 'Third point']),
    ],
  },
  {
    id: 'section',
    name: 'Section header',
    build: (t, w, h) => [
      createShape(t, 'rect', { name: 'Accent bar', x: w * M, y: h * 0.42, w: 120, h: 10, fill: { kind: 'solid', color: t.colors.accent } }),
      title(t, w, h, 'Section', h * 0.46, 72, { style: { ...createText(t).style, font: t.fonts.heading, size: 72, bold: true, valign: 'top', padding: 0, lineHeight: 1.05, letterSpacing: -0.02 } }),
    ],
  },
  {
    id: 'two-column',
    name: 'Two columns',
    build: (t, w, h) => {
      const top = h * 0.07 + 56 * 2.2 + 40;
      const colW = (w * (1 - 2 * M) - 80) / 2;
      return [
        title(t, w, h, 'Comparison', h * 0.07, 56),
        body(t, w * M, top, colW, h * 0.58, ['Left point', 'Another point']),
        body(t, w * M + colW + 80, top, colW, h * 0.58, ['Right point', 'Another point']),
      ];
    },
  },
  {
    id: 'title-only',
    name: 'Title only',
    build: (t, w, h) => [title(t, w, h, 'Slide title', h * 0.07, 56)],
  },
  {
    id: 'big-number',
    name: 'Big number',
    build: (t, w, h) => [
      createText(t, {
        name: 'Number',
        placeholder: 'title',
        x: w * M,
        y: h * 0.2,
        w: w * (1 - 2 * M),
        h: h * 0.4,
        paragraphs: [para('00%')],
        style: { ...createText(t).style, font: t.fonts.heading, size: 260, bold: true, color: t.colors.accent, lineHeight: 1, letterSpacing: -0.04, valign: 'bottom', padding: 0 },
      }),
      createText(t, {
        name: 'Caption',
        placeholder: 'body',
        x: w * M,
        y: h * 0.64,
        w: w * 0.6,
        h: 120,
        paragraphs: [para('Describe what the number means.')],
        style: { ...createText(t).style, size: 32, color: t.colors.muted, padding: 0 },
      }),
    ],
  },
  {
    id: 'quote',
    name: 'Quote',
    build: (t, w, h) => [
      createText(t, {
        name: 'Quote',
        placeholder: 'title',
        x: w * 0.14,
        y: h * 0.24,
        w: w * 0.72,
        h: h * 0.4,
        paragraphs: [para('“A short, memorable quotation goes here.”')],
        style: { ...createText(t).style, font: t.fonts.heading, size: 64, italic: true, align: 'center', valign: 'middle', lineHeight: 1.15, padding: 0 },
      }),
      createText(t, {
        name: 'Attribution',
        placeholder: 'subtitle',
        x: w * 0.14,
        y: h * 0.68,
        w: w * 0.72,
        h: 70,
        paragraphs: [para('— Attribution')],
        style: { ...createText(t).style, size: 28, color: t.colors.muted, align: 'center', padding: 0 },
      }),
    ],
  },
  {
    id: 'image-left',
    name: 'Image & text',
    build: (t, w, h) => [
      createShape(t, 'rect', { name: 'Image placeholder', x: 0, y: 0, w: w * 0.46, h, fill: { kind: 'solid', color: t.colors.surface } }),
      createText(t, {
        name: 'Title',
        placeholder: 'title',
        x: w * 0.52,
        y: h * 0.18,
        w: w * 0.4,
        h: 260,
        paragraphs: [para('Headline')],
        style: { ...createText(t).style, font: t.fonts.heading, size: 64, bold: true, valign: 'bottom', lineHeight: 1.05, letterSpacing: -0.02, padding: 0 },
      }),
      body(t, w * 0.52, h * 0.18 + 300, w * 0.4, h * 0.45, ['Supporting detail', 'Another detail'], 26),
    ],
  },
  { id: 'blank', name: 'Blank', build: () => [] },
];

export function layoutById(id: LayoutId): LayoutDef {
  return LAYOUTS.find((l) => l.id === id) ?? LAYOUTS[LAYOUTS.length - 1]!;
}

/**
 * Apply a layout to an existing slide: placeholders are re-created from the
 * layout and the text of matching existing placeholders is carried over.
 * Non-placeholder content is kept untouched.
 */
export function applyLayout(slide: Slide, layoutId: LayoutId, pres: Pick<Presentation, 'theme' | 'width' | 'height'>): Slide {
  const fresh = layoutById(layoutId).build(pres.theme, pres.width, pres.height);
  const oldPh = slide.elements.filter((e) => e.placeholder);
  const byRole = new Map<string, SlideElement[]>();
  for (const e of oldPh) {
    const list = byRole.get(e.placeholder!) ?? [];
    list.push(e);
    byRole.set(e.placeholder!, list);
  }
  for (const e of fresh) {
    if (!e.placeholder || (e.type !== 'text' && e.type !== 'shape')) continue;
    const prev = byRole.get(e.placeholder)?.shift();
    if (prev && (prev.type === 'text' || prev.type === 'shape')) e.paragraphs = structuredClone(prev.paragraphs);
  }
  const keptIds = new Set(slide.elements.filter((e) => e.placeholder).map((e) => e.id));
  const others = slide.elements.filter((e) => !keptIds.has(e.id));
  const removed = new Set(keptIds);
  return {
    ...slide,
    layout: layoutId,
    elements: [...fresh, ...others],
    animations: slide.animations.filter((a) => !removed.has(a.elementId)),
  };
}
