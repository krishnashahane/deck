import { describe, expect, it } from 'vitest';
import { THEMES, align, analyzeSlide, applyLayout, applyTheme, buildSteps, createAnimation, createShape, createSlide, createText, distribute, expandToGroups, group, initiallyHidden, reorder, snap, themeById, visibilityAfter, createPresentation, LAYOUTS } from '../src';

const theme = themeById('graphite');

describe('animation sequencing', () => {
  it('groups click / with / after into steps with correct offsets', () => {
    const s = createSlide();
    s.animations = [
      createAnimation('a', { trigger: 'click', duration: 500 }),
      createAnimation('b', { trigger: 'with', delay: 100, duration: 300 }),
      createAnimation('c', { trigger: 'after', duration: 200 }),
      createAnimation('d', { trigger: 'click', duration: 100, class: 'exit' }),
    ];
    const { auto, steps } = buildSteps(s);
    expect(auto).toBeNull();
    expect(steps).toHaveLength(2);
    expect(steps[0]!.items.map((i) => [i.start, i.end])).toEqual([[0, 500], [100, 400], [400, 600]]);
    expect(steps[0]!.duration).toBe(600);
    expect(initiallyHidden(s)).toEqual(new Set(['a', 'b', 'c']));
    expect(visibilityAfter(s, 1).get('a')).toBe(true);
    expect(visibilityAfter(s, 2).get('d')).toBe(false);
  });
  it('a leading with/after animation plays automatically', () => {
    const s = createSlide();
    s.animations = [createAnimation('a', { trigger: 'after' }), createAnimation('b', { trigger: 'click' })];
    const { auto, steps } = buildSteps(s);
    expect(auto?.items).toHaveLength(1);
    expect(steps).toHaveLength(1);
  });
});

describe('editing operations', () => {
  const a = createShape(theme, 'rect', { x: 0, y: 0, w: 100, h: 100 });
  const b = createShape(theme, 'rect', { x: 300, y: 50, w: 100, h: 100 });
  const c = createShape(theme, 'rect', { x: 1000, y: 200, w: 100, h: 100 });
  it('aligns and distributes', () => {
    expect(align([a, b], 'top', { width: 1920, height: 1080 }).map((e) => e.y)).toEqual([0, 0]);
    expect(align([a], 'center', { width: 1920, height: 1080 })[0]!.x).toBe(910);
    const d = distribute([a, b, c], 'h');
    expect(d[1]!.x).toBe(500);
  });
  it('reorders z-order', () => {
    const s = createSlide({ elements: [a, b, c] });
    expect(reorder(s, new Set([a.id]), 'front').map((e) => e.id)).toEqual([b.id, c.id, a.id]);
    expect(reorder(s, new Set([c.id]), 'backward').map((e) => e.id)).toEqual([a.id, c.id, b.id]);
  });
  it('groups and expands selection', () => {
    const s = group(createSlide({ elements: [a, b, c] }), new Set([a.id, b.id]));
    expect(expandToGroups(s, [a.id])).toEqual(new Set([a.id, b.id]));
  });
  it('snaps to slide centre and other edges', () => {
    const r = snap({ x: 905, y: 10, w: 100, h: 100 }, [], { width: 1920, height: 1080 }, { threshold: 8 });
    expect(r.dx).toBe(5);
    expect(r.guides[0]!.axis).toBe('x');
    const r2 = snap({ x: 103, y: 500, w: 50, h: 50 }, [{ x: 0, y: 0, w: 100, h: 100 }], { width: 1920, height: 1080 }, { threshold: 8 });
    expect(r2.dx).toBe(-3);
  });
});

describe('themes & layouts', () => {
  it('every layout builds inside the slide for every theme and size', () => {
    for (const t of THEMES) for (const [w, h] of [[1920, 1080], [1440, 1080], [1080, 1920]]) for (const l of LAYOUTS) {
      for (const e of l.build(t, w!, h!)) {
        expect(e.x).toBeGreaterThanOrEqual(0);
        expect(e.x + e.w).toBeLessThanOrEqual(w! + 1);
      }
    }
  });
  it('applyLayout keeps placeholder text', () => {
    const p = createPresentation({ theme });
    const s = applyLayout(createSlide(), 'title-content', p);
    const title = s.elements.find((e) => e.placeholder === 'title')!;
    if (title.type === 'text') title.paragraphs = [{ runs: [{ text: 'Keep me' }] }];
    const s2 = applyLayout(s, 'two-column', p);
    const t2 = s2.elements.find((e) => e.placeholder === 'title')!;
    expect(t2.type === 'text' && t2.paragraphs[0]!.runs[0]!.text).toBe('Keep me');
  });
  it('applyTheme maps theme colours and fonts but keeps custom colours', () => {
    const t = createText(theme, { paragraphs: [{ runs: [{ text: 'x', color: '#123456' }] }] });
    const p = createPresentation({ theme, slides: [createSlide({ elements: [t] })] });
    const next = themeById('paper');
    const out = applyTheme(p, next);
    const el = out.slides[0]!.elements[0]!;
    if (el.type === 'text') {
      expect(el.style.color).toBe(next.colors.text);
      expect(el.style.font).toBe(next.fonts.body);
      expect(el.paragraphs[0]!.runs[0]!.color).toBe('#123456');
    }
  });
  it('detects overcrowded slides and tiny text', () => {
    const t = createText(theme, { paragraphs: [{ runs: [{ text: 'word '.repeat(120) }] }], style: { ...createText(theme).style, size: 10 } });
    const issues = analyzeSlide(createSlide({ elements: [t] }), createPresentation({ theme }));
    expect(issues.map((i) => i.code)).toEqual(expect.arrayContaining(['overcrowded', 'small-text']));
  });
});
