import { useEffect, useState } from 'react';
import type { WebsocketProvider } from 'y-websocket';
import { useEditor, type EditorStore } from '../lib/store';
import { Icon } from './icons';
import { MenuItem, Popover } from './ui';
import { insertChart, insertEquation, insertFiles, insertLine, insertTable, insertText, pickFiles } from './actions';
import { SHAPE_KINDS, shapePath } from '../render/shapes';
import { exportNative, exportToPptx, reportWarnings } from '../lib/export';
import { toast } from '../lib/toast';
import type { ShapeKind } from '@deck/core';

export function TopBar({ store, onPlay, onPrint, onHome, provider, theme, setTheme, cloud }: { store: EditorStore; onPlay: (fromStart: boolean) => void; onPrint: () => void; onHome: () => void; provider: WebsocketProvider | null; theme: 'dark' | 'light'; setTheme: (t: 'dark' | 'light') => void; cloud: boolean }) {
  const { pres, ui } = useEditor(store, (s) => s);
  const [title, setTitle] = useState(pres.title);
  const [status, setStatus] = useState<'saved' | 'saving' | 'offline' | 'synced'>('saved');
  const [peers, setPeers] = useState<{ name: string; color: string }[]>([]);
  useEffect(() => setTitle(pres.title), [pres.title]);

  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const off = store.deck.subscribe((_, local) => {
      if (!local) return;
      setStatus('saving');
      clearTimeout(t);
      t = setTimeout(() => setStatus(provider ? (provider.wsconnected ? 'synced' : 'offline') : 'saved'), 500);
    });
    return () => { off(); clearTimeout(t); };
  }, [store, provider]);

  useEffect(() => {
    if (!provider) return;
    const onStatus = ({ status: s }: { status: string }) => setStatus(s === 'connected' ? 'synced' : 'offline');
    const onAw = () => {
      const list: { name: string; color: string }[] = [];
      provider.awareness.getStates().forEach((st, id) => {
        if (id !== provider.awareness.clientID && st.user) list.push({ name: String(st.user.name), color: st.user.color });
      });
      setPeers(list);
    };
    provider.on('status', onStatus);
    provider.awareness.on('change', onAw);
    return () => {
      provider.off('status', onStatus);
      provider.awareness.off('change', onAw);
    };
  }, [provider]);

  const label = { saved: 'Saved on this device', saving: 'Saving…', offline: 'Offline — changes kept locally', synced: 'All changes synced' }[status];

  return (
    <header className="topbar">
      <button className="btn icon" aria-label="All presentations" title="All presentations" onClick={onHome}><span className="wordmark" style={{ letterSpacing: 0 }}><i /></span></button>
      <input
        className="doc-title"
        aria-label="Presentation title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => title.trim() && title !== pres.title && store.update((p) => ({ ...p, title: title.trim().slice(0, 200) }))}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      />
      <span className="save-state" role="status" aria-live="polite">{status === 'offline' ? <span style={{ color: 'var(--accent)' }}>{label}</span> : label}</span>
      <button className="btn icon" aria-label="Undo" title="Undo ⌘Z" onClick={() => store.undo()}><Icon name="undo" /></button>
      <button className="btn icon" aria-label="Redo" title="Redo ⇧⌘Z" onClick={() => store.redo()}><Icon name="redo" /></button>

      <div className="tools" role="toolbar" aria-label="Insert">
        <button className={`btn ${ui.tool === 'text' ? 'on' : ''}`} title="Text (T) — click or drag on the slide" onClick={() => (ui.tool === 'text' ? insertText(store) : store.setUi({ tool: 'text' }))}><Icon name="text" />Text</button>
        <Popover align="center" width={232} trigger={(open) => <button className={`btn ${ui.tool === 'shape' ? 'on' : ''}`} title="Shape (R)" onClick={open}><Icon name="shape" />Shape</button>}>
          {(close) => (
            <div style={{ padding: 4 }}>
              <div className="grid4">
                {SHAPE_KINDS.map((k) => (
                  <button key={k} className="btn" style={{ height: 44, justifyContent: 'center' }} aria-label={k} title={`${k} — drag on the slide`} onClick={() => { store.setUi({ tool: 'shape', shapeKind: k as ShapeKind }); close(); }}>
                    <svg width="26" height="26" viewBox="-1 -1 28 28"><path d={shapePath(k as ShapeKind, 26, 26, 6)} fill="currentColor" fillOpacity=".15" stroke="currentColor" strokeWidth="1.4" /></svg>
                  </button>
                ))}
              </div>
              <hr />
              <MenuItem icon="line" label="Line" kbd="L" onClick={() => { store.setUi({ tool: 'line' }); close(); }} />
              <MenuItem icon="arrow" label="Arrow" onClick={() => { insertLine(store, true); close(); }} />
            </div>
          )}
        </Popover>
        <button className="btn" title="Image" onClick={async () => insertFiles(store, await pickFiles('image/png,image/jpeg,image/gif,image/webp,image/svg+xml'))}><Icon name="image" />Image</button>
        <button className="btn" title="Table" onClick={() => insertTable(store)}><Icon name="table" />Table</button>
        <Popover align="center" trigger={(open) => <button className="btn" title="Chart" onClick={open}><Icon name="chart" />Chart</button>}>
          {(close) => (['column', 'bar', 'line', 'area', 'pie', 'donut', 'scatter'] as const).map((k) => <MenuItem key={k} icon="chart" label={k[0]!.toUpperCase() + k.slice(1)} onClick={() => { insertChart(store, k); close(); }} />)}
        </Popover>
        <button className="btn" title="Video or audio" onClick={async () => insertFiles(store, await pickFiles('video/mp4,video/webm,video/quicktime,audio/*'))}><Icon name="media" />Media</button>
        <button className="btn" title="Equation" onClick={() => insertEquation(store)}><Icon name="equation" />Math</button>
      </div>

      <span className="spacer" />
      {peers.length > 0 && (
        <div className="avatars" aria-label={`${peers.length} collaborators online`}>
          {peers.slice(0, 5).map((p, i) => <span key={i} className="avatar" style={{ background: p.color }} title={p.name}>{p.name.slice(0, 1).toUpperCase()}</span>)}
        </div>
      )}
      <button className="btn icon" aria-label="Command palette" title="Search commands ⌘K" onClick={() => store.setUi({ palette: true })}><Icon name="search" /></button>
      <button className="btn icon" aria-label={theme === 'dark' ? 'Light interface' : 'Dark interface'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></button>
      <button className={`btn icon ${ui.inspectorOpen ? 'on' : ''}`} aria-label="Toggle inspector" title="Inspector ⌥⌘I" onClick={() => store.setUi({ inspectorOpen: !ui.inspectorOpen })}><Icon name="inspector" /></button>
      <Popover align="end" width={260} trigger={(open) => <button className="btn" onClick={open}><Icon name="download" />Export</button>}>
        {(close) => (
          <>
            <MenuItem icon="file" label="Open XML presentation (.pptx)" onClick={async () => { close(); try { reportWarnings(await exportToPptx(store)); } catch (e) { toast(`Export failed: ${(e as Error).message}`); } }} />
            <MenuItem icon="printer" label="PDF / Print…" kbd="⌘P" onClick={() => { close(); onPrint(); }} />
            <MenuItem icon="file" label="DECK document (.deck)" onClick={() => { close(); void exportNative(store); }} />
            <hr />
            <MenuItem icon="history" label="Version history…" onClick={() => { close(); store.setUi({ dialog: 'history' }); }} />
          </>
        )}
      </Popover>
      <button className="btn ghost-strong" onClick={() => store.setUi({ dialog: 'share' })}><Icon name="share" />{cloud ? 'Share' : 'Share…'}</button>
      <div className="row" style={{ gap: 0 }}>
        <button className="btn primary" style={{ borderRadius: '6px 0 0 6px' }} onClick={() => onPlay(false)} title="Play from current slide ⌘⏎"><Icon name="play" />Play</button>
        <Popover align="end" trigger={(open) => <button className="btn primary icon" style={{ borderRadius: '0 6px 6px 0', borderLeft: '1px solid rgba(0,0,0,.15)', width: 26 }} aria-label="Play options" onClick={open}><Icon name="chevron" /></button>}>
          {(close) => (
            <>
              <MenuItem icon="play" label="From current slide" kbd="⌘⏎" onClick={() => { close(); onPlay(false); }} />
              <MenuItem icon="play" label="From beginning" kbd="⇧⌘⏎" onClick={() => { close(); onPlay(true); }} />
              <MenuItem icon="presenter" label="With presenter view" onClick={() => { close(); onPlay(false); setTimeout(() => window.open(`${location.pathname}#/d/${location.hash.split('/')[2]}/presenter`, '_blank', 'popup,width=1280,height=800'), 300); }} />
            </>
          )}
        </Popover>
      </div>
    </header>
  );
}
