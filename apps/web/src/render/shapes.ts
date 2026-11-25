import type { ShapeKind } from '@deck/core';

/** SVG path data for a shape kind inside a w×h box (origin top-left). */
export function shapePath(kind: ShapeKind, w: number, h: number, r = 0): string {
  const poly = (pts: [number, number][]) => 'M' + pts.map(([x, y]) => `${x * w},${y * h}`).join('L') + 'Z';
  const regular = (n: number, rot = -Math.PI / 2) =>
    poly(Array.from({ length: n }, (_, i) => {
      const a = rot + (i * 2 * Math.PI) / n;
      return [0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a)] as [number, number];
    }));
  switch (kind) {
    case 'rect':
      return `M0,0H${w}V${h}H0Z`;
    case 'roundRect': {
      const rr = Math.max(0, Math.min(r, w / 2, h / 2));
      return `M${rr},0H${w - rr}A${rr},${rr} 0 0 1 ${w},${rr}V${h - rr}A${rr},${rr} 0 0 1 ${w - rr},${h}H${rr}A${rr},${rr} 0 0 1 0,${h - rr}V${rr}A${rr},${rr} 0 0 1 ${rr},0Z`;
    }
    case 'ellipse':
      return `M${w / 2},0A${w / 2},${h / 2} 0 1 1 ${w / 2},${h}A${w / 2},${h / 2} 0 1 1 ${w / 2},0Z`;
    case 'triangle':
      return poly([[0.5, 0], [1, 1], [0, 1]]);
    case 'diamond':
      return poly([[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]]);
    case 'pentagon':
      return regular(5);
    case 'hexagon':
      return poly([[0.25, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0.25, 1], [0, 0.5]]);
    case 'star': {
      const pts: [number, number][] = [];
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rad = i % 2 ? 0.19 : 0.5;
        pts.push([0.5 + rad * Math.cos(a), 0.5 + rad * Math.sin(a) * 1.05 + 0.03]);
      }
      return poly(pts);
    }
    case 'arrowRight':
      return poly([[0, 0.25], [0.6, 0.25], [0.6, 0], [1, 0.5], [0.6, 1], [0.6, 0.75], [0, 0.75]]);
    case 'chevron':
      return poly([[0, 0], [0.7, 0], [1, 0.5], [0.7, 1], [0, 1], [0.3, 0.5]]);
    case 'speech': {
      const rr = Math.min(w, h) * 0.12;
      const bh = h * 0.78;
      return `M${rr},0H${w - rr}Q${w},0 ${w},${rr}V${bh - rr}Q${w},${bh} ${w - rr},${bh}H${w * 0.42}L${w * 0.22},${h}L${w * 0.26},${bh}H${rr}Q0,${bh} 0,${bh - rr}V${rr}Q0,0 ${rr},0Z`;
    }
    case 'cloud':
      return `M${w * 0.25},${h * 0.85}C${w * 0.02},${h * 0.85} ${w * 0.02},${h * 0.5} ${w * 0.22},${h * 0.48}C${w * 0.18},${h * 0.18} ${w * 0.5},${h * 0.08} ${w * 0.58},${h * 0.3}C${w * 0.7},${h * 0.12} ${w * 0.95},${h * 0.25} ${w * 0.85},${h * 0.5}C${w * 1.02},${h * 0.55} ${w * 0.98},${h * 0.85} ${w * 0.78},${h * 0.85}Z`;
    case 'heart':
      return `M${w / 2},${h * 0.95}C${w * 0.1},${h * 0.65} 0,${h * 0.42} 0,${h * 0.28}C0,${h * 0.08} ${w * 0.18},0 ${w * 0.3},0C${w * 0.42},0 ${w * 0.48},${h * 0.08} ${w / 2},${h * 0.18}C${w * 0.52},${h * 0.08} ${w * 0.58},0 ${w * 0.7},0C${w * 0.82},0 ${w},${h * 0.08} ${w},${h * 0.28}C${w},${h * 0.42} ${w * 0.9},${h * 0.65} ${w / 2},${h * 0.95}Z`;
    case 'plus':
      return poly([[0.35, 0], [0.65, 0], [0.65, 0.35], [1, 0.35], [1, 0.65], [0.65, 0.65], [0.65, 1], [0.35, 1], [0.35, 0.65], [0, 0.65], [0, 0.35], [0.35, 0.35]]);
  }
}

export const SHAPE_KINDS: ShapeKind[] = ['rect', 'roundRect', 'ellipse', 'triangle', 'diamond', 'pentagon', 'hexagon', 'star', 'arrowRight', 'chevron', 'speech', 'cloud', 'heart', 'plus'];
