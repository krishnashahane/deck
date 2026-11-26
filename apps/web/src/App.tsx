import { Suspense, lazy, useEffect, useState } from 'react';
import * as Y from 'yjs';
import type { WebsocketProvider } from 'y-websocket';
import { Home } from './Home';
// Route-level code splitting: the home screen loads first; heavy screens load on demand.
const Account = lazy(() => import('./Account').then((m) => ({ default: m.Account })));
const Editor = lazy(() => import('./editor/Editor').then((m) => ({ default: m.Editor })));
const Show = lazy(() => import('./present/Show').then((m) => ({ default: m.Show })));
const Presenter = lazy(() => import('./present/Presenter').then((m) => ({ default: m.Presenter })));
import { EditorStore } from './lib/store';
import { listDocs, openDoc, recovered, requestPersistentStorage, upsertDoc, type OpenDoc } from './lib/persistence';
import { api, b64, me, type Role, type User } from './lib/api';
import { connect } from './lib/collab';
import { onToasts, toast } from './lib/toast';
import { pendingSeeds } from './seeds';

function useHash(): string {
  const [h, setH] = useState(location.hash || '#/');
  useEffect(() => {
    const on = () => setH(location.hash || '#/');
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return h;
}

function useTheme(): ['dark' | 'light', (t: 'dark' | 'light') => void] {
  const [t, setT] = useState<'dark' | 'light'>(() => (localStorage.getItem('deck.ui-theme') as 'dark' | 'light') ?? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
  useEffect(() => {
    document.documentElement.dataset.theme = t;
    localStorage.setItem('deck.ui-theme', t);
  }, [t]);
  return [t, setT];
}

export function App() {
  const hash = useHash();
  const [theme, setTheme] = useTheme();
  const parts = hash.replace(/^#\/?/, '').split('/');
  let page: React.ReactNode;
  if (parts[0] === 'd' && parts[1]) page = <DocRoute key={parts[1]} id={parts[1]} mode={(parts[2] as 'present' | 'presenter' | 'play') ?? 'edit'} start={Number(parts[3] ?? 0)} theme={theme} setTheme={setTheme} />;
  else if (parts[0] === 'account') page = <Account />;
  else if (parts[0] === 'reset' && parts[1]) page = <Account resetToken={parts[1]} />;
  else if (parts[0] === 'join' && parts[1]) page = <Join token={parts[1]} />;
  else page = <Home theme={theme} setTheme={setTheme} />;
  return (
    <>
      <Suspense fallback={<div className="empty-state" aria-busy="true">Loading…</div>}>{page}</Suspense>
      <Toasts />
    </>
  );
}

function Toasts() {
  const [msgs, setMsgs] = useState<{ id: number; text: string }[]>([]);
  useEffect(() => onToasts(setMsgs), []);
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {msgs.map((m) => <div key={m.id} className="toast">{m.text}</div>)}
    </div>
  );
}

function Join({ token }: { token: string }) {
  const [msg, setMsg] = useState('Joining…');
  useEffect(() => {
    void me().then(async (u) => {
      if (!u) {
        sessionStorage.setItem('deck.afterLogin', `#/join/${token}`);
        location.hash = '#/account';
        return;
      }
      try {
        const r = await api<{ docId: string }>(`/share/${encodeURIComponent(token)}/accept`, { body: {} });
        location.hash = `#/d/c_${r.docId}`;
      } catch (e) {
        setMsg(`This link is invalid, expired or revoked. (${(e as Error).message})`);
      }
    });
  }, [token]);
  return <div className="empty-state">{msg}</div>;
}

function DocRoute({ id, mode, start, theme, setTheme }: { id: string; mode: 'edit' | 'present' | 'presenter' | 'play'; start: number; theme: 'dark' | 'light'; setTheme: (t: 'dark' | 'light') => void }) {
  const [state, setState] = useState<{ open: OpenDoc; store: EditorStore } | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [provider, setProvider] = useState<WebsocketProvider | null>(null);
  const [role, setRole] = useState<Role>('owner');
  const [error, setError] = useState<string | null>(null);
  const serverId = id.startsWith('c_') ? id.slice(2) : null;

  useEffect(() => {
    let disposed = false;
    let prov: WebsocketProvider | null = null;
    let opened: OpenDoc | null = null;
    (async () => {
      const seed = pendingSeeds.get(id);
      void requestPersistentStorage();
      opened = await openDoc(id, seed);
      if (disposed) return opened.destroy();
      if (recovered.delete(id)) toast('Recovered this presentation from its latest automatic snapshot', 5000);
      const store = new EditorStore(opened.deck);
      const u = await me();
      setUser(u);
      if (serverId) {
        if (!u) {
          sessionStorage.setItem('deck.afterLogin', location.hash);
          location.hash = '#/account';
          return;
        }
        try {
          const meta = await api<{ title: string; role: Role }>(`/docs/${serverId}`);
          setRole(meta.role);
          upsertDoc({ id, title: meta.title, updated: Date.now(), slides: opened.deck.presentation.slides.length, cloud: { serverId, role: meta.role } });
        } catch (e) {
          if ((e as { status?: number }).status === 403 || (e as { status?: number }).status === 404) {
            setError('You do not have access to this presentation.');
            return;
          }
          toast('Offline — showing your last synced copy');
        }
        prov = connect(serverId, opened.deck.doc, u);
        setProvider(prov);
        // Wait for first sync before showing an empty document.
        if (!opened.deck.initialized) await new Promise<void>((r) => { prov!.once('sync', () => r()); setTimeout(r, 4000); });
        store.setUi({ slideId: opened.deck.presentation.slides[0]?.id ?? null });
      } else if (!opened.deck.initialized) {
        setError('This presentation is not stored on this device.');
        return;
      }
      if (!disposed) {
        pendingSeeds.delete(id);
        setState({ open: opened, store });
      }
    })().catch((e) => setError(String(e?.message ?? e)));
    return () => {
      disposed = true;
      prov?.destroy();
      opened?.destroy();
    };
  }, [id, serverId]);

  // Keep the URL's slide in sync with the open document title for the tab.
  useEffect(() => {
    if (!state) return;
    const upd = () => (document.title = `${state.store.pres.title} — DECK`);
    upd();
    return state.store.deck.subscribe(upd);
  }, [state]);

  const makeCloud = async () => {
    if (!state) return;
    const r = await api<{ id: string }>('/docs', { body: { title: state.store.pres.title, state: b64(Y.encodeStateAsUpdate(state.store.deck.doc)) } });
    const entry = listDocs().find((d) => d.id === id);
    if (entry) upsertDoc({ ...entry, cloud: { serverId: r.id, role: 'owner' } });
    location.hash = `#/d/c_${r.id}`;
  };

  if (error) return <div className="empty-state"><div><p>{error}</p><a className="btn ghost-strong" href="#/">Back to presentations</a></div></div>;
  if (!state) return <div className="empty-state" aria-busy="true">Opening…</div>;
  const { store } = state;
  if (mode === 'presenter') return <Presenter pres={store.pres} deck={store.deck} docId={id} />;
  if (mode === 'present' || mode === 'play') return <Show pres={store.pres} deck={store.deck} docId={id} startIndex={start} onExit={() => (location.hash = `#/d/${id}`)} />;
  return <Editor store={store} docId={id} user={user} provider={provider} serverId={serverId} role={role} theme={theme} setTheme={setTheme} onMakeCloud={makeCloud} />;
}
