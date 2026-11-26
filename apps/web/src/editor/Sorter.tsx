import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor, type EditorStore } from '../lib/store';
import { SlideView, slideTitle } from '../render/SlideView';
import { Icon } from './icons';
import { ContextMenu, tidy } from './ContextMenu';
import { deleteSlides, duplicateSlides, moveSlides, toggleHidden } from './actions';
import { visibleSlides } from '../present/Show';

/**
 * Full-screen slide sorter: see the whole deck at once, select (click, ⇧-click range,
 * ⌘-click toggle), drag to reorder, keyboard to move/duplicate/hide/delete.
 * Thumbnails are only rendered once they scroll into view, so very large decks stay fast.
 */
export function Sorter({ store, onClose, onPlay }: { store: EditorStore; onClose: () => void; onPlay: (visibleIndex: number) => void }) {
  const pres = useEditor(store, (s) => s.pres);
  const current = useEditor(store, (s) => s.ui.slideId);
  const readOnly = useEditor(store, (s) => s.ui.readOnly);
  const [size, setSize] = useState(() => Number(localStorage.getItem('deck.sorter.size')) || 240);
  const [sel, setSel] = useState<string[]>(() => (current ? [current] : []));
  const [anchor, setAnchor] = useState<string | null>(current);
  const [drop, setDrop] = useState<number | null>(null);
  const [dragging, setDragging] = useState<string[] | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState<Set<string>>(new Set());

  useEffect(() => localStorage.setItem('deck.sorter.size', String(size)), [size]);
  useEffect(() => { gridRef.current?.querySelector<HTMLElement>(`[data-id="${current}"]`)?.focus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Lazy thumbnails.
  useEffect(() => {
    const root = gridRef.current;
    if (!root) return;
    const io = new IntersectionObserver((entries) => {
      const add = entries.filter((e) => e.isIntersecting).map((e) => (e.target as HTMLElement).dataset.id!);
      if (add.length) setSeen((s) => new Set([...s, ...add]));
    }, { root, rootMargin: '400px' });
    root.querySelectorAll('[data-id]').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [pres.slides.length, size]);

  const ids = useMemo(() => pres.slides.map((s) => s.id), [pres.slides]);
  const selSet = new Set(sel);
  const h = (size * pres.height) / pres.width;

  const click = (e: React.MouseEvent, id: string) => {
    if (e.shiftKey && anchor) {
      const a = ids.indexOf(anchor), b = ids.indexOf(id);
      setSel(ids.slice(Math.min(a, b), Math.max(a, b) + 1));
    } else if (e.metaKey || e.ctrlKey) {
      setSel(selSet.has(id) ? sel.filter((x) => x !== id) : [...sel, id]);
      setAnchor(id);
    } else {
      setSel([id]);
      setAnchor(id);
    }
  };
  const open = (id: string) => { store.goToSlide(id); store.setUi({ slideSelection: [id] }); onClose(); };
  const target = () => (sel.length ? sel : current ? [current] : []);
  const move = (d: number) => {
    const t = target();
    if (!t.length || readOnly) return;
    const idx = t.map((id) => ids.indexOf(id)).sort((a, b) => a - b);
    const to = d < 0 ? Math.max(0, idx[0]! - 1) : Math.min(ids.length, idx[idx.length - 1]! + 2);
    moveSlides(store, t, to);
  };

  const focusAt = (i: number) => {
    const id = ids[Math.max(0, Math.min(ids.length - 1, i))];
    if (!id) return;
    gridRef.current?.querySelector<HTMLElement>(`[data-id="${id}"]`)?.focus();
    return id;
  };
  const cols = () => {
    const w = gridRef.current?.clientWidth ?? 1000;
    return Math.max(1, Math.floor((w - 48) / (size + 24)));
  };

  const onKey = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    const mod = e.metaKey || e.ctrlKey;
    const focused = (document.activeElement as HTMLElement)?.dataset.id;
    const i = focused ? ids.indexOf(focused) : ids.indexOf(current ?? '');
    const step = (d: number) => {
      e.preventDefault();
      if (mod && !readOnly) { move(Math.sign(d)); return; }
      const id = focusAt(i + d);
      if (!id) return;
      if (e.shiftKey && anchor) { const a = ids.indexOf(anchor), b = ids.indexOf(id); setSel(ids.slice(Math.min(a, b), Math.max(a, b) + 1)); }
      else { setSel([id]); setAnchor(id); }
    };
    if (e.key === 'Escape') { e.preventDefault(); if (menu) setMenu(null); else onClose(); }
    else if (e.key === 'ArrowRight') step(1);
    else if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowDown') step(cols());
    else if (e.key === 'ArrowUp') step(-cols());
    else if (e.key === 'Home') step(-i);
    else if (e.key === 'End') step(ids.length - 1 - i);
    else if (e.key === 'Enter' && focused) { e.preventDefault(); open(focused); }
    else if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); setSel(ids); }
    else if (readOnly) return;
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSlides(store, target()); setSel([]); }
    else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSlides(store, target()); }
    else if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? store.redo() : store.undo(); }
    else if (e.key.toLowerCase() === 'h' && !mod) { e.preventDefault(); toggleHidden(store, target()); }
  };

  // Drag & drop reorder: the insertion point is before/after the card under the pointer.
  const onDragOver = (e: React.DragEvent, index: number) => {
    if (!dragging) return;
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setDrop(e.clientX < r.left + r.width / 2 ? index : index + 1);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (dragging && drop !== null) moveSlides(store, dragging, drop);
    setDragging(null);
    setDrop(null);
  };

  const hiddenCount = pres.slides.filter((s) => s.hidden).length;
  return (
    <div className="sorter" role="dialog" aria-modal="true" aria-label="Slide sorter" onKeyDown={onKey}>
      <header className="sorter-head">
        <h2>Slide sorter</h2>
        <span className="label">{pres.slides.length} slides{hiddenCount ? ` · ${hiddenCount} hidden` : ''}{sel.length > 1 ? ` · ${sel.length} selected` : ''}</span>
        <span className="spacer" />
        {!readOnly && (
          <>
            <button className="btn" disabled={!sel.length} onClick={() => duplicateSlides(store, target())}><Icon name="copy" />Duplicate</button>
            <button className="btn" disabled={!sel.length} onClick={() => toggleHidden(store, target())}><Icon name="eyeOff" />Hide / show</button>
            <button className="btn danger" disabled={!sel.length} onClick={() => { deleteSlides(store, target()); setSel([]); }}><Icon name="trash" />Delete</button>
            <span className="sep" />
          </>
        )}
        <label className="sorter-zoom">
          <span className="sr-only">Thumbnail size</span>
          <Icon name="grid" />
          <input type="range" min={140} max={440} step={20} value={size} aria-label="Thumbnail size" onChange={(e) => setSize(Number(e.target.value))} />
        </label>
        <button className="btn primary" onClick={onClose}>Done</button>
      </header>
      <div className="sorter-grid" ref={gridRef} role="listbox" aria-multiselectable="true" aria-label="Slides" style={{ gridTemplateColumns: `repeat(auto-fill, ${size}px)` }}
        onDragOver={(e) => dragging && e.preventDefault()} onDrop={onDrop}>
        {pres.slides.map((s, i) => {
          const vis = visibleSlides(pres).findIndex((v) => v.id === s.id);
          return (
            <div key={s.id} className="sorter-cell">
              {s.section && <div className="sorter-section">{s.section}</div>}
              {drop === i && <div className="sorter-drop" aria-hidden />}
              <div
                data-id={s.id}
                role="option"
                aria-selected={selSet.has(s.id)}
                aria-label={`Slide ${i + 1}: ${slideTitle(s) || 'Untitled'}${s.hidden ? ' (hidden)' : ''}`}
                tabIndex={s.id === current ? 0 : -1}
                className={`sorter-card ${selSet.has(s.id) ? 'sel' : ''} ${s.hidden ? 'hidden' : ''} ${dragging?.includes(s.id) ? 'dragging' : ''}`}
                draggable={!readOnly}
                onDragStart={(e) => { const d = selSet.has(s.id) ? sel : [s.id]; if (!selSet.has(s.id)) setSel([s.id]); setDragging(d); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', d.join(',')); }}
                onDragEnd={() => { setDragging(null); setDrop(null); }}
                onDragOver={(e) => onDragOver(e, i)}
                onClick={(e) => click(e, s.id)}
                onDoubleClick={() => open(s.id)}
                onContextMenu={(e) => { e.preventDefault(); if (!selSet.has(s.id)) { setSel([s.id]); setAnchor(s.id); } setMenu({ x: e.clientX, y: e.clientY }); }}
              >
                <div className="sorter-thumb" style={{ width: size, height: h }}>
                  {seen.has(s.id) ? <SlideView slide={s} pres={pres} deck={store.deck} width={size} lite /> : null}
                </div>
                <div className="sorter-meta">
                  <b>{i + 1}</b>
                  <span>{slideTitle(s) || 'Untitled'}</span>
                  {s.hidden && <Icon name="eyeOff" />}
                  {s.animations.length > 0 && <span className="sorter-badge" title={`${s.animations.length} animation${s.animations.length > 1 ? 's' : ''}`}>✦</span>}
                  {vis >= 0 && <button className="btn icon sorter-play" aria-label={`Play from slide ${i + 1}`} title="Play from here" onClick={(e) => { e.stopPropagation(); onPlay(vis); }}><Icon name="play" /></button>}
                </div>
              </div>
              {drop === pres.slides.length && i === pres.slides.length - 1 && <div className="sorter-drop end" aria-hidden />}
            </div>
          );
        })}
      </div>
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} label="Slide actions" items={tidy([
          sel.length === 1 && { label: 'Open', run: () => open(sel[0]!) },
          !readOnly && { label: 'Duplicate', icon: 'copy', kbd: '⌘D', run: () => duplicateSlides(store, target()) },
          !readOnly && { label: 'Hide / show', icon: 'eyeOff', kbd: 'H', run: () => toggleHidden(store, target()) },
          !readOnly && { label: 'Move earlier', kbd: '⌘←', run: () => move(-1) },
          !readOnly && { label: 'Move later', kbd: '⌘→', run: () => move(1) },
          'sep',
          !readOnly && { label: sel.length > 1 ? `Delete ${sel.length} slides` : 'Delete', icon: 'trash', kbd: '⌫', danger: true, run: () => { deleteSlides(store, target()); setSel([]); } },
        ])} />
      )}
    </div>
  );
}
