import { useEffect, useState } from 'react';
import { useEditor, type EditorStore } from '../lib/store';
import { api } from '../lib/api';
import { Icon } from './icons';
import { toast } from '../lib/toast';

interface Comment { id: string; slide_id: string; element_id: string | null; parent_id: string | null; body: string; resolved: boolean; author_name: string; author_id: string; created_at: string }

/** Comment threads for cloud documents (commenter role and above may post; viewers can read). */
export function Comments({ store, serverId, role }: { store: EditorStore; serverId: string; role: string }) {
  const { ui } = useEditor(store, (s) => s);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Comment[]>([]);
  const [text, setText] = useState('');
  const [reply, setReply] = useState<Record<string, string>>({});
  const [showResolved, setShowResolved] = useState(false);
  const load = async () => {
    try { setItems(await api<Comment[]>(`/docs/${serverId}/comments`)); } catch { /* offline */ }
  };
  useEffect(() => {
    void load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId]);
  const canPost = role !== 'viewer';
  const roots = items.filter((c) => !c.parent_id && c.slide_id === ui.slideId && (showResolved || !c.resolved));
  const open_ = items.filter((c) => !c.parent_id && !c.resolved).length;
  const post = async (body: string, parentId?: string) => {
    if (!body.trim()) return;
    try {
      await api(`/docs/${serverId}/comments`, { body: { slideId: ui.slideId, elementId: ui.selection[0] ?? null, parentId: parentId ?? null, body: body.slice(0, 5000) } });
      await load();
    } catch (e) { toast((e as Error).message); }
  };
  return (
    <>
      <button className="btn ghost-strong" style={{ position: 'fixed', right: ui.inspectorOpen ? 320 : 16, top: 64, zIndex: 40, background: 'var(--panel)' }} onClick={() => setOpen(!open)}>
        <Icon name="comment" />Comments{open_ ? <span className="pill">{open_}</span> : null}
      </button>
      {open && (
        <div className="menu" style={{ position: 'fixed', right: ui.inspectorOpen ? 320 : 16, top: 104, width: 340, maxHeight: '70vh', overflow: 'auto', zIndex: 40 }} onKeyDown={(e) => e.stopPropagation()}>
          <div className="row" style={{ padding: '4px 6px' }}><b>This slide</b><span className="spacer" /><label className="row label"><input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />Resolved</label></div>
          {!roots.length && <div className="label" style={{ padding: 8 }}>No comments on this slide.</div>}
          {roots.map((c) => (
            <div key={c.id} style={{ padding: 8, borderRadius: 8, background: 'var(--raised-2)', margin: '6px 4px', opacity: c.resolved ? 0.6 : 1 }}>
              <div className="row"><b>{c.author_name}</b><span className="label">{new Date(c.created_at).toLocaleString()}</span><span className="spacer" />
                {canPost && <button className="btn icon" title={c.resolved ? 'Reopen' : 'Resolve'} aria-label="Resolve" onClick={async () => { await api(`/docs/${serverId}/comments/${c.id}`, { method: 'PATCH', body: { resolved: !c.resolved } }); await load(); }}><Icon name="check" /></button>}
              </div>
              <div style={{ whiteSpace: 'pre-wrap', margin: '4px 0' }}>{c.body}</div>
              {c.element_id && <button className="btn" style={{ height: 22, fontSize: 11 }} onClick={() => store.select([c.element_id!])}>Show object</button>}
              {items.filter((r) => r.parent_id === c.id).map((r) => <div key={r.id} style={{ borderLeft: '2px solid var(--line-strong)', paddingLeft: 8, marginTop: 6 }}><b>{r.author_name}</b> <span style={{ whiteSpace: 'pre-wrap' }}>{r.body}</span></div>)}
              {canPost && <div className="row" style={{ marginTop: 6 }}><input className="input" placeholder="Reply" value={reply[c.id] ?? ''} onChange={(e) => setReply({ ...reply, [c.id]: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') { void post(reply[c.id] ?? '', c.id); setReply({ ...reply, [c.id]: '' }); } }} /></div>}
            </div>
          ))}
          {canPost && (
            <div style={{ padding: 6 }}>
              <textarea className="input" rows={2} placeholder={ui.selection.length ? 'Comment on the selected object' : 'Comment on this slide'} value={text} onChange={(e) => setText(e.target.value)} />
              <button className="btn primary" style={{ marginTop: 6 }} disabled={!text.trim()} onClick={() => { void post(text); setText(''); }}>Comment</button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
