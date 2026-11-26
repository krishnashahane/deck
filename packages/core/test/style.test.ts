import { describe, expect, it } from 'vitest';
import { copyStyle, createEquation, createShape, createTable, createText, pasteStyle, themeById, type ShapeElement, type TextElement } from '../src';

const theme = themeById('graphite');

describe('format painter', () => {
  it('copies appearance, never content, geometry or links', () => {
    const src = createShape(theme, 'roundRect', { fill: { kind: 'solid', color: '#ff0000' }, cornerRadius: 30, opacity: 0.5 });
    src.paragraphs = [{ runs: [{ text: 'Source', bold: true, color: '#00ff00' }] }];
    const dst = createText(theme, { x: 10, y: 20, w: 300, h: 80, paragraphs: [{ runs: [{ text: 'Keep ', italic: true }, { text: 'me', link: 'https://example.com' }] }] });
    const out = pasteStyle(dst, copyStyle(src)) as TextElement;
    expect([out.x, out.y, out.w, out.h, out.id]).toEqual([10, 20, 300, 80, dst.id]);
    expect(out.paragraphs[0]!.runs.map((r) => r.text).join('')).toBe('Keep me');
    expect(out.paragraphs[0]!.runs[1]!.link).toBe('https://example.com');
    expect(out.paragraphs[0]!.runs.every((r) => r.bold && r.color === '#00ff00' && !r.italic)).toBe(true);
    expect(out.fill).toEqual({ kind: 'solid', color: '#ff0000' });
    expect(out.opacity).toBe(0.5);
    expect('cornerRadius' in out).toBe(false); // text has no corner radius
  });

  it('applies shape-only properties to shapes and colour to equations', () => {
    const src = createShape(theme, 'rect', { cornerRadius: 12, shadow: { x: 0, y: 4, blur: 10, color: '#000000', opacity: 0.3 } } as Partial<ShapeElement>);
    src.style = { ...src.style, color: '#123456' };
    const dst = pasteStyle(createShape(theme, 'ellipse'), copyStyle(src)) as ShapeElement;
    expect(dst.shape).toBe('ellipse');
    expect(dst.cornerRadius).toBe(12);
    expect(dst.shadow?.blur).toBe(10);
    const eq = pasteStyle(createEquation(theme), copyStyle(src));
    expect(eq.type === 'equation' && eq.color).toBe('#123456');
  });

  it('does not share mutable objects with the source', () => {
    const a = createTable(theme);
    const b = pasteStyle(createTable(theme), copyStyle(a));
    expect(b.type === 'table' && b.style).not.toBe(a.style);
  });
});
