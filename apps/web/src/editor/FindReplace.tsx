import { useEffect, useMemo, useRef, useState } from 'react';
import { findInPresentation, replaceInPresentation, type FindMatch, type FindOptions } from '@deck/core';
import { useEditor, type EditorStore } from '../lib/store';
import { Icon } from './icons';
import { toast } from '../lib/toast';

const placeLabel = (m: FindMatch) =>
  m.place.kind === 'notes' ? 'Notes' : m.place.kind === 'cell' ? 'Table' : m.place.kind === 'chart' ? 'Chart' : m.place.kind === 'alt' ? 'Alt text' : 'Text';

/**
 * Deck-wide find & replace panel. Non-modal: the slide stays visible and each
 * match is revealed (slide shown, element selected) as you step through results.
 * "Replace all" is a single undoable change.
 */
export function FindReplace({ store, mode, onClose }: { store: EditorStore; mode: 'find' | 'replace'; onClose: () => void }) {
  const pres = useEditor(store, (s) => s.pres);
  const readOnly = useEditor(store, (s) => s.ui.readOnly);
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [showReplace, setShowReplace] = useState(mode === 'replace' && !readOnly);
  const [opts, setOpts] = useState<FindOptions>({ matchCase: false, wholeWord: false, notes: true, altText: false });
  const [index, setIndex] = useState(0);
  const findRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setShowReplace((v) => (mode === 'replace' && !readOnly) || v); findRef.current?.focus(); findRef.current?.select(); }, [mode, readOnly]);

  const matches = useMemo(() => findInPresentation(pres, query, opts), [pres, query, opts]);
  const cur = matches.length ? Math.min(index, matches.length - 1) : -1;
  const active = cur >= 0 ? matches[cur] : undefined;

  const reveal = (m: FindMatch | undefined) => {
    if (!m) return;
    store.goToSlide(m.slideId);
    if (m.place.kind === 'notes') store.setUi({ selection: [], editingId: null });
    else store.select([m.place.elementId]);
  };
  const go = (d: number) => {
    if (!matches.length) return;
    const n = (cur + d + matches.length) % matches.length;
    setIndex(n);
    reveal(matches[n]);
  };
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [cur]);

  const replaceOne = () => {
    if (!active || readOnly) return;
    if (active.locked) { toast('That object is locked — unlock it to replace'); return; }
    const { presentation, count } = replaceInPresentation(store.pres, query, replacement, opts, [active.key]);
    if (!count) return;
    store.update(() => presentation);
    // Stay on the same position: the next match slides into this index.
    reveal(findInPresentation(presentation, query, opts)[cur]);
  };
  const replaceAll = () => {
    if (!matches.length || readOnly) return;
    const { presentation, count } = replaceInPresentation(store.pres, query, replacement, opts);
    if (!count) { toast('Nothing to replace — every match is in a locked object'); return; }
    store.update(() => presentation);
    const skipped = matches.filter((m) => m.locked).length;
    toast(`Replaced ${count} match${count === 1 ? '' : 'es'}${skipped ? ` · ${skipped} in locked objects skipped` : ''} · ⌘Z to undo`, 4000);
  };

  const onKey = (e: React.KeyboardEvent) => {
    e.stopPropagation(); // keep editor shortcuts (Delete, arrows…) from acting on the slide
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    else if (e.key === 'Enter' && (e.target as HTMLElement).dataset.role === 'find') { e.preventDefault(); go(e.shiftKey ? -1 : 1); }
    else if (e.key === 'Enter' && (e.target as HTMLElement).dataset.role === 'replace') { e.preventDefault(); (e.metaKey || e.ctrlKey) ? replaceAll() : replaceOne(); }
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); findRef.current?.select(); }
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'h' && !readOnly) { e.preventDefault(); setShowReplace(true); }
  };

  const toggle = (k: keyof FindOptions, label: string, text: string) => (
    <button type="button" className="btn icon find-opt" aria-pressed={Boolean(opts[k])} title={label} aria-label={label} onClick={() => setOpts((o) => ({ ...o, [k]: !o[k] }))}>{text}</button>
  );

  return (
    <div className="findbar" role="search" aria-label="Find and replace" onKeyDown={onKey}>
      <div className="find-row">
        {!readOnly && (
          <button type="button" className="btn icon" aria-label={showReplace ? 'Hide replace' : 'Show replace'} aria-expanded={showReplace} onClick={() => setShowReplace((v) => !v)}>
            <Icon name={showReplace ? 'chevron' : 'chevronR'} />
          </button>
        )}
        <div className="find-field">
          <Icon name="search" />
          <input ref={findRef} data-role="find" className="input" placeholder="Find in presentation" aria-label="Find" value={query} maxLength={500} spellCheck={false}
            onChange={(e) => { setQuery(e.target.value); setIndex(0); }} />
          <span className="find-count" aria-live="polite">{query ? (matches.length ? `${cur + 1} of ${matches.length}${matches.length >= 5000 ? '+' : ''}` : 'No results') : ''}</span>
        </div>
        {toggle('matchCase', 'Match case', 'Aa')}
        {toggle('wholeWord', 'Whole words', 'W')}
        <button type="button" className="btn icon" aria-label="Previous match" disabled={!matches.length} onClick={() => go(-1)}><Icon name="chevronL" /></button>
        <button type="button" className="btn icon" aria-label="Next match" disabled={!matches.length} onClick={() => go(1)}><Icon name="chevronR" /></button>
        <button type="button" className="btn icon" aria-label="Close find" onClick={onClose}><Icon name="close" /></button>
      </div>
      {showReplace && !readOnly && (
        <div className="find-row">
          <span className="find-indent" />
          <div className="find-field">
            <input data-role="replace" className="input" placeholder="Replace with" aria-label="Replace with" value={replacement} maxLength={10000} spellCheck={false} onChange={(e) => setReplacement(e.target.value)} />
          </div>
          <button type="button" className="btn" disabled={!active} onClick={replaceOne}>Replace</button>
          <button type="button" className="btn primary" disabled={!matches.length} onClick={replaceAll}>Replace all</button>
        </div>
      )}
      <div className="find-scope">
        <label><input type="checkbox" checked={opts.notes !== false} onChange={(e) => setOpts((o) => ({ ...o, notes: e.target.checked }))} /> Speaker notes</label>
        <label><input type="checkbox" checked={Boolean(opts.altText)} onChange={(e) => setOpts((o) => ({ ...o, altText: e.target.checked }))} /> Alt text</label>
      </div>
      {query && matches.length > 0 && (
        <div className="find-results" role="listbox" aria-label="Matches" ref={listRef}>
          {matches.slice(0, 300).map((m, i) => (
            <div key={m.key} role="option" aria-selected={i === cur} className="find-result" onClick={() => { setIndex(i); reveal(m); }}>
              <span className="find-where">{m.slideIndex + 1}<small>{placeLabel(m)}{m.locked ? ' · locked' : ''}</small></span>
              <span className="find-ctx">{m.context[0]}<mark>{m.context[1]}</mark>{m.context[2]}</span>
            </div>
          ))}
          {matches.length > 300 && <div className="find-more">Showing the first 300 of {matches.length} matches</div>}
        </div>
      )}
    </div>
  );
}
