import { describe, expect, it } from 'vitest';
import { createChart, createPresentation, createSlide, createTable, createText, findInPresentation, findPattern, replaceInPresentation, themeById, type Presentation, type TextElement } from '../src';

const theme = themeById('graphite');

function deck(): Presentation {
  const t1 = createText(theme, { paragraphs: [{ runs: [{ text: 'Revenue grew in Q3. ' }, { text: 'Rev', bold: true }, { text: 'enue is up.' }] }] });
  const t2 = createText(theme, { paragraphs: [{ runs: [{ text: 'Previews and revenues' }] }] });
  const table = createTable(theme, 2, 2);
  table.rows[1]![0]!.text = 'Revenue';
  const chart = createChart(theme, 'column', { title: 'Revenue by quarter', categories: ['Q1', 'Q2'], series: [{ name: 'Revenue', values: [1, 2] }] });
  const s1 = createSlide({ elements: [t1, table], notes: 'Mention revenue twice: revenue.' });
  const s2 = createSlide({ elements: [t2, chart] });
  return createPresentation({ slides: [s1, s2] });
}

describe('find', () => {
  it('finds case-insensitively across runs, tables, charts and notes, in document order', () => {
    const m = findInPresentation(deck(), 'revenue');
    // slide 1: text×2 (one split across bold/plain runs), table×1, notes×2; slide 2: "revenues"×1, chart title, series
    expect(m.length).toBe(8);
    expect(m.map((x) => x.slideIndex)).toEqual([0, 0, 0, 0, 0, 1, 1, 1]);
    expect(m[1]!.context[1]).toBe('Revenue'); // matched across the bold boundary
    expect(m.filter((x) => x.place.kind === 'notes').length).toBe(2);
  });

  it('honours match case, whole word and scope options', () => {
    expect(findInPresentation(deck(), 'Revenue', { matchCase: true }).length).toBe(5);
    expect(findInPresentation(deck(), 'revenue', { wholeWord: true }).length).toBe(7); // excludes "revenues"
    expect(findInPresentation(deck(), 'revenue', { notes: false, tables: false, charts: false }).length).toBe(3);
  });

  it('treats the query literally and rejects empty or oversized queries', () => {
    expect(findInPresentation(deck(), 'Q3.').length).toBe(1);
    expect(findInPresentation(deck(), '.*').length).toBe(0);
    expect(findPattern('')).toBeNull();
    expect(findPattern('x'.repeat(501))).toBeNull();
  });

  it('whole-word matching understands non-ASCII letters', () => {
    const t = createText(theme, { paragraphs: [{ runs: [{ text: 'café cafés' }] }] });
    const p = createPresentation({ slides: [createSlide({ elements: [t] })] });
    expect(findInPresentation(p, 'café', { wholeWord: true }).length).toBe(1);
  });
});

describe('replace', () => {
  it('replaces everywhere, keeping the formatting of the run where each match starts', () => {
    const before = deck();
    const { presentation: p, count } = replaceInPresentation(before, 'revenue', 'Income', { wholeWord: true });
    expect(count).toBe(7);
    const t1 = p.slides[0]!.elements[0] as TextElement;
    expect(t1.paragraphs[0]!.runs.map((r) => r.text).join('')).toBe('Income grew in Q3. Income is up.');
    const bold = t1.paragraphs[0]!.runs.find((r) => r.bold);
    expect(bold?.text).toBe('Income');
    expect(p.slides[0]!.notes).toBe('Mention Income twice: Income.');
    expect(findInPresentation(p, 'revenue', { wholeWord: true }).length).toBe(0);
    // input not mutated
    expect(findInPresentation(before, 'revenue', { wholeWord: true }).length).toBe(7);
  });

  it('replaces only the selected match', () => {
    const d = deck();
    const m = findInPresentation(d, 'revenue');
    const { presentation: p, count } = replaceInPresentation(d, 'revenue', 'sales', {}, [m[3]!.key]);
    expect(count).toBe(1);
    expect(p.slides[0]!.notes).toBe('Mention sales twice: revenue.');
    expect(findInPresentation(p, 'revenue').length).toBe(7);
  });

  it('skips locked elements and reports them', () => {
    const d = deck();
    d.slides[1]!.elements[1]!.locked = true;
    const m = findInPresentation(d, 'revenue');
    expect(m.filter((x) => x.locked).length).toBe(2);
    const { count } = replaceInPresentation(d, 'revenue', 'x');
    expect(count).toBe(6);
  });

  it('returns the same object when nothing matches and handles deletion', () => {
    const d = deck();
    expect(replaceInPresentation(d, 'zzz', 'y').presentation).toBe(d);
    const { presentation: p } = replaceInPresentation(d, 'Rev', '', { matchCase: true });
    const t1 = p.slides[0]!.elements[0] as TextElement;
    expect(t1.paragraphs[0]!.runs.map((r) => r.text).join('')).toBe('enue grew in Q3. enue is up.');
  });
});
