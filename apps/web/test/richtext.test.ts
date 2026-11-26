import { describe, expect, it } from 'vitest';
import { createText, themeById, type Paragraph } from '@deck/core';
import { toEditableHtml, safeColor } from '../src/editor/richtext';

describe('rich-text markup is safe against hostile document values', () => {
  it('does not let colours, fonts, sizes or text break out of markup', () => {
    const style = createText(themeById('graphite')).style;
    const evil = '"><img src=x onerror=alert(1)>';
    const paras = [{
      runs: [{ text: '<script>alert(2)</script>', color: evil, font: `x';}</style><img src=y onerror=alert(3)>`, size: evil as unknown as number, highlight: 'red;background:url(https://evil.example)', link: 'javascript:alert(4)"><b>' }],
      align: evil as unknown as Paragraph['align'],
      lineHeight: evil as unknown as number,
      bullet: evil as unknown as Paragraph['bullet'],
      level: evil as unknown as number,
    }] as Paragraph[];
    const html = toEditableHtml(paras, style);
    expect(html).not.toMatch(/<img|<script|<b>|url\(|javascript:|"\s*on\w+=/i);
    expect(html).toContain('&lt;script&gt;');
    expect(safeColor('#FFAA00')).toBe('#FFAA00');
    expect(safeColor('red;x')).toBeNull();
  });
});
