import { FONT_FAMILIES, safeHref, themePalette, type Paragraph, type SlideElement, type TextStyle } from '@deck/core';
import { useEditor, type EditorStore } from '../lib/store';
import { Icon } from './icons';
import { ColorPicker, Popover, MenuItem } from './ui';
import { deleteSelection, duplicateSelection, groupSelection, ungroupSelection, zorder } from './actions';
import { selectedBlocks } from './richtext';
import { toast } from '../lib/toast';

type TextEl = Extract<SlideElement, { type: 'text' | 'shape' }>;

let savedRange: Range | null = null;

function editorEl(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-text-editor]');
}

function exec(cmd: string, value?: string) {
  const ed = editorEl();
  if (!ed) return;
  ed.focus();
  document.execCommand('styleWithCSS', false, 'true');
  document.execCommand(cmd, false, value);
  ed.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Wrap the current selection in a span with inline style (for size/font, which execCommand handles poorly). */
function wrapStyle(css: Partial<CSSStyleDeclaration>) {
  const ed = editorEl();
  const sel = window.getSelection();
  if (!ed || !sel || !sel.rangeCount) return;
  const r = sel.getRangeAt(0);
  if (r.collapsed) return;
  const span = document.createElement('span');
  Object.assign(span.style, css);
  span.appendChild(r.extractContents());
  // Clear the same property on nested spans so the new value wins.
  span.querySelectorAll<HTMLElement>('span').forEach((s) => Object.keys(css).forEach((k) => s.style.removeProperty(k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()))));
  r.insertNode(span);
  sel.removeAllRanges();
  const nr = document.createRange();
  nr.selectNodeContents(span);
  sel.addRange(nr);
  ed.dispatchEvent(new Event('input', { bubbles: true }));
}

function setBlockAttr(fn: (p: HTMLElement) => void) {
  const ed = editorEl();
  if (!ed) return;
  selectedBlocks(ed).forEach(fn);
  ed.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Apply a run-level property to every run of the element (when not in text editing mode). */
function mapRuns(ps: Paragraph[], fn: (r: Paragraph['runs'][number]) => Paragraph['runs'][number]) {
  return ps.map((p) => ({ ...p, runs: p.runs.map(fn) }));
}

export function ContextBar({ store, anchor, hostHeight }: { store: EditorStore; anchor: { x: number; y: number; w: number; h: number }; hostHeight: number }) {
  const { pres, ui } = useEditor(store, (s) => s);
  const slide = pres.slides.find((s) => s.id === ui.slideId);
  if (!slide) return null;
  const sel = slide.elements.filter((e) => ui.selection.includes(e.id));
  if (!sel.length) return null;
  const editing = Boolean(ui.editingId);
  const texts = sel.filter((e): e is TextEl => e.type === 'text' || e.type === 'shape');
  const first = texts[0];
  const palette = themePalette(pres.theme);
  const ids = texts.map((t) => t.id);

  const setStyle = (patch: Partial<TextStyle>, runKey?: keyof Paragraph['runs'][number]) =>
    store.updateElements(ids, (e) => (e.type === 'text' || e.type === 'shape' ? { ...e, style: { ...e.style, ...patch }, paragraphs: runKey ? mapRuns(e.paragraphs, (r) => ({ ...r, [runKey]: undefined })) : e.paragraphs } : e));
  const setPara = (patch: Partial<Paragraph>) => store.updateElements(ids, (e) => (e.type === 'text' || e.type === 'shape' ? { ...e, paragraphs: e.paragraphs.map((p) => ({ ...p, ...patch })) } : e));

  const toggle = (cmd: 'bold' | 'italic' | 'underline' | 'strikeThrough') => {
    if (editing) return exec(cmd);
    if (!first) return;
    if (cmd === 'bold') setStyle({ bold: !first.style.bold }, 'bold');
    else if (cmd === 'italic') setStyle({ italic: !first.style.italic }, 'italic');
    else {
      const key = cmd === 'underline' ? 'underline' : 'strike';
      const on = !first.paragraphs.every((p) => p.runs.every((r) => r[key]));
      store.updateElements(ids, (e) => (e.type === 'text' || e.type === 'shape' ? { ...e, paragraphs: mapRuns(e.paragraphs, (r) => ({ ...r, [key]: on || undefined })) } : e));
    }
  };
  const align = (a: TextStyle['align']) => (editing ? setBlockAttr((p) => { p.style.textAlign = a; p.setAttribute('data-align', a); }) : (setStyle({ align: a }), setPara({ align: undefined })));
  const list = (kind: 'bullet' | 'number') => {
    if (editing) return setBlockAttr((p) => p.setAttribute('data-bullet', p.getAttribute('data-bullet') === kind ? 'none' : kind));
    const all = first?.paragraphs.every((p) => p.bullet === kind);
    setPara({ bullet: all ? 'none' : kind });
  };
  const indent = (d: number) => {
    if (editing) return setBlockAttr((p) => p.setAttribute('data-level', String(Math.max(0, Math.min(8, Number(p.getAttribute('data-level') ?? 0) + d)))));
    store.updateElements(ids, (e) => (e.type === 'text' || e.type === 'shape' ? { ...e, paragraphs: e.paragraphs.map((p) => ({ ...p, level: Math.max(0, Math.min(8, (p.level ?? 0) + d)) || undefined })) } : e));
  };
  const setColor = (c: string) => (editing ? exec('foreColor', c) : setStyle({ color: c }, 'color'));
  const setFont = (f: string) => (editing ? wrapStyle({ fontFamily: `"${f}"` }) : setStyle({ font: f }, 'font'));
  const setSize = (n: number) => {
    if (!Number.isFinite(n) || n <= 0) return;
    n = Math.min(800, n);
    if (editing) wrapStyle({ fontSize: `${n * (96 / 72)}px` });
    else setStyle({ size: n }, 'size');
  };
  const link = (url: string) => {
    if (!url) return;
    if (editing && savedRange) {
      editorEl()?.focus();
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(savedRange);
    }
    const safe = safeHref(url.includes(':') ? url : `https://${url}`);
    if (!safe) return toast('Only http, https and mailto links are allowed');
    if (editing) {
      const ed = editorEl();
      const s = window.getSelection();
      if (!ed || !s || s.isCollapsed) return toast('Select text to link');
      wrapStyle({ textDecoration: 'underline' });
      const span = s.anchorNode?.parentElement?.closest('span');
      span?.setAttribute('data-link', safe);
      ed.dispatchEvent(new Event('input', { bubbles: true }));
    } else store.updateElements(ui.selection, (e) => ({ ...e, link: { kind: 'url', url: safe } }));
  };

  const top = anchor.y - 50 < 0 ? Math.min(hostHeight - 10, anchor.y + anchor.h + 12) : anchor.y - 50;
  const fillable = sel.filter((e) => e.type === 'shape' || e.type === 'text');
  const fillVal = fillable[0] && (fillable[0].type === 'shape' || fillable[0].type === 'text') && fillable[0].fill.kind === 'solid' ? fillable[0].fill.color : undefined;
  const locked = sel.every((e) => e.locked);

  return (
    <div className="ctx-bar" style={{ left: Math.max(0, anchor.x + anchor.w / 2), top, transform: 'translateX(-50%)' }} onPointerDown={(e) => { e.stopPropagation(); if ((e.target as HTMLElement).tagName !== 'SELECT' && (e.target as HTMLElement).tagName !== 'INPUT') e.preventDefault(); }} role="toolbar" aria-label="Formatting">
      {first && (
        <>
          <select aria-label="Font" value={first.style.font} onChange={(e) => setFont(e.target.value)} style={{ fontFamily: `"${first.style.font}"` }}>
            {[...new Set([first.style.font, ...FONT_FAMILIES])].map((f) => <option key={f} value={f} style={{ fontFamily: `"${f}"` }}>{f.replace(' Variable', '')}</option>)}
          </select>
          <input className="size" aria-label="Font size" defaultValue={first.style.size} key={`${first.id}:${first.style.size}`} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') setSize(Number((e.target as HTMLInputElement).value)); }} onBlur={(e) => setSize(Number(e.target.value))} />
          <span className="sep" />
          <button className={`btn icon ${!editing && first.style.bold ? 'on' : ''}`} aria-label="Bold" title="Bold ⌘B" onClick={() => toggle('bold')}><Icon name="bold" /></button>
          <button className={`btn icon ${!editing && first.style.italic ? 'on' : ''}`} aria-label="Italic" title="Italic ⌘I" onClick={() => toggle('italic')}><Icon name="italic" /></button>
          <button className="btn icon" aria-label="Underline" title="Underline ⌘U" onClick={() => toggle('underline')}><Icon name="underline" /></button>
          <button className="btn icon" aria-label="Strikethrough" onClick={() => toggle('strikeThrough')}><Icon name="strike" /></button>
          <span style={{ padding: '0 4px', display: 'inline-flex' }}><ColorPicker label="Text colour" value={first.style.color} palette={palette} onChange={setColor} /></span>
          <span className="sep" />
          <Popover trigger={(open) => <button className="btn icon" aria-label="Alignment" onClick={open}><Icon name={first.style.align === 'center' ? 'alignC' : first.style.align === 'right' ? 'alignR' : first.style.align === 'justify' ? 'alignJ' : 'alignL'} /></button>}>
            {(close) => (
              <>
                {(['left', 'center', 'right', 'justify'] as const).map((a) => <MenuItem key={a} icon={a === 'center' ? 'alignC' : a === 'right' ? 'alignR' : a === 'justify' ? 'alignJ' : 'alignL'} label={a[0]!.toUpperCase() + a.slice(1)} onClick={() => { align(a); close(); }} />)}
                <hr />
                {(['top', 'middle', 'bottom'] as const).map((v) => <MenuItem key={v} icon={v === 'top' ? 'aTop' : v === 'middle' ? 'aMiddle' : 'aBottom'} label={`Vertical ${v}`} active={first.style.valign === v} onClick={() => { setStyle({ valign: v }); close(); }} />)}
              </>
            )}
          </Popover>
          <button className="btn icon" aria-label="Bulleted list" onClick={() => list('bullet')}><Icon name="bullets" /></button>
          <button className="btn icon" aria-label="Numbered list" onClick={() => list('number')}><Icon name="numbers" /></button>
          <button className="btn icon" aria-label="Decrease indent" onClick={() => indent(-1)}><Icon name="outdent" /></button>
          <button className="btn icon" aria-label="Increase indent" onClick={() => indent(1)}><Icon name="indent" /></button>
          <Popover width={300} trigger={(open) => <button className="btn icon" aria-label="Insert link" onClick={() => { const sel = window.getSelection(); savedRange = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null; open(); }}><Icon name="link" /></button>}>
            {(close) => (
              <form style={{ padding: 6, display: 'flex', gap: 6 }} onSubmit={(e) => { e.preventDefault(); link(String(new FormData(e.currentTarget).get('url') ?? '')); close(); }}>
                <input name="url" className="input" autoFocus placeholder="https://example.com" aria-label="Link address" onKeyDown={(e) => e.stopPropagation()} />
                <button className="btn primary" type="submit">Link</button>
              </form>
            )}
          </Popover>
          {!editing && <span className="sep" />}
        </>
      )}
      {!editing && (
        <>
          {fillable.length > 0 && (
            <span style={{ padding: '0 4px', display: 'inline-flex' }}>
              <ColorPicker label="Fill" allowNone value={fillVal ?? '#00000000'} palette={palette} onChange={(c) => store.updateElements(fillable.map((f) => f.id), (e) => (e.type === 'shape' || e.type === 'text' ? { ...e, fill: c === '#00000000' ? { kind: 'none' } : { kind: 'solid', color: c } } : e))} />
            </span>
          )}
          {sel.length > 1 && <button className="btn icon" aria-label="Group" title="Group ⌘G" onClick={() => groupSelection(store)}><Icon name="group" /></button>}
          {sel.some((e) => e.groupId) && <button className="btn" onClick={() => ungroupSelection(store)}>Ungroup</button>}
          <Popover align="end" trigger={(open) => <button className="btn icon" aria-label="More" onClick={open}><Icon name="more" /></button>}>
            {(close) => (
              <>
                <MenuItem icon="front" label="Bring to front" kbd="⇧⌘]" onClick={() => { zorder(store, 'front'); close(); }} />
                <MenuItem icon="front" label="Bring forward" kbd="⌘]" onClick={() => { zorder(store, 'forward'); close(); }} />
                <MenuItem icon="back" label="Send backward" kbd="⌘[" onClick={() => { zorder(store, 'backward'); close(); }} />
                <MenuItem icon="back" label="Send to back" kbd="⇧⌘[" onClick={() => { zorder(store, 'back'); close(); }} />
                <hr />
                <MenuItem icon="copy" label="Duplicate" kbd="⌘D" onClick={() => { duplicateSelection(store); close(); }} />
                <MenuItem icon={locked ? 'unlock' : 'lock'} label={locked ? 'Unlock' : 'Lock'} kbd="⇧⌘L" onClick={() => { store.updateElements(ui.selection, (e) => ({ ...e, locked: !locked || undefined })); close(); }} />
                <MenuItem icon="sparkle" label="Animate…" onClick={() => { store.setUi({ inspector: 'animate', inspectorOpen: true }); close(); }} />
                <hr />
                <MenuItem icon="trash" label="Delete" kbd="⌫" danger onClick={() => { deleteSelection(store); close(); }} />
              </>
            )}
          </Popover>
        </>
      )}
    </div>
  );
}
