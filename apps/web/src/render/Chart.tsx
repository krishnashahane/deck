import type { ChartElement } from '@deck/core';
import { UNITS_PER_POINT } from '@deck/core';

/** Dependency-free SVG chart renderer covering every chart kind DECK can import/export. */
export function ChartView({ el, palette }: { el: ChartElement; palette: string[] }) {
  const { x, y, w, h } = el;
  const font = `"${el.style.font}", system-ui, sans-serif`;
  const fs = 14 * UNITS_PER_POINT * Math.max(0.6, Math.min(1.4, w / 1400));
  const titleH = el.title ? fs * 2.2 : 0;
  const legendH = el.legend ? fs * 2.2 : 0;
  const color = (i: number) => el.series[i]?.color ?? palette[i % palette.length] ?? '#888';
  const isPie = el.chart === 'pie' || el.chart === 'donut';
  const fmt = (v: number) => (Math.abs(v) >= 1000 ? v.toLocaleString() : String(Math.round(v * 100) / 100));

  const legendItems = isPie ? el.categories.map((c, i) => ({ name: c, color: palette[i % palette.length] ?? '#888' })) : el.series.map((s, i) => ({ name: s.name, color: color(i) }));
  const legend = el.legend && (
    <g transform={`translate(${x + w / 2} ${y + h - legendH / 2})`}>
      {(() => {
        const widths = legendItems.map((l) => fs * 1.4 + l.name.length * fs * 0.58 + fs);
        const total = widths.reduce((a, b) => a + b, 0);
        let cur = -total / 2;
        return legendItems.map((l, i) => {
          const gx = cur;
          cur += widths[i]!;
          return (
            <g key={i} transform={`translate(${gx} 0)`}>
              <rect x={0} y={-fs * 0.4} width={fs * 0.8} height={fs * 0.8} rx={fs * 0.2} fill={l.color} />
              <text x={fs * 1.2} y={0} dominantBaseline="central" fontSize={fs} fill={el.style.color} fontFamily={font}>{l.name}</text>
            </g>
          );
        });
      })()}
    </g>
  );
  const title = el.title && (
    <text x={x + w / 2} y={y + titleH / 2} textAnchor="middle" dominantBaseline="central" fontSize={fs * 1.3} fontWeight={700} fill={el.style.color} fontFamily={font}>{el.title}</text>
  );

  if (isPie) {
    const vals = el.series[0]?.values ?? [];
    const total = vals.reduce((a, b) => a + Math.max(0, b), 0) || 1;
    const cx = x + w / 2, cy = y + titleH + (h - titleH - legendH) / 2;
    const r = Math.max(4, Math.min(w, h - titleH - legendH) / 2 - fs);
    const inner = el.chart === 'donut' ? r * 0.58 : 0;
    let a0 = -Math.PI / 2;
    const slices = vals.map((v, i) => {
      const a1 = a0 + (Math.max(0, v) / total) * Math.PI * 2;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const p = (a: number, rr: number) => `${cx + rr * Math.cos(a)},${cy + rr * Math.sin(a)}`;
      const full = vals.length === 1 || Math.abs(a1 - a0 - Math.PI * 2) < 1e-6;
      const d = full
        ? `M${cx - r},${cy}a${r},${r} 0 1 0 ${2 * r},0a${r},${r} 0 1 0 ${-2 * r},0` + (inner ? `M${cx - inner},${cy}a${inner},${inner} 0 1 1 ${2 * inner},0a${inner},${inner} 0 1 1 ${-2 * inner},0` : '')
        : inner
          ? `M${p(a0, r)}A${r},${r} 0 ${large} 1 ${p(a1, r)}L${p(a1, inner)}A${inner},${inner} 0 ${large} 0 ${p(a0, inner)}Z`
          : `M${cx},${cy}L${p(a0, r)}A${r},${r} 0 ${large} 1 ${p(a1, r)}Z`;
      const mid = (a0 + a1) / 2;
      const lr = inner ? (r + inner) / 2 : r * 0.62;
      const out = { d, color: palette[i % palette.length] ?? '#888', lx: cx + lr * Math.cos(mid), ly: cy + lr * Math.sin(mid), v };
      a0 = a1;
      return out;
    });
    return (
      <g>
        {title}
        {slices.map((s, i) => <path key={i} d={s.d} fill={s.color} fillRule="evenodd" />)}
        {el.dataLabels && slices.map((s, i) => <text key={i} x={s.lx} y={s.ly} textAnchor="middle" dominantBaseline="central" fontSize={fs} fontWeight={700} fill="#fff" fontFamily={font}>{fmt(s.v)}</text>)}
        {legend}
      </g>
    );
  }

  const all = el.series.flatMap((s) => s.values);
  const max = Math.max(0, ...all);
  const min = Math.min(0, ...all);
  const nice = (v: number) => {
    if (v === 0) return 1;
    const e = Math.pow(10, Math.floor(Math.log10(Math.abs(v))));
    const f = Math.abs(v) / e;
    return Math.sign(v) * (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e;
  };
  const top = nice(max || 1);
  const bottom = min < 0 ? -nice(-min) : 0;
  const axisW = fs * 3.4;
  const px = x + axisW, py = y + titleH + fs * 0.5;
  const pw = Math.max(10, w - axisW - fs), ph = Math.max(10, h - titleH - legendH - fs * 2.4);
  const horizontal = el.chart === 'bar';
  const n = Math.max(1, el.categories.length);
  const ticks = 5;
  const val = (v: number) => (v - bottom) / (top - bottom || 1);
  const grid = Array.from({ length: ticks + 1 }, (_, i) => bottom + ((top - bottom) * i) / ticks);

  const plots: React.ReactNode[] = [];
  if (el.chart === 'column' || el.chart === 'bar') {
    const band = (horizontal ? ph : pw) / n;
    const bw = (band * 0.72) / Math.max(1, el.series.length);
    el.series.forEach((s, si) =>
      s.values.forEach((v, ci) => {
        const z = val(0), t = val(v);
        if (horizontal) {
          const by = py + ci * band + band * 0.14 + si * bw;
          const x0 = px + Math.min(z, t) * pw;
          plots.push(<rect key={`${si}-${ci}`} x={x0} y={by} width={Math.abs(t - z) * pw} height={bw * 0.92} rx={Math.min(6, bw / 4)} fill={color(si)} />);
          if (el.dataLabels) plots.push(<text key={`l${si}-${ci}`} x={x0 + Math.abs(t - z) * pw + fs * 0.4} y={by + bw / 2} dominantBaseline="central" fontSize={fs * 0.9} fill={el.style.color} fontFamily={font}>{fmt(v)}</text>);
        } else {
          const bx = px + ci * band + band * 0.14 + si * bw;
          const y0 = py + ph - Math.max(z, t) * ph;
          plots.push(<rect key={`${si}-${ci}`} x={bx} y={y0} width={bw * 0.92} height={Math.abs(t - z) * ph} rx={Math.min(6, bw / 4)} fill={color(si)} />);
          if (el.dataLabels) plots.push(<text key={`l${si}-${ci}`} x={bx + bw / 2} y={y0 - fs * 0.5} textAnchor="middle" fontSize={fs * 0.9} fill={el.style.color} fontFamily={font}>{fmt(v)}</text>);
        }
      }),
    );
  } else {
    const step = el.chart === 'scatter' ? pw / Math.max(1, n - 1 || 1) : pw / n;
    const xAt = (ci: number) => (el.chart === 'scatter' ? px + ci * step : px + step * (ci + 0.5));
    el.series.forEach((s, si) => {
      const pts = s.values.map((v, ci) => [xAt(ci), py + ph - val(v) * ph] as const);
      const d = pts.map(([a, b], i) => `${i ? 'L' : 'M'}${a},${b}`).join('');
      if (el.chart === 'area') plots.push(<path key={`a${si}`} d={`${d}L${pts[pts.length - 1]?.[0] ?? px},${py + ph - val(0) * ph}L${pts[0]?.[0] ?? px},${py + ph - val(0) * ph}Z`} fill={color(si)} opacity={0.28} />);
      if (el.chart !== 'scatter') plots.push(<path key={`l${si}`} d={d} fill="none" stroke={color(si)} strokeWidth={Math.max(2, fs * 0.22)} strokeLinejoin="round" strokeLinecap="round" />);
      pts.forEach(([a, b], ci) => {
        plots.push(<circle key={`p${si}-${ci}`} cx={a} cy={b} r={el.chart === 'scatter' ? fs * 0.38 : fs * 0.22} fill={color(si)} />);
        if (el.dataLabels) plots.push(<text key={`t${si}-${ci}`} x={a} y={b - fs * 0.7} textAnchor="middle" fontSize={fs * 0.9} fill={el.style.color} fontFamily={font}>{fmt(s.values[ci]!)}</text>);
      });
    });
  }

  return (
    <g>
      {title}
      {grid.map((g, i) => {
        const t = val(g);
        return horizontal ? (
          <g key={i}>
            <line x1={px + t * pw} x2={px + t * pw} y1={py} y2={py + ph} stroke={el.style.grid} strokeOpacity={0.35} strokeWidth={1.5} />
            <text x={px + t * pw} y={py + ph + fs * 1.2} textAnchor="middle" fontSize={fs * 0.85} fill={el.style.color} opacity={0.7} fontFamily={font}>{fmt(g)}</text>
          </g>
        ) : (
          <g key={i}>
            <line x1={px} x2={px + pw} y1={py + ph - t * ph} y2={py + ph - t * ph} stroke={el.style.grid} strokeOpacity={0.35} strokeWidth={1.5} />
            <text x={px - fs * 0.6} y={py + ph - t * ph} textAnchor="end" dominantBaseline="central" fontSize={fs * 0.85} fill={el.style.color} opacity={0.7} fontFamily={font}>{fmt(g)}</text>
          </g>
        );
      })}
      {el.categories.map((c, i) =>
        horizontal ? (
          <text key={i} x={px - fs * 0.6} y={py + (ph / n) * (i + 0.5)} textAnchor="end" dominantBaseline="central" fontSize={fs * 0.9} fill={el.style.color} fontFamily={font}>{c}</text>
        ) : (
          <text key={i} x={el.chart === 'scatter' ? px + (pw / Math.max(1, n - 1 || 1)) * i : px + (pw / n) * (i + 0.5)} y={py + ph + fs * 1.3} textAnchor="middle" fontSize={fs * 0.9} fill={el.style.color} fontFamily={font}>{c}</text>
        ),
      )}
      {plots}
      {legend}
    </g>
  );
}
