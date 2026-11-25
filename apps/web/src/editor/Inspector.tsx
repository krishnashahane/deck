import { useMemo, useState } from 'react';
import {
  EFFECTS_BY_CLASS, FONT_FAMILIES, LAYOUTS, SLIDE_PRESETS, THEMES, analyzeSlide, applyLayout, applyTheme, createAnimation, layoutById, safeHref, themePalette,
  type Animation, type ChartElement, type Fill, type Presentation, type ShapeKind, type Slide, type SlideElement, type TableElement, type Transition,
} from '@deck/core';
import { useEditor, type EditorStore } from '../lib/store';
import { SlideView, slideTitle } from '../render/SlideView';
import { SHAPE_KINDS, shapePath } from '../render/shapes';
import { Icon } from './icons';
import { ColorPicker, NumberField } from './ui';
import { alignSelection, distributeSelection, pickFiles, setLayout, zorder } from './actions';
import { addFile } from '../lib/assets';
import { previewSlideAnimations, previewTransition } from '../present/engine';
import { toast } from '../lib/toast';

export function Inspector({ store }: { store: EditorStore }) {
  const { pres, ui } = useEditor(store, (s) => s);
  const slide = pres.slides.find((s) => s.id === ui.slideId);
  const sel = slide?.elements.filter((e) => ui.selection.includes(e.id)) ?? [];
  const tab = ui.inspector === 'format' && !sel.length ? 'design' : ui.inspector;
  return (
    <aside className="inspector" aria-label="Inspector">
      <div className="tabs" role="tablist">
        {(['design', 'format', 'animate', 'review'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={`tab ${tab === t ? 'on' : ''}`} disabled={t === 'format' && !sel.length} onClick={() => store.setUi({ inspector: t })}>
            {t[0]!.toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      <div className="insp-body">
        {!slide ? null : tab === 'design' ? <DesignPanel store={store} pres={pres} slide={slide} /> : tab === 'format' ? <FormatPanel store={store} pres={pres} slide={slide} sel={sel} /> : tab === 'animate' ? <AnimatePanel store={store} pres={pres} slide={slide} sel={sel} animId={ui.animId} /> : <ReviewPanel store={store} pres={pres} />}
      </div>
    </aside>
  );
}

/* ───────────── design ───────────── */

function DesignPanel({ store, pres, slide }: { store: EditorStore; pres: Presentation; slide: Slide }) {
  const palette = themePalette(pres.theme);
  const bg = slide.background;
  const setBg = (f: Fill | null) => store.updateSlide(slide.id, (s) => ({ ...s, background: f }));
  const setTr = (patch: Partial<Transition>) => store.updateSlide(slide.id, (s) => ({ ...s, transition: { ...s.transition, ...patch } }));
  const previews = useMemo(() => LAYOUTS.map((l) => ({ l, slide: { ...slide, id: `pv-${l.id}`, layout: l.id, background: null, animations: [], elements: l.build(pres.theme, pres.width, pres.height) } as Slide })), [pres.theme, pres.width, pres.height, slide]);
  return (
    <>
      <section className="sect">
        <h4>Layout</h4>
        <div className="layout-grid">
          {previews.map(({ l, slide: s }) => (
            <button key={l.id} className={`layout-opt ${slide.layout === l.id ? 'on' : ''}`} onClick={() => setLayout(store, l.id)} title={l.name}>
              <div className="frame"><SlideView slide={s} pres={pres} deck={store.deck} width={80} lite /></div>
              {l.name}
            </button>
          ))}
        </div>
      </section>
      <section className="sect">
        <h4>Background</h4>
        <div className="seg">
          {(['theme', 'solid', 'linear', 'image'] as const).map((k) => (
            <button key={k} className={`btn ${(bg === null ? 'theme' : bg.kind) === k ? 'on' : ''}`} onClick={async () => {
              if (k === 'theme') setBg(null);
              if (k === 'solid') setBg({ kind: 'solid', color: pres.theme.colors.surface });
              if (k === 'linear') setBg({ kind: 'linear', angle: 135, stops: [{ offset: 0, color: pres.theme.colors.background }, { offset: 1, color: pres.theme.colors.surface }] });
              if (k === 'image') {
                const [f] = await pickFiles('image/*');
                if (!f) return;
                try {
                  const a = await addFile(store.deck, f);
                  store.update((p) => ({ ...p, assets: { ...p.assets, [a.meta.id]: a.meta } }));
                  setBg({ kind: 'image', src: a.src, fit: 'cover' });
                } catch (e) { toast((e as Error).message); }
              }
            }}>{k === 'linear' ? 'Gradient' : k[0]!.toUpperCase() + k.slice(1)}</button>
          ))}
        </div>
        {bg?.kind === 'solid' && <div className="row"><ColorPicker label="Background" value={bg.color} palette={palette} onChange={(c) => setBg({ kind: 'solid', color: c })} /><span className="label">{bg.color}</span></div>}
        {bg?.kind === 'linear' && <GradientEditor fill={bg} palette={palette} onChange={setBg} />}
        {bg?.kind === 'image' && (
          <div className="seg">{(['cover', 'contain', 'stretch'] as const).map((f) => <button key={f} className={`btn ${bg.fit === f ? 'on' : ''}`} onClick={() => setBg({ ...bg, fit: f })}>{f}</button>)}</div>
        )}
        <button className="btn ghost-strong" onClick={() => store.update((p) => ({ ...p, slides: p.slides.map((s) => ({ ...s, background: slide.background })) }))}>Apply to all slides</button>
      </section>
      <section className="sect">
        <h4>Theme</h4>
        <div className="grid2">
          {THEMES.map((t) => (
            <button key={t.id} className={`theme-opt ${pres.theme.id === t.id ? 'on' : ''}`} onClick={() => store.update((p) => applyTheme(p, structuredClone(t)))}>
              <div className="chip" style={{ background: t.colors.background, color: t.colors.text, fontFamily: `"${t.fonts.heading}"` }}>
                <span style={{ fontSize: 15, fontWeight: 700 }}>Aa</span>
                <span style={{ display: 'flex', gap: 3 }}>{[t.colors.accent, t.colors.accent2, t.colors.accent3, t.colors.accent4].map((c) => <i key={c} style={{ width: 10, height: 10, borderRadius: 3, background: c }} />)}</span>
              </div>
              {t.name}
            </button>
          ))}
        </div>
        <button className="btn ghost-strong" onClick={() => store.setUi({ dialog: 'brand' })}><Icon name="palette" />Brand kit & theme colours…</button>
      </section>
      <section className="sect">
        <h4>Transition</h4>
        <select className="select" aria-label="Transition" value={slide.transition.kind} onChange={(e) => setTr({ kind: e.target.value as Transition['kind'] })}>
          {(['none', 'fade', 'push', 'wipe', 'cover', 'zoom', 'split', 'flip', 'smart-move'] as const).map((k) => <option key={k} value={k}>{k === 'smart-move' ? 'Smart move (match objects)' : k[0]!.toUpperCase() + k.slice(1)}</option>)}
        </select>
        {slide.transition.kind !== 'none' && (
          <>
            <div className="grid2">
              <NumberField label="Duration" suffix="ms" value={slide.transition.duration} step={50} min={100} max={5000} onChange={(v) => setTr({ duration: v })} />
              <label className="field"><span>Direction</span>
                <select className="select" value={slide.transition.direction} onChange={(e) => setTr({ direction: e.target.value as Transition['direction'] })}>
                  {['left', 'right', 'up', 'down'].map((d) => <option key={d}>{d}</option>)}
                </select>
              </label>
            </div>
            <button className="btn ghost-strong" onClick={() => previewTransition(store, slide.id)}><Icon name="play" />Preview</button>
          </>
        )}
        <NumberField label="Advance automatically after (0 = on click)" suffix="ms" value={slide.transition.advanceAfter} step={500} min={0} onChange={(v) => setTr({ advanceAfter: v })} />
        <button className="btn ghost-strong" onClick={() => store.update((p) => ({ ...p, slides: p.slides.map((s) => ({ ...s, transition: { ...slide.transition } })) }))}>Apply to all slides</button>
      </section>
      <section className="sect">
        <h4>Slide</h4>
        <label className="row"><input type="checkbox" checked={slide.hidden} onChange={(e) => store.updateSlide(slide.id, (s) => ({ ...s, hidden: e.target.checked }))} />Hide slide in slideshow</label>
        <label className="field"><span>Section starting here</span>
          <input className="input" placeholder="No section" value={slide.section ?? ''} onChange={(e) => store.updateSlide(slide.id, (s) => ({ ...s, section: e.target.value || undefined }), `section:${slide.id}`)} onKeyDown={(e) => e.stopPropagation()} />
        </label>
      </section>
      <section className="sect">
        <h4>Presentation</h4>
        <label className="field"><span>Slide size</span>
          <select className="select" value={Object.entries(SLIDE_PRESETS).find(([, v]) => v.width === pres.width && v.height === pres.height)?.[0] ?? 'custom'} onChange={(e) => {
            const v = SLIDE_PRESETS[e.target.value as keyof typeof SLIDE_PRESETS];
            if (v) resize(store, v.width, v.height);
          }}>
            {Object.keys(SLIDE_PRESETS).map((k) => <option key={k} value={k}>{k}</option>)}
            <option value="custom" disabled>Custom</option>
          </select>
        </label>
        <div className="grid2">
          <NumberField label="Width" value={pres.width} min={200} max={7680} onChange={(v) => resize(store, v, pres.height)} />
          <NumberField label="Height" value={pres.height} min={200} max={7680} onChange={(v) => resize(store, pres.width, v)} />
        </div>
      </section>
    </>
  );
}

function resize(store: EditorStore, w: number, h: number) {
  const p = store.pres;
  const sx = w / p.width, sy = h / p.height;
  const k = Math.min(sx, sy);
  // Scale content uniformly and centre it so nothing is distorted.
  const ox = (w - p.width * k) / 2, oy = (h - p.height * k) / 2;
  store.update((pp) => ({
    ...pp,
    width: Math.round(w),
    height: Math.round(h),
    slides: pp.slides.map((s) => ({
      ...s,
      elements: s.elements.map((e) => {
        const n = { ...e, x: e.x * k + ox, y: e.y * k + oy, w: e.w * k, h: e.h * k } as SlideElement;
        if (n.type === 'line' && e.type === 'line') Object.assign(n, { x1: e.x1 * k + ox, y1: e.y1 * k + oy, x2: e.x2 * k + ox, y2: e.y2 * k + oy, stroke: { ...e.stroke, width: e.stroke.width * k } });
        if ((n.type === 'text' || n.type === 'shape') && (e.type === 'text' || e.type === 'shape')) Object.assign(n, { style: { ...e.style, size: Math.round(e.style.size * k * 10) / 10, padding: e.style.padding * k }, paragraphs: e.paragraphs.map((pa) => ({ ...pa, runs: pa.runs.map((r) => (r.size ? { ...r, size: Math.round(r.size * k * 10) / 10 } : r)) })) });
        return n;
      }),
    })),
  }));
}

function GradientEditor({ fill, palette, onChange }: { fill: Extract<Fill, { kind: 'linear' }>; palette: string[]; onChange: (f: Fill) => void }) {
  return (
    <>
      <div className="row">
        {fill.stops.map((s, i) => <ColorPicker key={i} label={`Stop ${i + 1}`} value={s.color} palette={palette} onChange={(c) => onChange({ ...fill, stops: fill.stops.map((x, j) => (j === i ? { ...x, color: c } : x)) })} />)}
        <span className="spacer" />
        <div style={{ width: 120 }}><NumberField label="Angle" suffix="°" value={fill.angle} min={0} max={360} onChange={(v) => onChange({ ...fill, angle: v })} /></div>
      </div>
      <div style={{ height: 14, borderRadius: 7, background: `linear-gradient(90deg, ${fill.stops.map((s) => `${s.color} ${s.offset * 100}%`).join(',')})` }} />
    </>
  );
}

/* ───────────── format ───────────── */

function FormatPanel({ store, pres, slide, sel }: { store: EditorStore; pres: Presentation; slide: Slide; sel: SlideElement[] }) {
  const palette = themePalette(pres.theme);
  const one = sel.length === 1 ? sel[0]! : null;
  const upd = (fn: (e: SlideElement) => SlideElement, key?: string) => store.updateElements(sel.map((s) => s.id), fn, key);
  const setNum = (k: 'x' | 'y' | 'w' | 'h' | 'rotation') => (v: number) => upd((e) => {
    const n = { ...e, [k]: v } as SlideElement;
    if (n.type === 'line' && e.type === 'line' && (k === 'x' || k === 'y')) {
      const d = v - e[k];
      return k === 'x' ? { ...n, x1: e.x1 + d, x2: e.x2 + d } : { ...n, y1: e.y1 + d, y2: e.y2 + d };
    }
    return n;
  });
  return (
    <>
      <section className="sect">
        <h4>{one ? one.name : `${sel.length} objects`}{one && <span className="pill">{one.type}</span>}</h4>
        {one && <label className="field"><span>Name (used for smart-move matching)</span><input className="input" value={one.name} onChange={(e) => upd((x) => ({ ...x, name: e.target.value.slice(0, 120) }), `name:${one.id}`)} onKeyDown={(e) => e.stopPropagation()} /></label>}
        <div className="grid2">
          <NumberField label="X" value={Math.round((one ?? sel[0]!).x)} onChange={setNum('x')} />
          <NumberField label="Y" value={Math.round((one ?? sel[0]!).y)} onChange={setNum('y')} />
          {one && one.type !== 'line' && <NumberField label="Width" min={1} value={Math.round(one.w)} onChange={setNum('w')} />}
          {one && one.type !== 'line' && <NumberField label="Height" min={1} value={Math.round(one.h)} onChange={setNum('h')} />}
          {one && one.type !== 'line' && <NumberField label="Rotation" suffix="°" value={one.rotation} onChange={setNum('rotation')} />}
          <NumberField label="Opacity" suffix="%" min={0} max={100} value={Math.round((one ?? sel[0]!).opacity * 100)} onChange={(v) => upd((e) => ({ ...e, opacity: v / 100 }), 'opacity')} />
        </div>
        <div className="row" style={{ gap: 2, flexWrap: 'wrap' }}>
          {(['left', 'center', 'right', 'top', 'middle', 'bottom'] as const).map((m) => (
            <button key={m} className="btn icon" title={`Align ${m}${sel.length === 1 ? ' to slide' : ''}`} aria-label={`Align ${m}`} onClick={() => alignSelection(store, m)}>
              <Icon name={{ left: 'aLeft', center: 'aCenter', right: 'aRight', top: 'aTop', middle: 'aMiddle', bottom: 'aBottom' }[m]} />
            </button>
          ))}
          <button className="btn icon" disabled={sel.length < 3} title="Distribute horizontally" aria-label="Distribute horizontally" onClick={() => distributeSelection(store, 'h')}><Icon name="distH" /></button>
          <button className="btn icon" disabled={sel.length < 3} title="Distribute vertically" aria-label="Distribute vertically" onClick={() => distributeSelection(store, 'v')}><Icon name="distV" /></button>
        </div>
        <div className="row" style={{ gap: 2 }}>
          <button className="btn" onClick={() => zorder(store, 'front')}><Icon name="front" />Front</button>
          <button className="btn" onClick={() => zorder(store, 'back')}><Icon name="back" />Back</button>
          <span className="spacer" />
          <button className="btn" onClick={() => upd((e) => ({ ...e, locked: !sel.every((s) => s.locked) || undefined }))}><Icon name={sel.every((s) => s.locked) ? 'unlock' : 'lock'} />{sel.every((s) => s.locked) ? 'Unlock' : 'Lock'}</button>
        </div>
      </section>
      {one?.type === 'shape' && (
        <section className="sect">
          <h4>Shape</h4>
          <div className="grid4">
            {SHAPE_KINDS.map((k) => (
              <button key={k} className={`btn ${one.shape === k ? 'on' : ''}`} style={{ height: 40, justifyContent: 'center' }} aria-label={k} onClick={() => upd((e) => (e.type === 'shape' ? { ...e, shape: k as ShapeKind } : e))}>
                <svg width="24" height="24" viewBox="-1 -1 26 26"><path d={shapePath(k as ShapeKind, 24, 24, 6)} fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
              </button>
            ))}
          </div>
          {one.shape === 'roundRect' && <NumberField label="Corner radius" min={0} value={Math.round(one.cornerRadius)} onChange={(v) => upd((e) => (e.type === 'shape' ? { ...e, cornerRadius: v } : e))} />}
        </section>
      )}
      {sel.every((e) => e.type === 'shape' || e.type === 'text') && <FillStroke store={store} sel={sel as Extract<SlideElement, { type: 'shape' | 'text' }>[]} palette={palette} />}
      {sel.every((e) => e.type === 'shape' || e.type === 'text') && one && (one.type === 'shape' || one.type === 'text') && <TextSection store={store} el={one} palette={palette} />}
      {one?.type === 'image' && <ImageSection store={store} el={one} palette={palette} />}
      {one?.type === 'line' && <LineSection store={store} el={one} palette={palette} />}
      {one?.type === 'table' && <TableSection store={store} el={one} palette={palette} />}
      {one?.type === 'chart' && <ChartSection store={store} el={one} />}
      {one?.type === 'media' && (
        <section className="sect">
          <h4>Playback</h4>
          {(['autoplay', 'loop', 'muted'] as const).map((k) => <label key={k} className="row"><input type="checkbox" checked={one[k]} onChange={(e) => upd((x) => (x.type === 'media' ? { ...x, [k]: e.target.checked } : x))} />{k[0]!.toUpperCase() + k.slice(1)}</label>)}
        </section>
      )}
      {one?.type === 'equation' && (
        <section className="sect">
          <h4>Equation (LaTeX)</h4>
          <textarea className="input" rows={4} style={{ fontFamily: 'var(--font-mono)' }} value={one.latex} onChange={(e) => upd((x) => (x.type === 'equation' ? { ...x, latex: e.target.value.slice(0, 4000) } : x), `latex:${one.id}`)} onKeyDown={(e) => e.stopPropagation()} />
          <div className="row"><ColorPicker label="Colour" value={one.color} palette={palette} onChange={(c) => upd((x) => (x.type === 'equation' ? { ...x, color: c } : x))} /><NumberField label="Size" suffix="pt" min={6} max={400} value={one.size} onChange={(v) => upd((x) => (x.type === 'equation' ? { ...x, size: v } : x))} /></div>
        </section>
      )}
      {one?.type === 'raw' && (
        <section className="sect"><h4>Preserved object</h4><p style={{ margin: 0, color: 'var(--muted)' }}>{one.reason}. DECK keeps this object’s position and re-exports it when it is self-contained, but cannot edit it.</p></section>
      )}
      {one && <LinkSection store={store} el={one} pres={pres} slide={slide} />}
    </>
  );
}

function FillStroke({ store, sel, palette }: { store: EditorStore; sel: Extract<SlideElement, { type: 'shape' | 'text' }>[]; palette: string[] }) {
  const f = sel[0]!;
  const upd = (fn: (e: Extract<SlideElement, { type: 'shape' | 'text' }>) => SlideElement) => store.updateElements(sel.map((s) => s.id), (e) => (e.type === 'shape' || e.type === 'text' ? fn(e) : e));
  return (
    <section className="sect">
      <h4>Fill</h4>
      <div className="seg">
        {(['none', 'solid', 'linear', 'radial'] as const).map((k) => (
          <button key={k} className={`btn ${f.fill.kind === k ? 'on' : ''}`} onClick={() => upd((e) => ({ ...e, fill: k === 'none' ? { kind: 'none' } : k === 'solid' ? { kind: 'solid', color: palette[0]! } : { kind: k, angle: 135, stops: [{ offset: 0, color: palette[0]! }, { offset: 1, color: palette[1]! }] } as Fill }))}>{k === 'linear' ? 'Linear' : k[0]!.toUpperCase() + k.slice(1)}</button>
        ))}
      </div>
      {f.fill.kind === 'solid' && <div className="row"><ColorPicker label="Fill" value={f.fill.color} palette={palette} onChange={(c) => upd((e) => ({ ...e, fill: { kind: 'solid', color: c } }))} /><span className="label">{f.fill.color}</span></div>}
      {f.fill.kind === 'linear' && <GradientEditor fill={f.fill} palette={palette} onChange={(fl) => upd((e) => ({ ...e, fill: fl }))} />}
      {f.fill.kind === 'radial' && <div className="row">{f.fill.stops.map((s, i) => <ColorPicker key={i} label={`Stop ${i + 1}`} value={s.color} palette={palette} onChange={(c) => upd((e) => (e.fill.kind === 'radial' ? { ...e, fill: { ...e.fill, stops: e.fill.stops.map((x, j) => (j === i ? { ...x, color: c } : x)) } } : e))} />)}</div>}
      <h4>Border</h4>
      <div className="row">
        <label className="row"><input type="checkbox" checked={Boolean(f.stroke)} onChange={(e) => upd((x) => ({ ...x, stroke: e.target.checked ? { color: palette[4]!, width: 3, dash: 'solid' } : null }))} />Border</label>
        {f.stroke && <ColorPicker label="Border colour" value={f.stroke.color} palette={palette} onChange={(c) => upd((x) => ({ ...x, stroke: x.stroke && { ...x.stroke, color: c } }))} />}
      </div>
      {f.stroke && (
        <div className="grid2">
          <NumberField label="Width" min={0.5} max={100} value={f.stroke.width} onChange={(v) => upd((x) => ({ ...x, stroke: x.stroke && { ...x.stroke, width: v } }))} />
          <label className="field"><span>Style</span><select className="select" value={f.stroke.dash} onChange={(e) => upd((x) => ({ ...x, stroke: x.stroke && { ...x.stroke, dash: e.target.value as 'solid' } }))}><option>solid</option><option>dash</option><option>dot</option></select></label>
        </div>
      )}
      {f.type === 'shape' && (
        <label className="row"><input type="checkbox" checked={Boolean(f.shadow)} onChange={(e) => upd((x) => (x.type === 'shape' ? { ...x, shadow: e.target.checked ? { x: 0, y: 12, blur: 32, color: '#00000066' } : null } : x))} />Drop shadow</label>
      )}
    </section>
  );
}

function TextSection({ store, el, palette }: { store: EditorStore; el: Extract<SlideElement, { type: 'shape' | 'text' }>; palette: string[] }) {
  const st = el.style;
  const set = (p: Partial<typeof st>, key?: string) => store.updateElements([el.id], (e) => (e.type === 'text' || e.type === 'shape' ? { ...e, style: { ...e.style, ...p } } : e), key);
  return (
    <section className="sect">
      <h4>Text</h4>
      <div className="grid2">
        <label className="field"><span>Font</span><select className="select" value={st.font} onChange={(e) => set({ font: e.target.value })}>{[...new Set([st.font, ...FONT_FAMILIES])].map((f) => <option key={f} value={f}>{f.replace(' Variable', '')}</option>)}</select></label>
        <NumberField label="Size" suffix="pt" min={4} max={800} value={st.size} onChange={(v) => set({ size: v })} />
        <NumberField label="Line height" step={0.05} min={0.6} max={4} value={st.lineHeight} onChange={(v) => set({ lineHeight: v })} />
        <NumberField label="Letter spacing" suffix="em" step={0.01} min={-0.2} max={1} value={st.letterSpacing} onChange={(v) => set({ letterSpacing: v })} />
        <NumberField label="Padding" min={0} max={400} value={st.padding} onChange={(v) => set({ padding: v })} />
        <label className="field"><span>Effect</span><select className="select" value={st.effect ?? 'none'} onChange={(e) => set({ effect: e.target.value as 'none' })}><option value="none">None</option><option value="shadow">Shadow</option><option value="outline">Outline</option><option value="glow">Glow</option></select></label>
      </div>
      <div className="row">
        <ColorPicker label="Text colour" value={st.color} palette={palette} onChange={(c) => set({ color: c })} />
        <div className="seg">{(['top', 'middle', 'bottom'] as const).map((v) => <button key={v} className={`btn icon ${st.valign === v ? 'on' : ''}`} aria-label={`Vertical ${v}`} onClick={() => set({ valign: v })}><Icon name={v === 'top' ? 'aTop' : v === 'middle' ? 'aMiddle' : 'aBottom'} /></button>)}</div>
      </div>
      <label className="row"><input type="checkbox" checked={st.autofit === 'shrink'} onChange={(e) => set({ autofit: e.target.checked ? 'shrink' : 'none' })} />Shrink text to fit</label>
    </section>
  );
}

function ImageSection({ store, el, palette }: { store: EditorStore; el: Extract<SlideElement, { type: 'image' }>; palette: string[] }) {
  const upd = (p: Partial<typeof el>, key?: string) => store.updateElements([el.id], (e) => (e.type === 'image' ? { ...e, ...p } : e), key);
  return (
    <section className="sect">
      <h4>Image</h4>
      <label className="field"><span>Alternative text (for screen readers)</span><textarea className="input" rows={2} value={el.alt} onChange={(e) => upd({ alt: e.target.value.slice(0, 1000) }, `alt:${el.id}`)} onKeyDown={(e) => e.stopPropagation()} /></label>
      <div className="seg">{(['none', 'rounded', 'circle'] as const).map((m) => <button key={m} className={`btn ${el.mask === m ? 'on' : ''}`} onClick={() => upd({ mask: m })}>{m === 'none' ? 'No mask' : m}</button>)}</div>
      <div className="label">Crop</div>
      <div className="grid2">
        {(['left', 'right', 'top', 'bottom'] as const).map((k) => <NumberField key={k} label={k} suffix="%" min={0} max={90} value={Math.round(el.crop[k] * 100)} onChange={(v) => upd({ crop: { ...el.crop, [k]: v / 100 } })} />)}
      </div>
      <div className="row">
        <label className="row"><input type="checkbox" checked={Boolean(el.stroke)} onChange={(e) => upd({ stroke: e.target.checked ? { color: palette[4]!, width: 4, dash: 'solid' } : null })} />Border</label>
        {el.stroke && <ColorPicker label="Border" value={el.stroke.color} palette={palette} onChange={(c) => upd({ stroke: { ...el.stroke!, color: c } })} />}
        <span className="spacer" />
        <button className="btn ghost-strong" onClick={async () => {
          const [f] = await pickFiles('image/*');
          if (!f) return;
          try {
            const a = await addFile(store.deck, f);
            store.update((p) => ({ ...p, assets: { ...p.assets, [a.meta.id]: a.meta } }));
            upd({ src: a.src, crop: { left: 0, top: 0, right: 0, bottom: 0 }, h: el.w * (a.height / a.width) });
          } catch (e) { toast((e as Error).message); }
        }}>Replace…</button>
      </div>
    </section>
  );
}

function LineSection({ store, el, palette }: { store: EditorStore; el: Extract<SlideElement, { type: 'line' }>; palette: string[] }) {
  const upd = (p: Partial<typeof el>) => store.updateElements([el.id], (e) => (e.type === 'line' ? { ...e, ...p } : e));
  return (
    <section className="sect">
      <h4>Line</h4>
      <div className="row"><ColorPicker label="Colour" value={el.stroke.color} palette={palette} onChange={(c) => upd({ stroke: { ...el.stroke, color: c } })} /><NumberField label="Width" min={0.5} max={60} value={el.stroke.width} onChange={(v) => upd({ stroke: { ...el.stroke, width: v } })} /></div>
      <div className="seg">{(['solid', 'dash', 'dot'] as const).map((d) => <button key={d} className={`btn ${el.stroke.dash === d ? 'on' : ''}`} onClick={() => upd({ stroke: { ...el.stroke, dash: d } })}>{d}</button>)}</div>
      <div className="seg">{(['straight', 'elbow', 'curved'] as const).map((d) => <button key={d} className={`btn ${el.curve === d ? 'on' : ''}`} onClick={() => upd({ curve: d })}>{d}</button>)}</div>
      <div className="grid2">
        <label className="field"><span>Start</span><select className="select" value={el.startArrow} onChange={(e) => upd({ startArrow: e.target.value as 'none' })}><option>none</option><option>arrow</option><option>dot</option></select></label>
        <label className="field"><span>End</span><select className="select" value={el.endArrow} onChange={(e) => upd({ endArrow: e.target.value as 'none' })}><option>none</option><option>arrow</option><option>dot</option></select></label>
      </div>
      {(el.from || el.to) && <p style={{ margin: 0, color: 'var(--muted)', fontSize: 12 }}>Connected — the line follows the attached objects. Drag an endpoint off an object to detach it.</p>}
    </section>
  );
}

function TableSection({ store, el, palette }: { store: EditorStore; el: TableElement; palette: string[] }) {
  const upd = (fn: (t: TableElement) => TableElement) => store.updateElements([el.id], (e) => (e.type === 'table' ? fn(e) : e));
  const cols = el.rows[0]?.length ?? 0;
  return (
    <section className="sect">
      <h4>Table <span className="pill">{el.rows.length} × {cols}</span></h4>
      <div className="grid2">
        <button className="btn ghost-strong" onClick={() => upd((t) => ({ ...t, rows: [...t.rows, Array.from({ length: cols }, () => ({ text: '' }))], h: t.h + t.h / t.rows.length }))}>+ Row</button>
        <button className="btn ghost-strong" disabled={el.rows.length < 2} onClick={() => upd((t) => ({ ...t, rows: t.rows.slice(0, -1), h: t.h - t.h / t.rows.length }))}>− Row</button>
        <button className="btn ghost-strong" onClick={() => upd((t) => ({ ...t, rows: t.rows.map((r) => [...r, { text: '' }]), colWidths: [...t.colWidths.map((w) => (w * cols) / (cols + 1)), 1 / (cols + 1)] }))}>+ Column</button>
        <button className="btn ghost-strong" disabled={cols < 2} onClick={() => upd((t) => { const w = t.colWidths.slice(0, -1); const s = w.reduce((a, b) => a + b, 0); return { ...t, rows: t.rows.map((r) => r.slice(0, -1)), colWidths: w.map((x) => x / s) }; })}>− Column</button>
      </div>
      <label className="row"><input type="checkbox" checked={el.headerRow} onChange={(e) => upd((t) => ({ ...t, headerRow: e.target.checked }))} />Header row</label>
      <label className="row"><input type="checkbox" checked={el.bandedRows} onChange={(e) => upd((t) => ({ ...t, bandedRows: e.target.checked }))} />Banded rows</label>
      <div className="row">
        <ColorPicker label="Header fill" value={el.style.headerFill} palette={palette} onChange={(c) => upd((t) => ({ ...t, style: { ...t.style, headerFill: c } }))} />
        <ColorPicker label="Band fill" value={el.style.bandFill} palette={palette} onChange={(c) => upd((t) => ({ ...t, style: { ...t.style, bandFill: c } }))} />
        <ColorPicker label="Text" value={el.style.color} palette={palette} onChange={(c) => upd((t) => ({ ...t, style: { ...t.style, color: c } }))} />
        <ColorPicker label="Borders" value={el.style.border} palette={palette} onChange={(c) => upd((t) => ({ ...t, style: { ...t.style, border: c } }))} />
      </div>
      <NumberField label="Font size" suffix="pt" min={6} max={120} value={el.style.size} onChange={(v) => upd((t) => ({ ...t, style: { ...t.style, size: v } }))} />
      <p style={{ margin: 0, color: 'var(--muted)', fontSize: 12 }}>Double-click a cell to edit. Tab moves to the next cell; Tab in the last cell adds a row.</p>
    </section>
  );
}

function ChartSection({ store, el }: { store: EditorStore; el: ChartElement }) {
  const upd = (fn: (c: ChartElement) => ChartElement, key?: string) => store.updateElements([el.id], (e) => (e.type === 'chart' ? fn(e) : e), key);
  const [paste, setPaste] = useState('');
  return (
    <section className="sect">
      <h4>Chart</h4>
      <div className="grid4">
        {(['column', 'bar', 'line', 'area', 'pie', 'donut', 'scatter'] as const).map((k) => <button key={k} className={`btn ${el.chart === k ? 'on' : ''}`} style={{ justifyContent: 'center', fontSize: 11 }} onClick={() => upd((c) => ({ ...c, chart: k }))}>{k}</button>)}
      </div>
      <label className="field"><span>Title</span><input className="input" value={el.title} onChange={(e) => upd((c) => ({ ...c, title: e.target.value.slice(0, 200) }), `title:${el.id}`)} onKeyDown={(e) => e.stopPropagation()} /></label>
      <div className="row"><label className="row"><input type="checkbox" checked={el.legend} onChange={(e) => upd((c) => ({ ...c, legend: e.target.checked }))} />Legend</label><label className="row"><input type="checkbox" checked={el.dataLabels} onChange={(e) => upd((c) => ({ ...c, dataLabels: e.target.checked }))} />Data labels</label></div>
      <div className="label">Data</div>
      <div style={{ overflow: 'auto', maxHeight: 260, borderRadius: 6, boxShadow: 'inset 0 0 0 1px var(--line)' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }} onKeyDown={(e) => e.stopPropagation()}>
          <thead>
            <tr>
              <th />
              {el.series.map((s, si) => (
                <th key={si}><input className="input" style={{ height: 26, fontWeight: 600 }} aria-label={`Series ${si + 1} name`} value={s.name} onChange={(e) => upd((c) => ({ ...c, series: c.series.map((x, j) => (j === si ? { ...x, name: e.target.value } : x)) }), `cs:${el.id}`)} /></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {el.categories.map((cat, ci) => (
              <tr key={ci}>
                <td><input className="input" style={{ height: 26 }} aria-label={`Category ${ci + 1}`} value={cat} onChange={(e) => upd((c) => ({ ...c, categories: c.categories.map((x, j) => (j === ci ? e.target.value : x)) }), `cc:${el.id}`)} /></td>
                {el.series.map((s, si) => (
                  <td key={si}><input className="input num" style={{ height: 26 }} aria-label={`${s.name} ${cat}`} defaultValue={s.values[ci] ?? 0} key={`${s.values[ci]}`} onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) upd((c) => ({ ...c, series: c.series.map((x, j) => (j === si ? { ...x, values: c.categories.map((_, k) => (k === ci ? v : x.values[k] ?? 0)) } : x)) })); }} /></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid2">
        <button className="btn ghost-strong" onClick={() => upd((c) => ({ ...c, categories: [...c.categories, `Item ${c.categories.length + 1}`], series: c.series.map((s) => ({ ...s, values: [...s.values, 0] })) }))}>+ Category</button>
        <button className="btn ghost-strong" onClick={() => upd((c) => ({ ...c, series: [...c.series, { name: `Series ${c.series.length + 1}`, values: c.categories.map(() => 0) }] }))}>+ Series</button>
        <button className="btn ghost-strong" disabled={el.categories.length < 2} onClick={() => upd((c) => ({ ...c, categories: c.categories.slice(0, -1), series: c.series.map((s) => ({ ...s, values: s.values.slice(0, -1) })) }))}>− Category</button>
        <button className="btn ghost-strong" disabled={el.series.length < 2} onClick={() => upd((c) => ({ ...c, series: c.series.slice(0, -1) }))}>− Series</button>
      </div>
      <label className="field"><span>Paste data (tab- or comma-separated, first row = series names)</span>
        <textarea className="input" rows={3} value={paste} onChange={(e) => setPaste(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder={'\tSales\tCost\nQ1\t4\t3'} />
      </label>
      <button className="btn ghost-strong" disabled={!paste.trim()} onClick={() => {
        const rows = paste.trim().split(/\r?\n/).map((r) => r.split(/\t|,/));
        if (rows.length < 2) return toast('Need a header row and at least one data row');
        const names = rows[0]!.slice(1);
        const data = rows.slice(1, 201);
        upd((c) => ({ ...c, categories: data.map((r) => r[0] ?? ''), series: names.map((n, i) => ({ name: n.trim() || `Series ${i + 1}`, values: data.map((r) => Number(r[i + 1]) || 0) })) }));
        setPaste('');
      }}>Replace data</button>
    </section>
  );
}

function LinkSection({ store, el, pres, slide }: { store: EditorStore; el: SlideElement; pres: Presentation; slide: Slide }) {
  const [url, setUrl] = useState(el.link?.kind === 'url' ? el.link.url : '');
  return (
    <section className="sect">
      <h4>Link</h4>
      <div className="seg">
        {(['none', 'url', 'slide'] as const).map((k) => <button key={k} className={`btn ${(el.link?.kind ?? 'none') === k ? 'on' : ''}`} onClick={() => store.updateElements([el.id], (e) => ({ ...e, link: k === 'none' ? undefined : k === 'url' ? { kind: 'url', url: url || 'https://' } : { kind: 'slide', slideId: pres.slides.find((s) => s.id !== slide.id)?.id ?? slide.id } }))}>{k === 'none' ? 'None' : k === 'url' ? 'Web page' : 'Slide'}</button>)}
      </div>
      {el.link?.kind === 'url' && (
        <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.stopPropagation()} onBlur={() => {
          const s = safeHref(url);
          if (!s) return toast('Only http, https and mailto links are allowed');
          store.updateElements([el.id], (e) => ({ ...e, link: { kind: 'url', url: s } }));
        }} />
      )}
      {el.link?.kind === 'slide' && (
        <select className="select" value={el.link.slideId} onChange={(e) => store.updateElements([el.id], (x) => ({ ...x, link: { kind: 'slide', slideId: e.target.value } }))}>
          {pres.slides.map((s, i) => <option key={s.id} value={s.id}>{i + 1}. {slideTitle(s)}</option>)}
        </select>
      )}
    </section>
  );
}

/* ───────────── animate ───────────── */

function AnimatePanel({ store, pres, slide, sel, animId }: { store: EditorStore; pres: Presentation; slide: Slide; sel: SlideElement[]; animId: string | null }) {
  const anims = slide.animations;
  const cur = anims.find((a) => a.id === animId);
  const setAnims = (fn: (a: Animation[]) => Animation[], key?: string) => store.updateSlide(slide.id, (s) => ({ ...s, animations: fn(s.animations) }), key);
  const updAnim = (patch: Partial<Animation>, key?: string) => cur && setAnims((list) => list.map((a) => (a.id === cur.id ? { ...a, ...patch } : a)), key);
  const add = (cls: Animation['class'], effect: Animation['effect']) => {
    if (!sel.length) return toast('Select an object to animate');
    const created = sel.map((e, i) => createAnimation(e.id, { class: cls, effect, trigger: i === 0 ? 'click' : 'with', direction: cls === 'exit' ? 'down' : 'up', path: cls === 'motion' ? [{ x: 0, y: 0 }, { x: Math.min(400, pres.width - e.x - e.w), y: 0 }] : undefined }));
    setAnims((a) => [...a, ...created]);
    store.setUi({ animId: created[0]!.id });
  };
  const name = (id: string) => slide.elements.find((e) => e.id === id)?.name ?? 'Missing';
  return (
    <>
      <section className="sect">
        <h4>Add animation {sel.length ? <span className="pill">{sel.length === 1 ? sel[0]!.name : `${sel.length} objects`}</span> : null}</h4>
        {(['entrance', 'emphasis', 'exit', 'motion'] as const).map((cls) => (
          <div key={cls}>
            <div className="label" style={{ marginBottom: 6 }}>{cls === 'motion' ? 'Motion path' : cls[0]!.toUpperCase() + cls.slice(1)}</div>
            <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
              {EFFECTS_BY_CLASS[cls].map((fx) => <button key={fx} className="btn ghost-strong" style={{ height: 26 }} disabled={!sel.length} onClick={() => add(cls, fx)}>{fx}</button>)}
            </div>
          </div>
        ))}
      </section>
      <section className="sect">
        <h4>Build order <span className="row" style={{ gap: 2 }}><button className="btn" disabled={!anims.length} onClick={() => previewSlideAnimations(store, slide.id)}><Icon name="play" />Preview</button></span></h4>
        {!anims.length && <p style={{ margin: 0, color: 'var(--muted)' }}>No animations on this slide. Select an object and choose an effect above.</p>}
        {anims.map((a, i) => (
          <div key={a.id} className={`anim-item ${a.id === animId ? 'on' : ''}`} onClick={() => { store.setUi({ animId: a.id, selection: [a.elementId] }); }} role="button" tabIndex={0}>
            <span className="ix">{a.trigger === 'click' ? anims.slice(0, i + 1).filter((x) => x.trigger === 'click').length : a.trigger === 'with' ? '+' : '→'}</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><b style={{ fontWeight: 600 }}>{a.effect}</b> · {name(a.elementId)}</span>
            <span className="row" style={{ gap: 0 }}>
              <button className="btn icon" aria-label="Move up" disabled={i === 0} onClick={(e) => { e.stopPropagation(); setAnims((l) => { const n = [...l]; [n[i - 1], n[i]] = [n[i]!, n[i - 1]!]; return n; }); }}><Icon name="chevron" style={{ transform: 'rotate(180deg)' }} /></button>
              <button className="btn icon" aria-label="Move down" disabled={i === anims.length - 1} onClick={(e) => { e.stopPropagation(); setAnims((l) => { const n = [...l]; [n[i + 1], n[i]] = [n[i]!, n[i + 1]!]; return n; }); }}><Icon name="chevron" /></button>
              <button className="btn icon" aria-label="Remove animation" onClick={(e) => { e.stopPropagation(); setAnims((l) => l.filter((x) => x.id !== a.id)); }}><Icon name="close" /></button>
            </span>
          </div>
        ))}
      </section>
      {cur && (
        <section className="sect">
          <h4>Effect options</h4>
          <div className="grid2">
            <label className="field"><span>Effect</span><select className="select" value={cur.effect} onChange={(e) => updAnim({ effect: e.target.value as Animation['effect'] })}>{EFFECTS_BY_CLASS[cur.class].map((f) => <option key={f}>{f}</option>)}</select></label>
            <label className="field"><span>Start</span><select className="select" value={cur.trigger} onChange={(e) => updAnim({ trigger: e.target.value as Animation['trigger'] })}><option value="click">On click</option><option value="with">With previous</option><option value="after">After previous</option></select></label>
            <NumberField label="Duration" suffix="ms" step={50} min={50} max={20000} value={cur.duration} onChange={(v) => updAnim({ duration: v }, 'dur')} />
            <NumberField label="Delay" suffix="ms" step={50} min={0} max={60000} value={cur.delay} onChange={(v) => updAnim({ delay: v }, 'delay')} />
            <label className="field"><span>Direction</span><select className="select" value={cur.direction} onChange={(e) => updAnim({ direction: e.target.value as Animation['direction'] })}>{['up', 'down', 'left', 'right'].map((d) => <option key={d}>{d}</option>)}</select></label>
            <label className="field"><span>Easing</span><select className="select" value={cur.easing} onChange={(e) => updAnim({ easing: e.target.value as Animation['easing'] })}>{['ease-out', 'ease', 'ease-in', 'linear', 'spring'].map((d) => <option key={d}>{d}</option>)}</select></label>
          </div>
          {cur.trigger === 'click' && (
            <label className="field"><span>Trigger (click on object instead of advancing)</span>
              <select className="select" value={cur.triggerElementId ?? ''} onChange={(e) => updAnim({ triggerElementId: e.target.value || undefined })}>
                <option value="">Next click anywhere</option>
                {slide.elements.filter((e) => e.id !== cur.elementId).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </label>
          )}
          {cur.class === 'motion' && (
            <div className="field"><span>Path</span>
              <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
                {([['Right', [{ x: 0, y: 0 }, { x: 400, y: 0 }]], ['Down', [{ x: 0, y: 0 }, { x: 0, y: 300 }]], ['Arc', Array.from({ length: 9 }, (_, i) => ({ x: i * 60, y: -Math.sin((i / 8) * Math.PI) * 220 }))], ['Loop', Array.from({ length: 17 }, (_, i) => ({ x: Math.sin((i / 16) * Math.PI * 2) * 160, y: (1 - Math.cos((i / 16) * Math.PI * 2)) * -160 }))], ['Zig-zag', [{ x: 0, y: 0 }, { x: 120, y: -80 }, { x: 240, y: 0 }, { x: 360, y: -80 }, { x: 480, y: 0 }]]] as const).map(([n, p]) => (
                  <button key={n} className="btn ghost-strong" style={{ height: 26 }} onClick={() => updAnim({ path: p.map((x) => ({ ...x })) })}>{n}</button>
                ))}
              </div>
            </div>
          )}
        </section>
      )}
    </>
  );
}

/* ───────────── review ───────────── */

function ReviewPanel({ store, pres }: { store: EditorStore; pres: Presentation }) {
  const issues = useMemo(() => pres.slides.flatMap((s, i) => analyzeSlide(s, pres).map((x) => ({ ...x, n: i + 1 }))), [pres]);
  const report = pres.importReport;
  return (
    <>
      <section className="sect">
        <h4>Assistant <span className="tag-ai">AI · optional</span></h4>
        <p style={{ margin: 0, color: 'var(--muted)' }}>Generate outlines, rewrite text, draft speaker notes and get layout suggestions. Nothing is sent anywhere until you choose a provider and confirm.</p>
        <button className="btn primary" onClick={() => store.setUi({ dialog: 'ai' })}><Icon name="sparkle" />Open assistant</button>
      </section>
      <section className="sect">
        <h4>Checks <span className="pill">{issues.length}</span></h4>
        {!issues.length && <p style={{ margin: 0, color: 'var(--muted)' }}><Icon name="check" /> No readability or layout issues found.</p>}
        {issues.slice(0, 200).map((x, i) => (
          <div key={i} className={`issue ${x.severity}`} role="button" tabIndex={0} onClick={() => { store.goToSlide(x.slideId); if (x.elementId) store.select([x.elementId]); }}>
            <Icon name={x.severity === 'warn' ? 'warn' : 'info'} />
            <span><b>Slide {x.n}.</b> {x.message}</span>
          </div>
        ))}
      </section>
      {report && (
        <section className="sect">
          <h4>Import report <span className="pill">{report.warnings.length}</span></h4>
          <p style={{ margin: 0, color: 'var(--muted)' }}>From <b>{report.source}</b>. Everything DECK could not represent exactly is listed here — nothing is dropped silently.</p>
          <button className="btn ghost-strong" onClick={() => store.setUi({ dialog: 'import-report' })}>View full report</button>
        </section>
      )}
      <section className="sect">
        <h4>Layout masters</h4>
        <p style={{ margin: 0, color: 'var(--muted)' }}>Re-apply each slide’s layout to restore placeholder positions after heavy editing.</p>
        <button className="btn ghost-strong" onClick={() => store.update((p) => ({ ...p, slides: p.slides.map((s) => (layoutById(s.layout).id === 'blank' ? s : applyLayout(s, s.layout, p))) }))}>Reset all placeholders</button>
      </section>
    </>
  );
}
