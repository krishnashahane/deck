import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import {
  TEMPLATES, createAnimation, createChart, createImage, createLine, createPresentation, createShape, createSlide, createTable, createText,
  exportPptx, importPptx, inspectPptx, para, plainText, themeById,
  type Presentation, type SlideElement,
} from '../src';

const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR42mP8z8DwnwEJMDGgAcYCAB3LAfnD0FTtAAAAAElFTkSuQmCC'), (c) => c.charCodeAt(0));

function kitchenSink(): { pres: Presentation; assets: Record<string, Uint8Array> } {
  const theme = themeById('meridian');
  const pres = createPresentation({ title: 'Kitchen sink', theme });
  const title = createText(theme, { name: 'Title', placeholder: 'title', x: 100, y: 80, w: 1200, h: 160, paragraphs: [{ runs: [{ text: 'Hello ', bold: true }, { text: 'world', italic: true, color: '#FF0000', link: 'https://example.com/' }], align: 'center' }] });
  const bullets = createText(theme, { name: 'Body', x: 100, y: 300, w: 900, h: 400, paragraphs: [para('One', { bullet: 'bullet' }), para('Two', { bullet: 'number', level: 1 }), para('Ünïcødé — 漢字 — العربية', { bullet: 'none' })] });
  const shape = createShape(theme, 'roundRect', { x: 1200, y: 300, w: 400, h: 300, rotation: 15, paragraphs: [para('Shape text')], stroke: { color: '#112233', width: 3, dash: 'dash' }, shadow: { x: 4, y: 6, blur: 10, color: '#00000080' } });
  const grad = createShape(theme, 'ellipse', { x: 1500, y: 700, w: 200, h: 200, fill: { kind: 'linear', angle: 90, stops: [{ offset: 0, color: '#FF0000' }, { offset: 1, color: '#0000FF' }] } });
  const img = createImage('asset:img1', 320, 240, { x: 40, y: 760, alt: 'A tiny test image', crop: { left: 0.1, top: 0, right: 0.1, bottom: 0 }, mask: 'circle' });
  const line = createLine(theme, 500, 900, 900, 800, { endArrow: 'arrow', stroke: { color: '#334455', width: 5, dash: 'solid' } });
  const table = createTable(theme, 3, 2);
  table.rows[1]![0]!.text = 'cell A';
  const chart = createChart(theme, 'bar', { title: 'Revenue', categories: ['a', 'b', 'c'], series: [{ name: 'S1', values: [1, 2, 3] }, { name: 'S2', values: [3, 2, 1] }] });
  const pie = createChart(theme, 'pie', { categories: ['x', 'y'], series: [{ name: 'P', values: [30, 70] }] });
  const s1 = createSlide({ layout: 'title', elements: [title, bullets, shape, grad, img, line], notes: 'Speaker notes line 1\nLine 2', section: 'Intro', transition: { kind: 'push', duration: 800, direction: 'up', advanceAfter: 0 } });
  s1.animations = [
    createAnimation(title.id, { effect: 'fade', trigger: 'click', duration: 700 }),
    createAnimation(shape.id, { effect: 'fly', trigger: 'with', direction: 'left', delay: 200 }),
    createAnimation(grad.id, { class: 'emphasis', effect: 'spin', trigger: 'after', duration: 1000 }),
    createAnimation(bullets.id, { class: 'exit', effect: 'fade', trigger: 'click' }),
    createAnimation(img.id, { class: 'motion', effect: 'path', trigger: 'click', path: [{ x: 0, y: 0 }, { x: 192, y: 108 }] }),
  ];
  const s2 = createSlide({ layout: 'title-only', elements: [table, chart], hidden: true, section: 'Data', transition: { kind: 'fade', duration: 400, direction: 'left', advanceAfter: 3000 } });
  const s3 = createSlide({ elements: [pie], background: { kind: 'solid', color: '#101820' } });
  pres.slides = [s1, s2, s3];
  pres.assets = { img1: { id: 'img1', mime: 'image/png', name: 'tiny.png', size: PNG.length } };
  return { pres, assets: { img1: PNG } };
}

const byName = (els: SlideElement[], name: string) => els.find((e) => e.name === name);

describe('PPTX export', () => {
  it('produces a structurally valid package for every template', async () => {
    for (const t of TEMPLATES) {
      const pres = t.build();
      const { bytes } = await exportPptx(pres, { assets: {} });
      const report = await inspectPptx(bytes);
      expect(report.errors, `${t.id}: ${report.errors.join('; ')}`).toEqual([]);
      expect(report.slideCount).toBe(pres.slides.length);
    }
  });

  it('writes slide size, notes, hidden slides, timing and transitions', async () => {
    const { pres, assets } = kitchenSink();
    const { bytes, warnings } = await exportPptx(pres, { assets });
    const r = await inspectPptx(bytes);
    expect(r.errors).toEqual([]);
    expect(r.slideSize).toEqual({ cx: 1920 * 9525, cy: 1080 * 9525 });
    expect(r.slides[0]!.notes).toBe(true);
    expect(r.slides[0]!.hasTiming).toBe(true);
    expect(r.slides[0]!.transition).toBe('p:push');
    expect(r.slides[1]!.hidden).toBe(true);
    expect(r.slides[0]!.pictures).toBe(1);
    expect(r.slides[0]!.connectors).toBe(1);
    expect(r.slides[1]!.frames).toBe(2);
    expect(r.parts).toContain('ppt/charts/chart1.xml');
    expect(r.parts.some((p) => p.startsWith('ppt/media/'))).toBe(true);
    expect(warnings).toEqual([]);
  });
});

describe('PPTX round trip (export → import)', () => {
  it('preserves structure, text, geometry, media, notes, charts, tables, animations, transitions, sections', async () => {
    const { pres, assets } = kitchenSink();
    const { bytes } = await exportPptx(pres, { assets });
    const { presentation: back, assets: backAssets } = await importPptx(bytes, 'ks.pptx');
    expect(back.width).toBe(1920);
    expect(back.height).toBe(1080);
    expect(back.slides).toHaveLength(3);
    const [a, b, c] = back.slides as [typeof back.slides[0], typeof back.slides[0], typeof back.slides[0]];
    // text & runs
    const title = byName(a.elements, 'Title')!;
    expect(title.type).toBe('text');
    if (title.type === 'text') {
      expect(plainText(title.paragraphs)).toBe('Hello world');
      expect(title.paragraphs[0]!.runs[0]!.bold).toBe(true);
      expect(title.paragraphs[0]!.runs[1]!.italic).toBe(true);
      expect(title.paragraphs[0]!.runs[1]!.color?.toUpperCase()).toBe('#FF0000');
      expect(title.paragraphs[0]!.runs[1]!.link).toBe('https://example.com/');
      expect(title.paragraphs[0]!.align).toBe('center');
      expect(title.placeholder).toBe('title');
    }
    const body = byName(a.elements, 'Body')!;
    if (body.type === 'text') {
      expect(body.paragraphs.map((p) => p.bullet)).toEqual(['bullet', 'number', 'none']);
      expect(body.paragraphs[1]!.level).toBe(1);
      expect(plainText(body.paragraphs)).toContain('漢字');
    }
    // geometry within 1 unit (EMU rounding)
    const shape = a.elements.find((e) => e.type === 'shape' && e.shape === 'roundRect')!;
    expect(shape.x).toBeCloseTo(1200, 0);
    expect(shape.rotation).toBeCloseTo(15, 3);
    if (shape.type === 'shape') {
      expect(shape.stroke?.dash).toBe('dash');
      expect(shape.shadow).not.toBeNull();
    }
    const ell = a.elements.find((e) => e.type === 'shape' && e.shape === 'ellipse')!;
    if (ell.type === 'shape') expect(ell.fill.kind).toBe('linear');
    // image
    const img = a.elements.find((e) => e.type === 'image')!;
    if (img.type === 'image') {
      expect(img.alt).toBe('A tiny test image');
      expect(img.mask).toBe('circle');
      expect(img.crop.left).toBeCloseTo(0.1, 5);
      const id = img.src.slice(6);
      expect(Array.from(backAssets[id]!)).toEqual(Array.from(PNG));
    }
    // line
    const line = a.elements.find((e) => e.type === 'line')!;
    if (line.type === 'line') {
      expect([line.x1, line.y1, line.x2, line.y2].map(Math.round)).toEqual([500, 900, 900, 800]);
      expect(line.endArrow).toBe('arrow');
    }
    // notes, sections, transitions, hidden
    expect(a.notes).toBe('Speaker notes line 1\nLine 2');
    expect(a.section).toBe('Intro');
    expect(b.section).toBe('Data');
    expect(a.transition.kind).toBe('push');
    expect(a.transition.direction).toBe('up');
    expect(b.hidden).toBe(true);
    expect(b.transition.advanceAfter).toBe(3000);
    expect(c.background).toEqual({ kind: 'solid', color: '#101820' });
    // table & chart
    const table = b.elements.find((e) => e.type === 'table')!;
    if (table.type === 'table') expect(table.rows[1]![0]!.text).toBe('cell A');
    const chart = b.elements.find((e) => e.type === 'chart')!;
    if (chart.type === 'chart') {
      expect(chart.chart).toBe('bar');
      expect(chart.title).toBe('Revenue');
      expect(chart.categories).toEqual(['a', 'b', 'c']);
      expect(chart.series.map((s) => s.values)).toEqual([[1, 2, 3], [3, 2, 1]]);
    }
    const pie = c.elements[0]!;
    if (pie.type === 'chart') expect(pie.chart).toBe('pie');
    // animations
    expect(a.animations.map((x) => [x.class, x.effect, x.trigger])).toEqual([
      ['entrance', 'fade', 'click'],
      ['entrance', 'fly', 'with'],
      ['emphasis', 'spin', 'after'],
      ['exit', 'fade', 'click'],
      ['motion', 'path', 'click'],
    ]);
    expect(a.animations[0]!.duration).toBe(700);
    expect(a.animations[1]!.delay).toBe(200);
    expect(a.animations[1]!.direction).toBe('left');
    expect(a.animations[4]!.path?.[1]?.x).toBeCloseTo(192, 0);
    expect(back.importReport?.warnings.filter((w) => w.code !== 'flip')).toEqual([]);
  });

  it('re-export of an imported file is still valid (import → export → reopen)', async () => {
    const { pres, assets } = kitchenSink();
    const first = await exportPptx(pres, { assets });
    const imported = await importPptx(first.bytes);
    const second = await exportPptx(imported.presentation, { assets: imported.assets });
    const r = await inspectPptx(second.bytes);
    expect(r.errors).toEqual([]);
    const again = await importPptx(second.bytes);
    expect(again.presentation.slides.map((s) => s.elements.length)).toEqual(imported.presentation.slides.map((s) => s.elements.length));
    expect(r.slides.map((s) => s.text.join('|'))).toEqual((await inspectPptx(first.bytes)).slides.map((s) => s.text.join('|')));
  });
});

describe('PPTX import hardening', () => {
  it('reports macros and never imports them', async () => {
    const { pres } = kitchenSink();
    const { bytes } = await exportPptx(pres, { assets: { img1: new Uint8Array() } });
    const zip = await JSZip.loadAsync(bytes);
    zip.file('ppt/vbaProject.bin', new Uint8Array([1, 2, 3]));
    const evil = await zip.generateAsync({ type: 'uint8array' });
    const { presentation } = await importPptx(evil);
    expect(presentation.importReport!.warnings.some((w) => w.code === 'macros')).toBe(true);
  });

  it('rejects XML with DOCTYPE (XXE / entity expansion)', async () => {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><Types>&e;</Types>');
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    await expect(importPptx(bytes)).rejects.toThrow(/DOCTYPE/);
  });

  it('rejects path traversal entries', async () => {
    const zip = new JSZip();
    zip.file('../../evil.txt', 'x');
    zip.file('[Content_Types].xml', '<Types/>');
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    await expect(importPptx(bytes)).rejects.toThrow(/Unsafe entry path/);
  });

  it('rejects zip bombs by declared ratio', async () => {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<Types/>');
    zip.file('bomb.xml', new Uint8Array(20 * 1024 * 1024));
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    await expect(importPptx(bytes)).rejects.toThrow(/compression ratio/);
  });

  it('rejects non-zip content even with a .pptx name', async () => {
    await expect(importPptx(new TextEncoder().encode('<html>not a deck</html>'), 'x.pptx')).rejects.toThrow(/Not a ZIP/);
  });

  it('rejects a zip without a presentation part', async () => {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
    await expect(importPptx(await zip.generateAsync({ type: 'uint8array' }))).rejects.toThrow(/presentation part/);
  });
});
