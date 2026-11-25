import { buildSteps } from '@deck/core';
import { useEditor, type EditorStore } from '../lib/store';
import { Icon } from './icons';
import { previewSlideAnimations } from '../present/engine';

const PX_PER_MS = 0.12;

export function Bottom({ store }: { store: EditorStore }) {
  const { pres, ui } = useEditor(store, (s) => s);
  const slide = pres.slides.find((s) => s.id === ui.slideId);
  if (!slide) return <div className="bottom" />;
  return (
    <div className="bottom">
      <div className="bottom-tabs">
        <button className={`btn ${ui.bottom === 'notes' ? 'on' : ''}`} onClick={() => store.setUi({ bottom: ui.bottom === 'notes' ? null : 'notes' })}>Speaker notes</button>
        <button className={`btn ${ui.bottom === 'timeline' ? 'on' : ''}`} onClick={() => store.setUi({ bottom: ui.bottom === 'timeline' ? null : 'timeline' })}>Animation timeline {slide.animations.length ? <span className="pill">{slide.animations.length}</span> : null}</button>
        <span className="spacer" />
        {ui.bottom === 'timeline' && <button className="btn" disabled={!slide.animations.length} onClick={() => previewSlideAnimations(store, slide.id)}><Icon name="play" />Play</button>}
        {ui.bottom && <button className="btn icon" aria-label="Collapse" onClick={() => store.setUi({ bottom: null })}><Icon name="chevron" /></button>}
      </div>
      {ui.bottom === 'notes' && (
        <textarea
          className="notes"
          aria-label="Speaker notes"
          placeholder="Speaker notes — visible only to you in presenter view"
          value={slide.notes}
          onChange={(e) => store.updateSlide(slide.id, (s) => ({ ...s, notes: e.target.value.slice(0, 50000) }), `notes:${slide.id}`)}
          onKeyDown={(e) => e.stopPropagation()}
        />
      )}
      {ui.bottom === 'timeline' && <Timeline store={store} />}
    </div>
  );
}

function Timeline({ store }: { store: EditorStore }) {
  const { pres, ui } = useEditor(store, (s) => s);
  const slide = pres.slides.find((s) => s.id === ui.slideId)!;
  const { auto, steps } = buildSteps(slide);
  const all = [...(auto ? [{ s: auto, label: 'Auto' }] : []), ...steps.map((s, i) => ({ s, label: s.triggerElementId ? `Trigger` : `Click ${i + 1}` }))];
  let offset = 0;
  const placed = all.map(({ s, label }) => {
    const base = offset;
    offset += s.duration + 400;
    return { s, label, base };
  });
  const name = (id: string) => slide.elements.find((e) => e.id === id)?.name ?? '—';
  const drag = (animId: string, mode: 'move' | 'resize', e: React.PointerEvent) => {
    e.stopPropagation();
    const a = slide.animations.find((x) => x.id === animId)!;
    const x0 = e.clientX;
    store.setUi({ animId, selection: [a.elementId] });
    const move = (ev: PointerEvent) => {
      const d = Math.round((ev.clientX - x0) / PX_PER_MS / 50) * 50;
      store.updateSlide(slide.id, (s) => ({ ...s, animations: s.animations.map((x) => (x.id !== animId ? x : mode === 'move' ? { ...x, delay: Math.max(0, a.delay + d) } : { ...x, duration: Math.max(50, a.duration + d) })) }), `tl:${animId}`);
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  if (!slide.animations.length) return <div className="timeline"><div className="empty-state" style={{ height: '100%' }}>Add animations from the Animate tab to sequence them here.</div></div>;
  return (
    <div className="timeline" role="list" aria-label="Animation timeline">
      <div style={{ position: 'relative', minWidth: 170 + offset * PX_PER_MS + 40 }}>
        {placed.flatMap(({ s, label, base }) =>
          s.items.map((it, j) => (
            <div key={it.anim.id} className="tl-row" role="listitem">
              <div className="name">{j === 0 ? <b style={{ color: 'var(--accent)', fontWeight: 600 }}>{label} · </b> : null}{name(it.anim.elementId)}</div>
              <div className="tl-track">
                <div
                  className={`tl-bar ${it.anim.class} ${ui.animId === it.anim.id ? 'on' : ''}`}
                  style={{ left: (base + it.start) * PX_PER_MS, width: Math.max(14, it.anim.duration * PX_PER_MS) }}
                  title={`${it.anim.effect} · delay ${it.anim.delay}ms · ${it.anim.duration}ms — drag to change delay, drag the right edge to change duration`}
                  onPointerDown={(e) => drag(it.anim.id, (e.nativeEvent.offsetX > (e.currentTarget.clientWidth - 8)) ? 'resize' : 'move', e)}
                >
                  {it.anim.effect}
                </div>
              </div>
            </div>
          )),
        )}
        {placed.map(({ base }, i) => <div key={i} className="tl-step" style={{ left: 170 + base * PX_PER_MS }} />)}
      </div>
    </div>
  );
}
