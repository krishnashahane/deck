import { useEffect, useMemo, useRef, useState } from 'react';
import { LAYOUTS, THEMES, applyTheme } from '@deck/core';
import type { EditorStore } from '../lib/store';
import { slideTitle } from '../render/SlideView';
import { Icon } from './icons';
import * as A from './actions';
import { SHAPE_KINDS } from '../render/shapes';

export interface Command {
  id: string;
  group: string;
  label: string;
  icon?: string;
  kbd?: string;
  run: () => void;
}

export function buildCommands(store: EditorStore, extra: Command[]): Command[] {
  const s = store;
  const cmds: Command[] = [
    { id: 'new-slide', group: 'Slides', label: 'New slide', icon: 'plus', kbd: '⌘⏎', run: () => A.addSlide(s) },
    { id: 'dup-slide', group: 'Slides', label: 'Duplicate slide', icon: 'copy', run: () => A.duplicateSlides(s) },
    { id: 'del-slide', group: 'Slides', label: 'Delete slide', icon: 'trash', run: () => A.deleteSlides(s) },
    { id: 'hide-slide', group: 'Slides', label: 'Hide / show slide', icon: 'eyeOff', run: () => A.toggleHidden(s) },
    { id: 'section', group: 'Slides', label: 'Add section here', icon: 'section', run: () => A.addSection(s) },
    ...LAYOUTS.map((l) => ({ id: `layout-${l.id}`, group: 'Layout', label: `Layout: ${l.name}`, icon: 'layout', run: () => A.setLayout(s, l.id) })),
    { id: 'text', group: 'Insert', label: 'Text box', icon: 'text', kbd: 'T', run: () => A.insertText(s) },
    ...SHAPE_KINDS.map((k) => ({ id: `shape-${k}`, group: 'Insert', label: `Shape: ${k}`, icon: 'shape', run: () => A.insertShape(s, k) })),
    { id: 'image', group: 'Insert', label: 'Image…', icon: 'image', run: async () => A.insertFiles(s, await A.pickFiles('image/*')) },
    { id: 'media', group: 'Insert', label: 'Video or audio…', icon: 'media', run: async () => A.insertFiles(s, await A.pickFiles('video/*,audio/*')) },
    { id: 'table', group: 'Insert', label: 'Table', icon: 'table', run: () => A.insertTable(s) },
    ...(['column', 'bar', 'line', 'area', 'pie', 'donut', 'scatter'] as const).map((k) => ({ id: `chart-${k}`, group: 'Insert', label: `Chart: ${k}`, icon: 'chart', run: () => A.insertChart(s, k) })),
    { id: 'equation', group: 'Insert', label: 'Equation', icon: 'equation', run: () => A.insertEquation(s) },
    { id: 'line', group: 'Insert', label: 'Line / connector', icon: 'line', kbd: 'L', run: () => s.setUi({ tool: 'line' }) },
    { id: 'arrow', group: 'Insert', label: 'Arrow', icon: 'arrow', run: () => A.insertLine(s, true) },
    { id: 'group', group: 'Arrange', label: 'Group', icon: 'group', kbd: '⌘G', run: () => A.groupSelection(s) },
    { id: 'ungroup', group: 'Arrange', label: 'Ungroup', icon: 'group', kbd: '⇧⌘G', run: () => A.ungroupSelection(s) },
    { id: 'front', group: 'Arrange', label: 'Bring to front', icon: 'front', kbd: '⇧⌘]', run: () => A.zorder(s, 'front') },
    { id: 'back', group: 'Arrange', label: 'Send to back', icon: 'back', kbd: '⇧⌘[', run: () => A.zorder(s, 'back') },
    ...(['left', 'center', 'right', 'top', 'middle', 'bottom'] as const).map((m) => ({ id: `align-${m}`, group: 'Arrange', label: `Align ${m}`, icon: 'aCenter', run: () => A.alignSelection(s, m) })),
    { id: 'dist-h', group: 'Arrange', label: 'Distribute horizontally', icon: 'distH', run: () => A.distributeSelection(s, 'h') },
    { id: 'dist-v', group: 'Arrange', label: 'Distribute vertically', icon: 'distV', run: () => A.distributeSelection(s, 'v') },
    ...THEMES.map((t) => ({ id: `theme-${t.id}`, group: 'Design', label: `Theme: ${t.name}`, icon: 'palette', run: () => s.update((p) => applyTheme(p, structuredClone(t))) })),
    { id: 'grid', group: 'View', label: 'Toggle grid', icon: 'grid', kbd: "⌘'", run: () => s.setUi({ showGrid: !s.ui.showGrid }) },
    { id: 'snap', group: 'View', label: 'Toggle smart guides & snapping', icon: 'fit', run: () => s.setUi({ snap: !s.ui.snap }) },
    { id: 'fit', group: 'View', label: 'Zoom to fit', icon: 'fit', kbd: '⌘0', run: () => s.setUi({ zoom: 0 }) },
    { id: 'z100', group: 'View', label: 'Zoom 100%', icon: 'search', kbd: '⌘1', run: () => s.setUi({ zoom: 1 }) },
    { id: 'outline', group: 'View', label: 'Outline view', icon: 'list', run: () => s.setUi({ railMode: s.ui.railMode === 'outline' ? 'slides' : 'outline' }) },
    { id: 'timeline', group: 'View', label: 'Animation timeline', icon: 'sparkle', run: () => s.setUi({ bottom: 'timeline' }) },
    { id: 'notes', group: 'View', label: 'Speaker notes', icon: 'comment', run: () => s.setUi({ bottom: 'notes' }) },
    { id: 'ai', group: 'Assistant', label: 'Open AI assistant…', icon: 'sparkle', run: () => s.setUi({ dialog: 'ai' }) },
    { id: 'review', group: 'Assistant', label: 'Review deck for issues', icon: 'check', run: () => s.setUi({ inspector: 'review', inspectorOpen: true }) },
    { id: 'shortcuts', group: 'Help', label: 'Keyboard shortcuts', icon: 'keyboard', kbd: '?', run: () => s.setUi({ dialog: 'shortcuts' }) },
    ...extra,
  ];
  s.pres.slides.forEach((sl, i) => cmds.push({ id: `go-${sl.id}`, group: 'Go to slide', label: `${i + 1}. ${slideTitle(sl)}`, icon: 'chevronR', run: () => s.goToSlide(sl.id) }));
  return cmds;
}

function score(label: string, q: string): number {
  const l = label.toLowerCase();
  if (!q) return 1;
  if (l.startsWith(q)) return 3;
  if (l.includes(q)) return 2;
  let i = 0;
  for (const ch of l) if (ch === q[i]) i++;
  return i === q.length ? 1 : 0;
}

export function Palette({ store, commands, onClose }: { store: EditorStore; commands: Command[]; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const results = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return commands.map((c) => ({ c, s: score(c.label, ql) + (score(c.group, ql) > 1 ? 0.5 : 0) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 60).map((x) => x.c);
  }, [q, commands]);
  useEffect(() => setIdx(0), [q]);
  const run = (c: Command) => {
    onClose();
    setTimeout(c.run, 0);
  };
  let lastGroup = '';
  void store;
  return (
    <div className="scrim" style={{ background: 'rgba(0,0,0,.25)', backdropFilter: 'none', display: 'block' }} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-label="Command palette">
        <input
          ref={input}
          placeholder="Type a command, layout, theme or slide…"
          aria-label="Search commands"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') onClose();
            if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(results.length - 1, i + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
            if (e.key === 'Enter' && results[idx]) run(results[idx]!);
          }}
        />
        <div className="results menu" style={{ position: 'static', boxShadow: 'none', animation: 'none', background: 'transparent' }} role="listbox">
          {!results.length && <div className="empty-state" style={{ height: 80 }}>No matching commands</div>}
          {results.map((c, i) => {
            const head = c.group !== lastGroup ? <div className="group">{c.group}</div> : null;
            lastGroup = c.group;
            return (
              <div key={c.id}>
                {head}
                <button className={`item ${i === idx ? 'active' : ''}`} role="option" aria-selected={i === idx} onMouseEnter={() => setIdx(i)} onClick={() => run(c)}>
                  {c.icon && <Icon name={c.icon} />}
                  <span>{c.label}</span>
                  {c.kbd && <span className="kbd">{c.kbd}</span>}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
