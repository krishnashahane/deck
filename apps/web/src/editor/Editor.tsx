import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEditor, type EditorStore } from '../lib/store';
import type { WebsocketProvider } from 'y-websocket';
import { TopBar } from './TopBar';
import { Rail } from './Rail';
import { Stage, isTyping } from './Stage';
import { Inspector } from './Inspector';
import { Bottom } from './Bottom';
import { Palette, buildCommands } from './Palette';
import { Dialogs } from './Dialogs';
import { Comments } from './Comments';
import { FindReplace } from './FindReplace';
import { Sorter } from './Sorter';
import * as A from './actions';
import { Show, visibleSlides } from '../present/Show';
import { SlideView } from '../render/SlideView';
import { printDeck } from '../lib/export';
import type { User } from '../lib/api';

export function Editor({ store, docId, user, provider, serverId, role, theme, setTheme, onMakeCloud }: { store: EditorStore; docId: string; user: User | null; provider: WebsocketProvider | null; serverId: string | null; role: string; theme: 'dark' | 'light'; setTheme: (t: 'dark' | 'light') => void; onMakeCloud: () => Promise<void> }) {
  const { pres, ui } = useEditor(store, (s) => s);
  const [show, setShow] = useState<number | null>(null);
  const [printing, setPrinting] = useState(false);
  const [find, setFind] = useState<null | 'find' | 'replace'>(null);
  const readOnly = role === 'viewer' || role === 'commenter';
  useEffect(() => {
    if (store.ui.readOnly !== readOnly) store.setUi({ readOnly, inspectorOpen: !readOnly && store.ui.inspectorOpen });
  }, [readOnly, store]);

  const play = (fromStart: boolean) => {
    const vis = visibleSlides(pres);
    const i = fromStart ? 0 : Math.max(0, vis.findIndex((s) => s.id === ui.slideId));
    setShow(i);
  };

  const commands = useMemo(
    () => buildCommands(store, [
      { id: 'play', group: 'Present', label: 'Play from current slide', icon: 'play', kbd: '⌘⏎', run: () => play(false) },
      { id: 'play0', group: 'Present', label: 'Play from beginning', icon: 'play', kbd: '⇧⌘⏎', run: () => play(true) },
      { id: 'print', group: 'Export', label: 'PDF / Print', icon: 'printer', kbd: '⌘P', run: () => printDeck(setPrinting) },
      { id: 'find', group: 'Edit', label: 'Find', icon: 'search', kbd: '⌘F', run: () => setFind('find') },
      { id: 'replace', group: 'Edit', label: 'Find and replace', icon: 'search', kbd: '⇧⌘H', run: () => setFind('replace') },
      { id: 'sorter', group: 'View', label: 'Slide sorter', icon: 'layout', kbd: '⌥⌘S', run: () => store.setUi({ sorter: true }) },
      { id: 'copystyle', group: 'Edit', label: 'Copy style', icon: 'brush', kbd: '⌥⌘C', run: () => A.copyFormat(store) },
      { id: 'pastestyle', group: 'Edit', label: 'Paste style', icon: 'brush', kbd: '⌥⌘V', run: () => A.pasteFormat(store) },
      { id: 'painter', group: 'Edit', label: 'Format painter', icon: 'brush', run: () => A.startPainter(store) },
      { id: 'history', group: 'File', label: 'Version history', icon: 'history', run: () => store.setUi({ dialog: 'history' }) },
      { id: 'share', group: 'File', label: 'Share', icon: 'share', run: () => store.setUi({ dialog: 'share' }) },
    ]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, pres.slides, ui.slideId],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (show !== null) return;
      const mod = e.metaKey || e.ctrlKey;
      const typing = isTyping(e);
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); store.setUi({ palette: true }); return; }
      if (mod && e.key === 'Enter') { e.preventDefault(); e.shiftKey ? play(true) : ui.selection.length || ui.editingId ? play(false) : A.addSlide(store); return; }
      if (mod && !e.altKey && e.key.toLowerCase() === 'f' && !ui.editingId) { e.preventDefault(); setFind('find'); return; }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'h' && !readOnly) { e.preventDefault(); setFind('replace'); return; }
      if (mod && e.altKey && e.code === 'KeyS') { e.preventDefault(); store.setUi({ sorter: !store.ui.sorter }); return; }
      if (mod && e.key.toLowerCase() === 'p') { e.preventDefault(); printDeck(setPrinting); return; }
      if (typing) {
        if (ui.editingId && mod && ['b', 'i', 'u'].includes(e.key.toLowerCase())) {
          e.preventDefault();
          document.execCommand({ b: 'bold', i: 'italic', u: 'underline' }[e.key.toLowerCase()]!);
        }
        return;
      }
      if (readOnly) {
        if (e.key === 'PageDown' || e.key === 'ArrowDown') nav(1);
        if (e.key === 'PageUp' || e.key === 'ArrowUp') nav(-1);
        return;
      }
      const k = e.key;
      if (mod && e.altKey && e.code === 'KeyC') { e.preventDefault(); A.copyFormat(store); return; }
      if (mod && e.altKey && e.code === 'KeyV') { e.preventDefault(); A.pasteFormat(store); return; }
      if (mod && k.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? store.redo() : store.undo(); return; }
      if (mod && k.toLowerCase() === 'y') { e.preventDefault(); store.redo(); return; }
      if (mod && k.toLowerCase() === 'd') { e.preventDefault(); A.duplicateSelection(store); return; }
      if (mod && k.toLowerCase() === 'a') { e.preventDefault(); store.select(store.slide?.elements.map((x) => x.id) ?? []); return; }
      if (mod && k.toLowerCase() === 'g') { e.preventDefault(); e.shiftKey ? A.ungroupSelection(store) : A.groupSelection(store); return; }
      if (mod && k === ']') { e.preventDefault(); A.zorder(store, e.shiftKey ? 'front' : 'forward'); return; }
      if (mod && k === '[') { e.preventDefault(); A.zorder(store, e.shiftKey ? 'back' : 'backward'); return; }
      if (mod && k === "'") { e.preventDefault(); store.setUi({ showGrid: !ui.showGrid }); return; }
      if (mod && k === '0') { e.preventDefault(); store.setUi({ zoom: 0 }); return; }
      if (mod && k === '1') { e.preventDefault(); store.setUi({ zoom: 1 }); return; }
      if (mod && (k === '=' || k === '+')) { e.preventDefault(); store.setUi({ zoom: Math.min(4, (ui.zoom || ui.fitZoom) * 1.25) }); return; }
      if (mod && k === '-') { e.preventDefault(); store.setUi({ zoom: Math.max(0.1, (ui.zoom || ui.fitZoom) / 1.25) }); return; }
      if (mod && e.shiftKey && k.toLowerCase() === 'l') { e.preventDefault(); const lock = !store.selected.every((x) => x.locked); store.updateElements(ui.selection, (x) => ({ ...x, locked: lock || undefined })); return; }
      if (mod && e.altKey && k.toLowerCase() === 'i') { e.preventDefault(); store.setUi({ inspectorOpen: !ui.inspectorOpen }); return; }
      if (mod && ['b', 'i', 'u'].includes(k.toLowerCase()) && ui.selection.length) {
        e.preventDefault();
        const key = { b: 'bold', i: 'italic', u: 'underline' }[k.toLowerCase()] as 'bold' | 'italic' | 'underline';
        store.updateElements(ui.selection, (x) => {
          if (x.type !== 'text' && x.type !== 'shape') return x;
          if (key === 'underline') { const on = !x.paragraphs.every((p) => p.runs.every((r) => r.underline)); return { ...x, paragraphs: x.paragraphs.map((p) => ({ ...p, runs: p.runs.map((r) => ({ ...r, underline: on || undefined })) })) }; }
          return { ...x, style: { ...x.style, [key]: !x.style[key] }, paragraphs: x.paragraphs.map((p) => ({ ...p, runs: p.runs.map((r) => ({ ...r, [key]: undefined })) })) };
        });
        return;
      }
      if (k === 'Delete' || k === 'Backspace') {
        e.preventDefault();
        if (ui.selection.length) A.deleteSelection(store);
        else if (document.activeElement?.closest('.rail')) A.deleteSlides(store);
        return;
      }
      if (k.startsWith('Arrow')) {
        e.preventDefault();
        if (!ui.selection.length) { nav(k === 'ArrowDown' || k === 'ArrowRight' ? 1 : -1); return; }
        const d = e.shiftKey ? 10 : 1;
        A.nudge(store, k === 'ArrowLeft' ? -d : k === 'ArrowRight' ? d : 0, k === 'ArrowUp' ? -d : k === 'ArrowDown' ? d : 0);
        return;
      }
      if (k === 'PageDown') { e.preventDefault(); nav(1); return; }
      if (k === 'PageUp') { e.preventDefault(); nav(-1); return; }
      if (k === 'Escape') { if (ui.sorter) { store.setUi({ sorter: false }); return; } store.setUi({ selection: [], tool: 'select', editingId: null, painter: null }); return; }
      if (k === 'Enter' && ui.selection.length === 1) {
        const el = store.selected[0];
        if (el && (el.type === 'text' || el.type === 'shape')) { e.preventDefault(); store.setUi({ editingId: el.id }); }
        return;
      }
      if (!mod && !e.altKey) {
        if (k === 't') store.setUi({ tool: 'text' });
        if (k === 'r') store.setUi({ tool: 'shape', shapeKind: 'rect' });
        if (k === 'o') store.setUi({ tool: 'shape', shapeKind: 'ellipse' });
        if (k === 'l') store.setUi({ tool: 'line' });
        if (k === 'v') store.setUi({ tool: 'select' });
        if (k === '?') store.setUi({ dialog: 'shortcuts' });
      }
    };
    const nav = (d: number) => {
      const i = pres.slides.findIndex((s) => s.id === ui.slideId);
      const n = pres.slides[Math.max(0, Math.min(pres.slides.length - 1, i + d))];
      if (n) store.goToSlide(n.id);
    };
    const onCopy = (e: ClipboardEvent) => { if (isTyping(e) || readOnly) return; e.preventDefault(); void A.copy(store); };
    const onCut = (e: ClipboardEvent) => { if (isTyping(e) || readOnly) return; e.preventDefault(); void A.copy(store, true); };
    const onPaste = (e: ClipboardEvent) => { if (isTyping(e) || readOnly) return; e.preventDefault(); void A.paste(store, e); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('copy', onCopy);
    window.addEventListener('cut', onCut);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('copy', onCopy);
      window.removeEventListener('cut', onCut);
      window.removeEventListener('paste', onPaste);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, ui, pres.slides, show, readOnly]);

  if (show !== null) return <Show pres={pres} deck={store.deck} docId={docId} startIndex={show} onExit={() => setShow(null)} />;

  const zoomPct = Math.round((ui.zoom || ui.fitZoom) * 100);
  return (
    <div className={`editor ${ui.inspectorOpen && !readOnly ? '' : 'no-inspector'}`} data-readonly={readOnly || undefined}>
      <TopBar store={store} onPlay={play} onPrint={() => printDeck(setPrinting)} onHome={() => (location.hash = '#/')} provider={provider} theme={theme} setTheme={setTheme} cloud={Boolean(serverId)} />
      <Rail store={store} />
      <div style={{ gridArea: 'stage', position: 'relative', minWidth: 0, minHeight: 0, display: 'flex' }}>
        <Stage store={store} awareness={provider?.awareness ?? null} />
        {find && <FindReplace store={store} mode={find} onClose={() => setFind(null)} />}
        <div className="zoom-bar" role="group" aria-label="Zoom">
          <button className="btn icon" aria-label="Zoom out" onClick={() => store.setUi({ zoom: Math.max(0.1, (ui.zoom || ui.fitZoom) / 1.25) })}>−</button>
          <button className="btn val" onClick={() => store.setUi({ zoom: 0 })} title="Fit (⌘0)">{ui.zoom ? `${zoomPct}%` : 'Fit'}</button>
          <button className="btn icon" aria-label="Zoom in" onClick={() => store.setUi({ zoom: Math.min(4, (ui.zoom || ui.fitZoom) * 1.25) })}>+</button>
        </div>
        <div className="stage-hint">{readOnly ? `View only — you have ${role} access` : ui.tool !== 'select' ? `Drag on the slide to place a ${ui.tool === 'shape' ? ui.shapeKind : ui.tool} · Esc to cancel` : 'Double-click to add text · ⌘K for commands'}</div>
      </div>
      <Bottom store={store} />
      {ui.inspectorOpen && !readOnly && <Inspector store={store} />}
      {serverId && user && <Comments store={store} serverId={serverId} role={role} />}
      {ui.palette && <Palette store={store} commands={commands} onClose={() => store.setUi({ palette: false })} />}
      {ui.sorter && <Sorter store={store} onClose={() => store.setUi({ sorter: false })} onPlay={(i) => { store.setUi({ sorter: false }); setShow(i); }} />}
      <Dialogs store={store} docId={docId} user={user} serverId={serverId} onMakeCloud={onMakeCloud} />
      {printing && createPortal(<PrintRoot store={store} />, document.getElementById('root')!)}
    </div>
  );
}

function PrintRoot({ store }: { store: EditorStore }) {
  const pres = store.pres;
  // 1 slide unit = 1 CSS px; pages are sized to the slide exactly.
  return (
    <div className="print-root">
      <style>{`@page { size: ${pres.width}px ${pres.height}px; margin: 0 }`}</style>
      {visibleSlides(pres).map((s) => (
        <div key={s.id} className="print-page" style={{ width: pres.width, height: pres.height }}>
          <SlideView slide={s} pres={pres} deck={store.deck} width={pres.width} />
        </div>
      ))}
    </div>
  );
}
