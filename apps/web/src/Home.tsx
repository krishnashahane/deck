import { useEffect, useMemo, useState } from 'react';
import { TEMPLATES, type Presentation } from '@deck/core';
import { listDocs, newDocId, removeDoc, type DocEntry } from './lib/persistence';
import { SlideView } from './render/SlideView';
import { DeckDoc } from '@deck/core';
import { Icon } from './editor/icons';
import { api, me, serverAvailable, type CloudDoc, type User } from './lib/api';
import { readPresentationFile } from './lib/export';
import { toast } from './lib/toast';
import { pendingSeeds } from './seeds';

const previewDeck = new DeckDoc();

export function Home({ theme, setTheme }: { theme: 'dark' | 'light'; setTheme: (t: 'dark' | 'light') => void }) {
  const [docs, setDocs] = useState<DocEntry[]>(listDocs());
  const [cloud, setCloud] = useState<CloudDoc[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [hasServer, setHasServer] = useState(false);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState('All');
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const previews = useMemo(() => TEMPLATES.map((t) => ({ t, p: t.build() })), []);

  useEffect(() => {
    void serverAvailable().then(setHasServer);
    void me().then(async (u) => {
      setUser(u);
      if (u) setCloud(await api<CloudDoc[]>('/docs').catch(() => []));
    });
  }, []);

  const create = (p: Presentation, assets: Record<string, Uint8Array> = {}) => {
    const id = newDocId();
    pendingSeeds.set(id, { pres: p, assets });
    location.hash = `#/d/${id}`;
  };

  const importFiles = async (files: File[]) => {
    const f = files.find((x) => /\.(pptx|potx|deck|key)$/i.test(x.name));
    if (!f) return toast('Drop a .pptx, .potx or .deck file');
    setBusy(`Importing ${f.name}…`);
    try {
      const r = await readPresentationFile(f);
      create(r.presentation, r.assets);
      if (r.presentation.importReport?.warnings.length) toast(`Imported with ${r.presentation.importReport.warnings.length} notes — see Review › Import report`, 4500);
    } catch (e) {
      toast(`Could not import: ${(e as Error).message}`, 5000);
    } finally {
      setBusy(null);
    }
  };

  const categories = ['All', ...new Set(TEMPLATES.map((t) => t.category))];

  return (
    <div
      className="home"
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDrag(false); }}
      onDrop={(e) => { e.preventDefault(); setDrag(false); void importFiles(Array.from(e.dataTransfer.files)); }}
    >
      <header className="home-top">
        <span className="wordmark"><i />DECK</span>
        <span className="spacer" />
        {hasServer && (user ? <a className="btn" href="#/account"><Icon name="user" />{user.name || user.email}</a> : <a className="btn ghost-strong" href="#/account">Sign in</a>)}
        <button className="btn icon" aria-label="Toggle light/dark" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></button>
      </header>
      <section className="home-hero">
        <h1>Make the room <em>lean in.</em></h1>
        <p>Design, animate and present beautiful slides. Works offline, collaborates in real time, and opens and saves .pptx files.</p>
        <div className="home-actions">
          <button className="btn primary" onClick={() => create(TEMPLATES[0]!.build())}><Icon name="plus" />New presentation</button>
          <label className="btn ghost-strong" style={{ cursor: 'pointer' }}>
            <Icon name="upload" />Open file…
            <input type="file" hidden accept=".pptx,.potx,.deck,application/vnd.openxmlformats-officedocument.presentationml.presentation" onChange={(e) => void importFiles(Array.from(e.target.files ?? []))} />
          </label>
        </div>
        {busy && <p className="label" role="status">{busy}</p>}
      </section>

      {(docs.length > 0 || cloud.length > 0) && (
        <section className="home-section">
          <h3>Recent</h3>
          {cloud.map((d) => (
            <div key={d.id} className="doc-row" onClick={() => (location.hash = `#/d/c_${d.id}`)} role="link" tabIndex={0}>
              <span className="pill"><span className="dot" />Cloud</span>
              <b>{d.title}</b>
              <span className="label">{d.role} · {d.owner_name}</span>
              <span className="label">{new Date(d.updated_at).toLocaleDateString()}</span>
            </div>
          ))}
          {docs.filter((d) => !d.id.startsWith('c_')).map((d) => (
            <div key={d.id} className="doc-row" onClick={() => (location.hash = d.cloud ? `#/d/c_${d.cloud.serverId}` : `#/d/${d.id}`)} role="link" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && (location.hash = `#/d/${d.id}`)}>
              <span className="pill">{d.cloud ? 'Moved to cloud' : 'This device'}</span>
              <b>{d.title}</b>
              <span className="label">{d.slides} slides · {new Date(d.updated).toLocaleString()}</span>
              {confirmDel === d.id ? (
                <span className="row" onClick={(e) => e.stopPropagation()}>
                  <span className="label">Delete permanently?</span>
                  <button className="btn danger" onClick={() => { removeDoc(d.id); setDocs(listDocs()); setConfirmDel(null); }}>Delete</button>
                  <button className="btn" onClick={() => setConfirmDel(null)}>Cancel</button>
                </span>
              ) : (
                <button className="btn icon" aria-label={`Delete ${d.title}`} onClick={(e) => { e.stopPropagation(); setConfirmDel(d.id); }}><Icon name="trash" /></button>
              )}
            </div>
          ))}
        </section>
      )}

      <section className="home-section">
        <div className="row" style={{ marginBottom: 14 }}>
          <h3 style={{ margin: 0 }}>Templates</h3>
          <span className="spacer" />
          <div className="seg">{categories.map((c) => <button key={c} className={`btn ${filter === c ? 'on' : ''}`} onClick={() => setFilter(c)}>{c}</button>)}</div>
        </div>
        <div className="tpl-grid">
          {previews.filter(({ t }) => filter === 'All' || t.category === filter).map(({ t, p }) => (
            <button key={t.id} className="tpl" onClick={() => create(t.build())}>
              <div className="thumb"><SlideView slide={p.slides[Math.min(2, p.slides.length - 1)]!} pres={p} deck={previewDeck} width={300} lite style={{ width: '100%', height: 'auto' }} /></div>
              <b>{t.name}</b>
              <small>{t.category} · {t.description}</small>
            </button>
          ))}
        </div>
      </section>
      <section className="home-section" style={{ paddingBottom: 80 }}>
        <p className="label">Your presentations are stored on this device{hasServer ? ' until you share them' : ''}. DECK never runs macros or scripts from imported files.</p>
      </section>
      {drag && <div className="drop-hint">Drop to open</div>}
    </div>
  );
}
