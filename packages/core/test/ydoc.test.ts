import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { DeckDoc, cloneSlide, createPresentation, createSlide, createText, docFromPresentation, themeById } from '../src';

function base() {
  const theme = themeById('graphite');
  const t = createText(theme, { name: 'T', paragraphs: [{ runs: [{ text: 'hi' }] }] });
  const p = createPresentation({ theme, slides: [createSlide({ elements: [t] }), createSlide()] });
  return { p, t };
}

describe('DeckDoc (Yjs binding)', () => {
  it('round-trips a presentation through Yjs', () => {
    const { p } = base();
    const d = docFromPresentation(p);
    expect(d.presentation.slides.map((s) => s.id)).toEqual(p.slides.map((s) => s.id));
    expect(d.presentation.slides[0]!.elements[0]).toEqual(p.slides[0]!.elements[0]);
    // reload from binary update
    const d2 = new DeckDoc();
    Y.applyUpdate(d2.doc, Y.encodeStateAsUpdate(d.doc));
    expect(d2.presentation.slides[0]!.elements[0]).toEqual(p.slides[0]!.elements[0]);
  });

  it('undo/redo local changes only', () => {
    const { p, t } = base();
    const d = docFromPresentation(p);
    const cur = d.presentation;
    d.commit({ ...cur, slides: cur.slides.map((s, i) => (i === 0 ? { ...s, elements: s.elements.map((e) => ({ ...e, x: 999 })) } : s)) });
    expect(d.presentation.slides[0]!.elements[0]!.x).toBe(999);
    d.undo.undo();
    expect(d.presentation.slides[0]!.elements[0]!.x).toBe(t.x);
    d.undo.redo();
    expect(d.presentation.slides[0]!.elements[0]!.x).toBe(999);
  });

  it('merges concurrent edits to different fields and slides', () => {
    const { p } = base();
    const a = docFromPresentation(p);
    const b = new DeckDoc();
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc));
    const pa = a.presentation, pb = b.presentation;
    a.commit({ ...pa, slides: pa.slides.map((s, i) => (i === 0 ? { ...s, elements: s.elements.map((e) => ({ ...e, x: 10 })) } : s)) });
    b.commit({ ...pb, slides: pb.slides.map((s, i) => (i === 0 ? { ...s, elements: s.elements.map((e) => ({ ...e, y: 20 })) } : s)) });
    b.commit({ ...b.presentation, slides: [...b.presentation.slides, createSlide({ notes: 'from b' })] });
    const ua = Y.encodeStateAsUpdate(a.doc), ub = Y.encodeStateAsUpdate(b.doc);
    Y.applyUpdate(a.doc, ub);
    Y.applyUpdate(b.doc, ua);
    for (const d of [a, b]) {
      const el = d.presentation.slides[0]!.elements[0]!;
      expect(el.x).toBe(10);
      expect(el.y).toBe(20);
      expect(d.presentation.slides).toHaveLength(3);
    }
    expect(JSON.stringify(a.presentation)).toBe(JSON.stringify(b.presentation));
  });

  it('concurrent reorders converge without duplicates', () => {
    const p = createPresentation({ slides: [createSlide(), createSlide(), createSlide()] });
    const a = docFromPresentation(p);
    const b = new DeckDoc();
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc));
    const [s1, s2, s3] = p.slides as [typeof p.slides[0], typeof p.slides[0], typeof p.slides[0]];
    a.commit({ ...a.presentation, slides: [s3, s1, s2] });
    b.commit({ ...b.presentation, slides: [s2, s3, s1] });
    Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b.doc));
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc));
    const ids = a.presentation.slides.map((s) => s.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids).toEqual(b.presentation.slides.map((s) => s.id));
  });

  it('cloneSlide remaps ids and animation targets', () => {
    const { p, t } = base();
    const s = { ...p.slides[0]!, animations: [{ id: 'a', elementId: t.id, class: 'entrance' as const, effect: 'fade' as const, trigger: 'click' as const, delay: 0, duration: 1, direction: 'up' as const, easing: 'ease' as const }] };
    const c = cloneSlide(s);
    expect(c.id).not.toBe(s.id);
    expect(c.elements[0]!.id).not.toBe(t.id);
    expect(c.animations[0]!.elementId).toBe(c.elements[0]!.id);
  });

  it('handles hundreds of slides efficiently', () => {
    const theme = themeById('graphite');
    const slides = Array.from({ length: 500 }, (_, i) => createSlide({ elements: Array.from({ length: 10 }, () => createText(theme, { paragraphs: [{ runs: [{ text: `slide ${i}` }] }] })) }));
    const t0 = performance.now();
    const d = docFromPresentation(createPresentation({ slides }));
    const tBuild = performance.now() - t0;
    const t1 = performance.now();
    const cur = d.presentation;
    d.commit({ ...cur, slides: cur.slides.map((s, i) => (i === 250 ? { ...s, notes: 'edited' } : s)) });
    const tEdit = performance.now() - t1;
    expect(d.presentation.slides[250]!.notes).toBe('edited');
    expect(tBuild).toBeLessThan(5000);
    expect(tEdit).toBeLessThan(100);
  });
});
