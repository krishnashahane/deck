import { describe, expect, it } from 'vitest';
import { safeHref, safeZipPath, sanitizeSvg, sniff } from '../src';

describe('content sniffing', () => {
  it('identifies by bytes, not names', () => {
    expect(sniff(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('image/png');
    expect(sniff(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniff(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe('image/svg+xml');
    expect(sniff(new TextEncoder().encode('<script>alert(1)</script>'))).toBe('unknown');
    expect(sniff(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe('application/zip');
  });
});

describe('SVG sanitiser', () => {
  it('removes scripts, handlers, foreignObject and external refs', () => {
    const dirty = `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><foreignObject><div>x</div></foreignObject><a href="javascript:alert(3)"><rect width="10" height="10"/></a><image href="https://evil.example/x.png"/><rect width="5" height="5" fill="url(https://evil.example/#x)" style="background:url(https://evil.example)"/><use href="#ok"/><circle r="3" onclick="x()"/></svg>`;
    const clean = sanitizeSvg(dirty);
    expect(clean).not.toMatch(/script|onload|onclick|foreignObject|javascript|evil\.example/i);
    expect(clean).toContain('<circle');
    expect(clean).toContain('href="#ok"');
  });
  it('rejects DOCTYPE in SVG', () => {
    expect(() => sanitizeSvg('<!DOCTYPE svg [<!ENTITY x "y">]><svg/>')).toThrow();
  });
});

describe('paths and links', () => {
  it('flags unsafe zip paths', () => {
    for (const p of ['../a', 'a/../../b', '/abs', 'C:/x', 'a\\b', 'a\u0000b']) expect(safeZipPath(p)).toBe(false);
    for (const p of ['ppt/slides/slide1.xml', '[Content_Types].xml']) expect(safeZipPath(p)).toBe(true);
  });
  it('only allows http(s)/mailto links', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,x')).toBeNull();
    expect(safeHref('https://example.com')).toBe('https://example.com/');
    expect(safeHref('mailto:a@b.c')).toBe('mailto:a@b.c');
  });
});
