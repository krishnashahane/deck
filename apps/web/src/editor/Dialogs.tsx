import { Fragment, useEffect, useState } from 'react';
import { FONT_FAMILIES, applyTheme, para, plainText, type Theme } from '@deck/core';
import { useEditor, type EditorStore } from '../lib/store';
import { Dialog } from './ui';
import { Icon } from './icons';
import { api, serverAvailable, type Role, type User } from '../lib/api';
import { proposalToSlides, runAi, type AiTask, type Proposal, type Provider } from '../lib/ai';
import { listVersions, restoreVersion, saveVersion, type Version } from '../lib/persistence';
import { toast } from '../lib/toast';

export function Dialogs({ store, docId, user, serverId, onMakeCloud }: { store: EditorStore; docId: string; user: User | null; serverId: string | null; onMakeCloud: () => Promise<void> }) {
  const { ui } = useEditor(store, (s) => s);
  const close = () => store.setUi({ dialog: null });
  switch (ui.dialog) {
    case 'import-report': return <ImportReport store={store} onClose={close} />;
    case 'share': return <Share store={store} user={user} serverId={serverId} onClose={close} onMakeCloud={onMakeCloud} />;
    case 'ai': return <Assistant store={store} user={user} onClose={close} />;
    case 'shortcuts': return <Shortcuts onClose={close} />;
    case 'history': return <History store={store} docId={docId} serverId={serverId} onClose={close} />;
    case 'brand': return <Brand store={store} onClose={close} />;
    default: return null;
  }
}

function ImportReport({ store, onClose }: { store: EditorStore; onClose: () => void }) {
  const r = store.pres.importReport;
  return (
    <Dialog title="Import report" onClose={onClose} width={640} footer={<button className="btn primary" onClick={onClose}>Done</button>}>
      {!r?.warnings.length ? <p>Everything in the file was imported.</p> : (
        <>
          <p style={{ margin: 0, color: 'var(--muted)' }}>{r.warnings.length} item{r.warnings.length > 1 ? 's were' : ' was'} approximated or kept as read-only placeholders. The original file was not modified.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: '50vh', overflow: 'auto' }}>
            {r.warnings.map((w, i) => (
              <div key={i} className={`issue ${w.code === 'macros' || w.code === 'ole' ? 'warn' : 'info'}`}>
                <Icon name={w.code === 'macros' ? 'warn' : 'info'} />
                <span>{w.slide ? <b>Slide {w.slide}. </b> : null}{w.message}</span>
              </div>
            ))}
          </div>
          <button className="btn ghost-strong" style={{ alignSelf: 'flex-start' }} onClick={() => store.update((p) => ({ ...p, importReport: undefined }))}>Dismiss report permanently</button>
        </>
      )}
    </Dialog>
  );
}

interface Member { user_id: string; email: string; name: string; role: Role }
interface Link { id: string; role: Role; expires_at: string | null; revoked: boolean; created_at: string }

function Share({ store, user, serverId, onClose, onMakeCloud }: { store: EditorStore; user: User | null; serverId: string | null; onClose: () => void; onMakeCloud: () => Promise<void> }) {
  const [up, setUp] = useState<boolean | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('editor');
  const [linkRole, setLinkRole] = useState<Role>('viewer');
  const [hours, setHours] = useState(168);
  const [newLink, setNewLink] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<Role | null>(null);
  const [activity, setActivity] = useState<DocActivity[]>([]);
  const [showActivity, setShowActivity] = useState(false);
  useEffect(() => { void serverAvailable().then(setUp); }, []);
  const load = async () => {
    if (!serverId) return;
    const d = await api<{ role: Role }>(`/docs/${serverId}`);
    setMyRole(d.role);
    if (d.role !== 'owner') return;
    setMembers(await api<Member[]>(`/docs/${serverId}/members`));
    setLinks(await api<Link[]>(`/docs/${serverId}/links`));
    setActivity(await api<DocActivity[]>(`/docs/${serverId}/activity`).catch(() => []));
  };
  useEffect(() => { void load().catch((e) => toast(e.message)); }, [serverId]);

  if (up === false) return <Dialog title="Share" onClose={onClose}><p>This document is stored only on this device. Sharing and real-time collaboration need a DECK server — see <code>docs/DEPLOYMENT.md</code>.</p></Dialog>;
  if (!user) return <Dialog title="Share" onClose={onClose}><p>Sign in to share this presentation and collaborate in real time.</p><button className="btn primary" onClick={() => { onClose(); location.hash = '#/account'; }}>Sign in or create account</button></Dialog>;
  if (!serverId) return (
    <Dialog title="Share" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={async () => { await onMakeCloud(); toast('Presentation moved to your DECK cloud'); }}>Upload & enable sharing</button></>}>
      <p style={{ margin: 0 }}>To share, DECK uploads this presentation to your DECK server. You stay the owner; access is private until you invite people or create a link.</p>
    </Dialog>
  );
  if (myRole && myRole !== 'owner') return <Dialog title="Share" onClose={onClose}><p>You have <b>{myRole}</b> access. Only the owner can change sharing.</p></Dialog>;
  return (
    <Dialog title="Share presentation" onClose={onClose} width={600}>
      <div className="row">
        <input className="input" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} />
        <select className="select" style={{ width: 130 }} value={role} onChange={(e) => setRole(e.target.value as Role)}><option value="editor">Editor</option><option value="commenter">Commenter</option><option value="viewer">Viewer</option></select>
        <button className="btn primary" disabled={!email.includes('@')} onClick={async (ev) => { const input = (ev.currentTarget.parentElement?.querySelector('input') as HTMLInputElement | null); try { await api(`/docs/${serverId}/members`, { body: { email, role } }); setEmail(''); await load(); toast('Invitation added'); } catch (e) { toast((e as Error).message); } input?.focus(); }}>Invite</button>
      </div>
      <div className="label">People with access</div>
      {members.map((m) => (
        <div key={m.user_id} className="row">
          <span className="avatar" style={{ background: 'var(--accent)', marginLeft: 0 }}>{(m.name || m.email)[0]!.toUpperCase()}</span>
          <span style={{ flex: 1 }}>{m.name || m.email}<br /><small style={{ color: 'var(--muted)' }}>{m.email}</small></span>
          {m.role === 'owner' ? <span className="pill">Owner</span> : (
            <>
              <select className="select" style={{ width: 120 }} value={m.role} onChange={async (e) => { await api(`/docs/${serverId}/members/${m.user_id}`, { method: 'PATCH', body: { role: e.target.value } }); await load(); }}><option value="editor">Editor</option><option value="commenter">Commenter</option><option value="viewer">Viewer</option></select>
              <button className="btn icon" aria-label="Remove access" onClick={async () => { await api(`/docs/${serverId}/members/${m.user_id}`, { method: 'DELETE' }); await load(); }}><Icon name="close" /></button>
            </>
          )}
        </div>
      ))}
      <div className="label">Share links</div>
      <div className="row">
        <select className="select" value={linkRole} onChange={(e) => setLinkRole(e.target.value as Role)}><option value="viewer">Can view</option><option value="commenter">Can comment</option><option value="editor">Can edit</option></select>
        <select className="select" value={hours} onChange={(e) => setHours(Number(e.target.value))}><option value={24}>Expires in 1 day</option><option value={168}>Expires in 7 days</option><option value={720}>Expires in 30 days</option><option value={0}>Never expires</option></select>
        <button className="btn ghost-strong" onClick={async () => { const r = await api<{ token: string }>(`/docs/${serverId}/links`, { body: { role: linkRole, expiresInHours: hours || null } }); setNewLink(`${location.origin}${location.pathname}#/join/${r.token}`); await load(); }}>Create link</button>
      </div>
      {newLink && (
        <div className="row"><input className="input" readOnly value={newLink} onFocus={(e) => e.target.select()} /><button className="btn primary" onClick={() => { void navigator.clipboard.writeText(newLink); toast('Link copied — it is shown only once'); }}>Copy</button></div>
      )}
      {links.filter((l) => !l.revoked).map((l) => (
        <div key={l.id} className="row">
          <Icon name="link" /><span style={{ flex: 1 }}>{l.role} link · {l.expires_at ? `expires ${new Date(l.expires_at).toLocaleString()}` : 'no expiry'}</span>
          <button className="btn danger" onClick={async () => { await api(`/docs/${serverId}/links/${l.id}`, { method: 'DELETE' }); await load(); }}>Revoke</button>
        </div>
      ))}
      {myRole === 'owner' && activity.length > 0 && (
        <>
          <button className="btn ghost-strong" aria-expanded={showActivity} style={{ alignSelf: 'flex-start' }} onClick={() => setShowActivity((v) => !v)}>
            <Icon name="history" />{showActivity ? 'Hide' : 'Show'} access activity ({activity.length})
          </button>
          {showActivity && (
            <ul className="activity" aria-label="Access activity">
              {activity.slice(0, 50).map((a, i) => (
                <li key={i}>
                  <Icon name={a.action.startsWith('link') ? 'link' : a.action.startsWith('member') ? 'user' : 'history'} />
                  <span>{describeActivity(a)}</span>
                  <small className="label">{new Date(a.at).toLocaleString()}</small>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Dialog>
  );
}

const TASKS: { id: AiTask; label: string; hint: string }[] = [
  { id: 'outline', label: 'Presentation from a prompt', hint: 'Describe the talk; get a slide outline to start from.' },
  { id: 'document', label: 'Document → slides', hint: 'Paste a document; it becomes structured slides with notes.' },
  { id: 'rewrite', label: 'Rewrite text', hint: 'Rewrite the selected text (or the whole slide) in another tone.' },
  { id: 'notes', label: 'Speaker notes', hint: 'Draft speaker notes for the current slide.' },
  { id: 'titles', label: 'Slide titles', hint: 'Suggest titles for the current slide.' },
  { id: 'review', label: 'Review deck', hint: 'Consistency, hierarchy and crowding suggestions.' },
];

function Assistant({ store, user, onClose }: { store: EditorStore; user: User | null; onClose: () => void }) {
  const [task, setTask] = useState<AiTask>('outline');
  const [provider, setProvider] = useState<Provider>('local');
  const [consent, setConsent] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [doc, setDoc] = useState('');
  const [tone, setTone] = useState<'concise' | 'formal' | 'friendly' | 'simpler'>('concise');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Proposal | null>(null);
  const [up, setUp] = useState(false);
  useEffect(() => { void serverAvailable().then(setUp); }, []);
  const canServer = up && Boolean(user);

  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      setResult(await runAi({ task, prompt, document: doc, tone, slide: store.slide, pres: store.pres, elementIds: store.ui.selection }, provider));
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const accept = () => {
    if (!result) return;
    const s = store.slide;
    if (result.slides?.length) {
      const slides = proposalToSlides(store.pres, result.slides);
      store.update((p) => {
        const i = p.slides.findIndex((x) => x.id === s?.id);
        const out = [...p.slides];
        out.splice(i + 1, 0, ...slides);
        return { ...p, slides: out };
      });
      store.goToSlide(slides[0]!.id);
    }
    if (result.rewrites?.length && s) {
      const map = new Map(result.rewrites.map((r) => [r.elementId, r.text]));
      store.updateSlide(s.id, (sl) => ({ ...sl, elements: sl.elements.map((e) => (map.has(e.id) && (e.type === 'text' || e.type === 'shape') ? { ...e, paragraphs: map.get(e.id)!.split('\n').map((l, i) => ({ ...(e.paragraphs[i] ?? e.paragraphs[0] ?? para('')), runs: [{ ...(e.paragraphs[i]?.runs[0] ?? { text: '' }), text: l }] })) } : e)) }));
    }
    if (result.notes !== undefined && s) store.updateSlide(s.id, (sl) => ({ ...sl, notes: sl.notes ? `${sl.notes}\n\n${result.notes}` : result.notes! }));
    toast('Applied — undo with ⌘Z');
    setResult(null);
  };

  const applyTitle = (t: string) => {
    const s = store.slide;
    if (!s) return;
    store.updateSlide(s.id, (sl) => ({ ...sl, elements: sl.elements.map((e) => (e.placeholder === 'title' && (e.type === 'text' || e.type === 'shape') ? { ...e, paragraphs: [{ ...(e.paragraphs[0] ?? para('')), runs: [{ ...(e.paragraphs[0]?.runs[0] ?? { text: '' }), text: t }] }] } : e)) }));
    toast('Title applied');
  };

  const current = store.slide;
  return (
    <Dialog title={<span className="row">Assistant <span className="tag-ai">{provider === 'local' ? 'ON-DEVICE' : 'AI'}</span></span>} onClose={onClose} width={720}>
      <div className="seg" style={{ flexWrap: 'wrap' }}>
        {TASKS.map((t) => <button key={t.id} className={`btn ${task === t.id ? 'on' : ''}`} onClick={() => { setTask(t.id); setResult(null); }}>{t.label}</button>)}
      </div>
      <p style={{ margin: 0, color: 'var(--muted)' }}>{TASKS.find((t) => t.id === task)!.hint}</p>
      {task === 'outline' && <textarea className="input" rows={3} placeholder="e.g. A 10-minute talk introducing our new onboarding flow to the sales team" value={prompt} onChange={(e) => setPrompt(e.target.value.slice(0, 4000))} />}
      {task === 'document' && <textarea className="input" rows={8} placeholder="Paste a document, report or notes (Markdown headings become slide titles)" value={doc} onChange={(e) => setDoc(e.target.value.slice(0, 60000))} />}
      {task === 'rewrite' && (
        <div className="row"><span className="label">Tone</span><div className="seg">{(['concise', 'formal', 'friendly', 'simpler'] as const).map((t) => <button key={t} className={`btn ${tone === t ? 'on' : ''}`} onClick={() => setTone(t)}>{t}</button>)}</div><span className="label">{store.ui.selection.length ? `${store.ui.selection.length} selected` : 'whole slide'}</span></div>
      )}
      <div className="label">Provider</div>
      <div className="seg">
        <button className={`btn ${provider === 'local' ? 'on' : ''}`} onClick={() => setProvider('local')}>On-device heuristics (private, basic)</button>
        <button className={`btn ${provider === 'server' ? 'on' : ''}`} disabled={!canServer} title={canServer ? '' : 'Requires a DECK server and sign-in'} onClick={() => setProvider('server')}>AI via DECK server</button>
      </div>
      {provider === 'server' && (
        <label className="row" style={{ alignItems: 'flex-start' }}>
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>I agree to send {task === 'document' ? 'the pasted document' : task === 'outline' ? 'my prompt' : task === 'review' ? 'the text of every slide' : 'the text of the current slide'} to the AI provider configured by this DECK server. Images, media and other presentations are not sent.</span>
        </label>
      )}
      <div className="row">
        <span className="spacer" />
        <button className="btn primary" disabled={busy || (provider === 'server' && !consent) || (task === 'outline' && !prompt.trim()) || (task === 'document' && !doc.trim()) || (['rewrite', 'notes', 'titles'].includes(task) && !current)} onClick={run}><Icon name="sparkle" />{busy ? 'Working…' : 'Generate proposal'}</button>
      </div>
      {result && (
        <div className="sect" style={{ border: 0, padding: 0 }}>
          <h4>Proposal <span className="tag-ai">{result.provider === 'local' ? 'HEURISTIC' : 'AI-GENERATED'} · NOT VERIFIED</span></h4>
          {result.unverified.length > 0 && <div className="issue warn"><Icon name="warn" /><span>Contains figures or links that are not in your source: <b>{result.unverified.join(', ')}</b>. Verify or remove them before presenting.</span></div>}
          {result.slides && <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflow: 'auto' }}>{result.slides.map((s, i) => <div key={i} className="issue info" style={{ flexDirection: 'column' }}><b>{i + 1}. {s.title}</b>{s.bullets.map((b, j) => <span key={j}>• {b}</span>)}</div>)}</div>}
          {result.rewrites && current && result.rewrites.map((r) => {
            const el = current.elements.find((e) => e.id === r.elementId);
            return <div key={r.elementId} className="issue info" style={{ flexDirection: 'column' }}><span className="diff-del">{el && (el.type === 'text' || el.type === 'shape') ? plainText(el.paragraphs) : ''}</span><span className="diff-add">{r.text}</span></div>;
          })}
          {result.notes !== undefined && <pre className="issue info" style={{ whiteSpace: 'pre-wrap', margin: 0, font: 'inherit' }}>{result.notes || 'Nothing to summarise on this slide.'}</pre>}
          {result.titles && <div className="row" style={{ flexWrap: 'wrap' }}>{result.titles.map((t) => <button key={t} className="btn ghost-strong" onClick={() => applyTitle(t)}>{t}</button>)}</div>}
          {result.suggestions && <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 300, overflow: 'auto' }}>{result.suggestions.map((s, i) => <div key={i} className="issue info"><Icon name="info" /><span>{s}</span></div>)}</div>}
          {(result.slides || result.rewrites || result.notes !== undefined) && (
            <div className="row"><span className="spacer" /><button className="btn" onClick={() => setResult(null)}>Discard</button><button className="btn primary" onClick={accept}>Accept proposal</button></div>
          )}
        </div>
      )}
    </Dialog>
  );
}

const SHORTCUTS: [string, string][] = [
  ['⌘K', 'Command palette'], ['⌘F', 'Find'], ['⇧⌘H', 'Find and replace'], ['⌘⏎', 'New slide / play (⇧ from start)'], ['⌘Z / ⇧⌘Z', 'Undo / redo'], ['⌘C ⌘X ⌘V', 'Copy, cut, paste'], ['⌘D', 'Duplicate'], ['⌫', 'Delete'],
  ['⌘G / ⇧⌘G', 'Group / ungroup'], ['⌘] / ⌘[', 'Forward / backward (⇧ front / back)'], ['Arrows', 'Nudge (⇧ ×10)'], ['⌘A', 'Select all'], ['Enter', 'Edit text'], ['Esc', 'Stop editing / deselect'],
  ['T R L', 'Text, shape, line tools'], ['Space + drag', 'Pan'], ['⌘ scroll / pinch', 'Zoom'], ['⌘0 / ⌘1', 'Fit / 100%'], ["⌘'", 'Grid'], ['⇧ drag', 'Constrain'], ['⌥ drag', 'Duplicate while dragging'], ['⌘ drag', 'Disable snapping'],
  ['⌘B ⌘I ⌘U', 'Bold, italic, underline'], ['Tab / ⇧Tab', 'Indent list level'], ['PgUp / PgDn', 'Previous / next slide'],
  ['In slideshow', '→ next · ← back · B black · W white · L laser · ⇧P pen · E erase · number+⏎ jump · F fullscreen'],
];

function Shortcuts({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Keyboard shortcuts" onClose={onClose} width={640}>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 18px' }}>
        {SHORTCUTS.map(([k, d]) => <Fragment key={k}><span className="kbd" style={{ justifySelf: 'start' }}>{k}</span><span>{d}</span></Fragment>)}
      </div>
    </Dialog>
  );
}

function History({ store, docId, serverId, onClose }: { store: EditorStore; docId: string; serverId: string | null; onClose: () => void }) {
  const [list, setList] = useState<(Version & { remote?: boolean })[]>([]);
  const [label, setLabel] = useState('');
  const load = async () => {
    const local = await listVersions(docId);
    let remote: (Version & { remote: boolean })[] = [];
    if (serverId) {
      try {
        remote = (await api<{ id: number; label: string; created_at: string }[]>(`/docs/${serverId}/versions`)).map((v) => ({ key: v.id, at: Date.parse(v.created_at), label: v.label, remote: true }));
      } catch { /* offline */ }
    }
    setList([...local, ...remote].sort((a, b) => b.at - a.at));
  };
  useEffect(() => { void load(); }, []);
  return (
    <Dialog title="Version history" onClose={onClose} width={560}>
      <div className="row">
        <input className="input" placeholder="Name this version (optional)" value={label} onChange={(e) => setLabel(e.target.value)} />
        <button className="btn primary" onClick={async () => {
          const l = label.trim() || new Date().toLocaleString();
          if (serverId) await api(`/docs/${serverId}/versions`, { body: { label: l } }).catch(() => saveVersion(docId, store.deck, l));
          else await saveVersion(docId, store.deck, l);
          setLabel('');
          await load();
          toast('Version saved');
        }}>Save version</button>
      </div>
      <p style={{ margin: 0, color: 'var(--muted)' }}>Restoring applies the old content as a new change — nothing is lost and it can be undone.</p>
      {!list.length && <div className="empty-state" style={{ height: 80 }}>No saved versions yet.</div>}
      {list.map((v) => (
        <div key={`${v.remote ? 'r' : 'l'}${v.key}`} className="row">
          <Icon name="history" /><span style={{ flex: 1 }}>{v.label}<br /><small style={{ color: 'var(--muted)' }}>{new Date(v.at).toLocaleString()} · {v.remote ? 'cloud' : 'this device'}</small></span>
          <button className="btn ghost-strong" onClick={async () => {
            if (v.remote && serverId) await api(`/docs/${serverId}/versions/${v.key}/restore`, { body: {} });
            else await restoreVersion(v.key, store.deck);
            toast('Version restored');
            onClose();
          }}>Restore</button>
        </div>
      ))}
    </Dialog>
  );
}

function Brand({ store, onClose }: { store: EditorStore; onClose: () => void }) {
  const { pres } = useEditor(store, (s) => s);
  const [t, setT] = useState<Theme>(structuredClone(pres.theme));
  const keys = Object.keys(t.colors) as (keyof Theme['colors'])[];
  const saveKit = () => {
    const kits = JSON.parse(localStorage.getItem('deck.brandkits') ?? '[]') as Theme[];
    localStorage.setItem('deck.brandkits', JSON.stringify([...kits.filter((k) => k.name !== t.name), { ...t, id: `kit-${Date.now()}` }].slice(-20)));
    toast(`Saved brand kit “${t.name}”`);
  };
  const kits = JSON.parse(localStorage.getItem('deck.brandkits') ?? '[]') as Theme[];
  return (
    <Dialog title="Brand kit & theme" onClose={onClose} width={620} footer={<><button className="btn" onClick={saveKit}>Save as brand kit</button><button className="btn primary" onClick={() => { store.update((p) => applyTheme(p, t)); onClose(); }}>Apply to presentation</button></>}>
      <label className="field"><span>Name</span><input className="input" value={t.name} onChange={(e) => setT({ ...t, name: e.target.value.slice(0, 60) })} /></label>
      <div className="grid4">
        {keys.map((k) => (
          <label key={k} className="field"><span>{k}</span><div className="row"><input type="color" value={t.colors[k].slice(0, 7)} onChange={(e) => setT({ ...t, colors: { ...t.colors, [k]: e.target.value } })} /><span className="label">{t.colors[k]}</span></div></label>
        ))}
      </div>
      <div className="grid2">
        <label className="field"><span>Heading font</span><select className="select" value={t.fonts.heading} onChange={(e) => setT({ ...t, fonts: { ...t.fonts, heading: e.target.value } })}>{FONT_FAMILIES.map((f) => <option key={f}>{f}</option>)}</select></label>
        <label className="field"><span>Body font</span><select className="select" value={t.fonts.body} onChange={(e) => setT({ ...t, fonts: { ...t.fonts, body: e.target.value } })}>{FONT_FAMILIES.map((f) => <option key={f}>{f}</option>)}</select></label>
      </div>
      <div style={{ padding: 20, borderRadius: 12, background: t.colors.background, color: t.colors.text }}>
        <div style={{ font: `700 28px "${t.fonts.heading}"` }}>Heading preview</div>
        <div style={{ font: `16px "${t.fonts.body}"`, color: t.colors.muted }}>Body text in the brand’s typeface.</div>
        <div className="row" style={{ marginTop: 10 }}>{[t.colors.accent, t.colors.accent2, t.colors.accent3, t.colors.accent4].map((c) => <span key={c} style={{ width: 28, height: 28, borderRadius: 7, background: c }} />)}</div>
      </div>
      {kits.length > 0 && (
        <>
          <div className="label">Saved brand kits</div>
          <div className="row" style={{ flexWrap: 'wrap' }}>{kits.map((k) => <button key={k.id} className="btn ghost-strong" onClick={() => setT(structuredClone(k))}>{k.name}</button>)}</div>
        </>
      )}
    </Dialog>
  );
}

interface DocActivity { at: string; action: string; actor: { name: string; email: string } | null; target: { name: string; email: string } | null; role?: string; hours?: number }

function describeActivity(a: DocActivity): string {
  const who = a.actor ? a.actor.name || a.actor.email : 'Someone';
  const whom = a.target ? a.target.name || a.target.email : 'a collaborator';
  switch (a.action) {
    case 'doc.create': return `${who} uploaded the presentation`;
    case 'member.add': return `${who} invited ${whom} as ${a.role ?? 'member'}`;
    case 'member.role': return `${who} changed ${whom} to ${a.role ?? 'a new role'}`;
    case 'member.remove': return `${who} removed ${whom}`;
    case 'link.create': return `${who} created a ${a.role ?? ''} link${a.hours ? ` (expires in ${a.hours < 48 ? `${a.hours} h` : `${Math.round(a.hours / 24)} days`})` : ' with no expiry'}`;
    case 'link.revoke': return `${who} revoked a share link`;
    case 'link.accept': return `${who} joined using a share link`;
    case 'version.restore': return `${who} restored an earlier version`;
    case 'sync.kick': return `A collaborator lost access and was disconnected`;
    default: return `${who}: ${a.action}`;
  }
}
