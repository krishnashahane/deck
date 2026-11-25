import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { para, type Slide } from '@deck/core';
import { useEditor, type EditorStore } from '../lib/store';
import { SlideView, slideTitle } from '../render/SlideView';
import { Icon } from './icons';
import { MenuItem, Popover } from './ui';
import { addSection, addSlide, deleteSlides, duplicateSlides, moveSlides, toggleHidden } from './actions';
import { LAYOUTS } from '@deck/core';

const THUMB_W = 176;
const HEAD_H = 30;
const GAP = 10;

export function Rail({ store }: { store: EditorStore }) {
  const { pres, ui } = useEditor(store, (s) => s);
  const listRef = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState({ top: 0, h: 800 });
  const [dragIds, setDragIds] = useState<string[] | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const thumbH = (THUMB_W * pres.height) / pres.width;
  const itemH = thumbH + GAP;

  // Layout positions for windowed rendering of hundreds of slides.
  const layout = useMemo(() => {
    let y = 4;
    return pres.slides.map((s) => {
      const head = s.section !== undefined ? HEAD_H : 0;
      const top = y + head;
      y = top + itemH;
      return { s, headTop: y - itemH - head, top, head };
    });
  }, [pres.slides, itemH]);
  const total = (layout[layout.length - 1]?.top ?? 0) + itemH + 40;

  useLayoutEffect(() => {
    const el = listRef.current!;
    const ro = new ResizeObserver(() => setScroll((s) => ({ ...s, h: el.clientHeight })));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Keep the current slide in view.
  useLayoutEffect(() => {
    const i = layout.findIndex((l) => l.s.id === ui.slideId);
    const el = listRef.current;
    if (i < 0 || !el) return;
    const { top } = layout[i]!;
    if (top < el.scrollTop) el.scrollTop = top - 8;
    else if (top + itemH > el.scrollTop + el.clientHeight) el.scrollTop = top + itemH - el.clientHeight + 8;
  }, [ui.slideId, layout, itemH]);

  const visible = layout.filter((l) => l.top + itemH >= scroll.top - 300 && l.headTop <= scroll.top + scroll.h + 300);

  const click = (e: React.MouseEvent, s: Slide, i: number) => {
    if (e.shiftKey) {
      const cur = pres.slides.findIndex((x) => x.id === ui.slideId);
      const [a, b] = [Math.min(cur, i), Math.max(cur, i)];
      store.setUi({ slideSelection: pres.slides.slice(a, b + 1).map((x) => x.id) });
      return;
    }
    if (e.metaKey || e.ctrlKey) {
      const set = new Set(ui.slideSelection);
      set.has(s.id) ? set.delete(s.id) : set.add(s.id);
      store.setUi({ slideSelection: [...set] });
      return;
    }
    store.goToSlide(s.id);
  };

  const onDragOver = (e: React.DragEvent) => {
    if (!dragIds) return;
    e.preventDefault();
    const r = listRef.current!.getBoundingClientRect();
    const y = e.clientY - r.top + listRef.current!.scrollTop;
    let idx = layout.findIndex((l) => y < l.top + itemH / 2);
    if (idx < 0) idx = layout.length;
    setDropAt(idx);
  };

  const dropLineY = dropAt === null ? null : dropAt < layout.length ? layout[dropAt]!.top - GAP / 2 - 1 : (layout[layout.length - 1]?.top ?? 0) + itemH - GAP / 2;

  return (
    <nav className="rail" aria-label="Slides">
      <div className="rail-head">
        <div className="seg" style={{ flex: 1 }}>
          <button className={`btn ${ui.railMode === 'slides' ? 'on' : ''}`} onClick={() => store.setUi({ railMode: 'slides' })}><Icon name="grid" />Slides</button>
          <button className={`btn ${ui.railMode === 'outline' ? 'on' : ''}`} onClick={() => store.setUi({ railMode: 'outline' })}><Icon name="list" />Outline</button>
        </div>
        <Popover align="end" width={240} trigger={(open) => <button className="btn icon" aria-label="New slide" title="New slide (⌘⏎)" onClick={open}><Icon name="plus" /></button>}>
          {(close) => (
            <>
              <div className="title">New slide</div>
              {LAYOUTS.map((l) => <MenuItem key={l.id} icon="layout" label={l.name} onClick={() => { addSlide(store, l.id); close(); }} />)}
            </>
          )}
        </Popover>
      </div>
      {ui.railMode === 'outline' ? (
        <Outline store={store} />
      ) : (
        <div className="rail-list" ref={listRef} onScroll={(e) => setScroll({ top: e.currentTarget.scrollTop, h: e.currentTarget.clientHeight })} onDragOver={onDragOver} onDragLeave={() => setDropAt(null)} onDrop={(e) => {
          e.preventDefault();
          if (dragIds && dropAt !== null) moveSlides(store, dragIds, dropAt);
          setDragIds(null);
          setDropAt(null);
        }} role="listbox" aria-multiselectable="true" tabIndex={0}>
          <div style={{ position: 'relative', height: total }}>
            {visible.map(({ s, top, headTop, head }) => {
              const i = pres.slides.indexOf(s);
              const current = s.id === ui.slideId;
              const selected = ui.slideSelection.includes(s.id);
              return (
                <div key={s.id}>
                  {head > 0 && (
                    <div className="section-head" style={{ position: 'absolute', top: headTop, left: 0, right: 0, height: HEAD_H }}>
                      <Icon name="section" size={12} />
                      <input aria-label="Section name" value={s.section} onChange={(e) => store.updateSlide(s.id, (x) => ({ ...x, section: e.target.value }), `sec:${s.id}`)} onKeyDown={(e) => e.stopPropagation()} />
                      <button className="btn icon" style={{ height: 20, width: 20 }} aria-label="Remove section" onClick={() => store.updateSlide(s.id, (x) => ({ ...x, section: undefined }))}><Icon name="close" size={12} /></button>
                    </div>
                  )}
                  <div
                    className={`thumb-item ${current ? 'current' : ''} ${selected ? 'selected' : ''} ${s.hidden ? 'hidden-slide' : ''}`}
                    style={{ position: 'absolute', top, left: 0, right: 0 }}
                    role="option"
                    aria-selected={current || selected}
                    aria-label={`Slide ${i + 1}: ${slideTitle(s)}${s.hidden ? ' (hidden)' : ''}`}
                    draggable
                    onDragStart={(e) => {
                      const ids = selected && ui.slideSelection.length > 1 ? ui.slideSelection : [s.id];
                      setDragIds(ids);
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', `deck-slides:${ids.length}`);
                    }}
                    onDragEnd={() => { setDragIds(null); setDropAt(null); }}
                    onClick={(e) => click(e, s, i)}
                    onContextMenu={(e) => { e.preventDefault(); if (!selected) store.goToSlide(s.id); }}
                  >
                    <span className="num">{i + 1}</span>
                    <div className="frame">
                      <SlideView slide={s} pres={pres} deck={store.deck} width={THUMB_W} lite />
                      <div className="badges">
                        {s.hidden && <span className="badge"><Icon name="eyeOff" size={10} /></span>}
                        {s.animations.length > 0 && <span className="badge" title="Has animations">✦</span>}
                        {s.notes.trim() && <span className="badge" title="Has notes">✎</span>}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            {dropLineY !== null && <div className="drop-line" style={{ top: dropLineY }} />}
          </div>
        </div>
      )}
      <div className="row" style={{ padding: '6px 8px', borderTop: '1px solid var(--line)', gap: 2 }}>
        <button className="btn icon" title="Duplicate slide (⌘D)" aria-label="Duplicate slide" onClick={() => duplicateSlides(store)}><Icon name="copy" /></button>
        <button className="btn icon" title="Hide/show slide" aria-label="Toggle hidden" onClick={() => toggleHidden(store)}><Icon name="eyeOff" /></button>
        <button className="btn icon" title="Add section" aria-label="Add section" onClick={() => addSection(store)}><Icon name="section" /></button>
        <span className="spacer" />
        <span className="label" style={{ fontVariantNumeric: 'tabular-nums' }}>{pres.slides.length} slides</span>
        <button className="btn icon danger" title="Delete slide" aria-label="Delete slide" onClick={() => deleteSlides(store)}><Icon name="trash" /></button>
      </div>
    </nav>
  );
}

/** Outline view: edit every slide's title and body text as plain text, Enter for a new slide. */
function Outline({ store }: { store: EditorStore }) {
  const { pres, ui } = useEditor(store, (s) => s);
  const textOf = (s: Slide, role: 'title' | 'body') => {
    const el = s.elements.find((e) => e.placeholder === role && (e.type === 'text' || e.type === 'shape'));
    return el && (el.type === 'text' || el.type === 'shape') ? el.paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join('\n') : null;
  };
  const setText = (s: Slide, role: 'title' | 'body', value: string) =>
    store.updateSlide(s.id, (sl) => ({
      ...sl,
      elements: sl.elements.map((e) => {
        if (e.placeholder !== role || (e.type !== 'text' && e.type !== 'shape')) return e;
        const proto = e.paragraphs[0] ?? para('');
        return { ...e, paragraphs: value.split('\n').map((l, i) => ({ ...(e.paragraphs[i] ?? proto), runs: [{ ...(e.paragraphs[i]?.runs[0] ?? proto.runs[0] ?? { text: '' }), text: l }] })) };
      }),
    }), `outline:${s.id}:${role}`);
  return (
    <div className="rail-list outline">
      {pres.slides.map((s, i) => {
        const title = textOf(s, 'title');
        const body = textOf(s, 'body');
        return (
          <div key={s.id} className="outline-item" onFocus={() => store.goToSlide(s.id)} style={{ opacity: s.hidden ? 0.5 : 1 }}>
            <span className="label" style={{ color: s.id === ui.slideId ? 'var(--accent)' : undefined }}>{i + 1}</span>
            <div>
              {title !== null ? (
                <textarea className="t" rows={1} aria-label={`Slide ${i + 1} title`} value={title} onChange={(e) => setText(s, 'title', e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addSlide(store, 'title-content', s.id); } }} />
              ) : (
                <div className="label" style={{ padding: '2px 4px' }}>{slideTitle(s)}</div>
              )}
              {body !== null && <textarea rows={Math.max(1, body.split('\n').length)} aria-label={`Slide ${i + 1} body`} value={body} onChange={(e) => setText(s, 'body', e.target.value)} onKeyDown={(e) => e.stopPropagation()} />}
            </div>
          </div>
        );
      })}
      <button className="btn ghost-strong" onClick={() => addSlide(store, 'title-content', pres.slides[pres.slides.length - 1]?.id)}><Icon name="plus" />Add slide</button>
    </div>
  );
}
