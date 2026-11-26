import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons';

export type MenuEntry =
  | { label: string; icon?: string; kbd?: string; run: () => void; disabled?: boolean; danger?: boolean }
  | 'sep';

/**
 * Right-click menu. Opens at the pointer, stays inside the viewport, and follows the
 * WAI-ARIA menu pattern: arrow keys / Home / End move, Enter activates, Escape and
 * outside clicks close, focus returns to where it was.
 */
export function ContextMenu({ x, y, items, onClose, label = 'Context menu' }: { x: number; y: number; items: MenuEntry[]; onClose: () => void; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    setPos({ x: Math.max(8, Math.min(x, window.innerWidth - w - 8)), y: Math.max(8, Math.min(y, window.innerHeight - h - 8)) });
  }, [x, y]);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
    const away = (e: Event) => { if (!ref.current?.contains(e.target as Node)) closeRef.current(); };
    const blur = () => closeRef.current();
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('wheel', away, true);
    window.addEventListener('blur', blur);
    window.addEventListener('resize', blur);
    return () => {
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('wheel', away, true);
      window.removeEventListener('blur', blur);
      window.removeEventListener('resize', blur);
      prev?.focus?.();
    };
  }, []);

  const onKey = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    const all = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])];
    const i = all.indexOf(document.activeElement as HTMLElement);
    const focus = (n: number) => { e.preventDefault(); all[(n + all.length) % all.length]?.focus(); };
    if (e.key === 'ArrowDown') focus(i + 1);
    else if (e.key === 'ArrowUp') focus(i - 1);
    else if (e.key === 'Home') focus(0);
    else if (e.key === 'End') focus(all.length - 1);
    else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); onClose(); }
  };

  return createPortal(
    <div ref={ref} className="menu ctx-menu" role="menu" aria-label={label} style={{ left: pos.x, top: pos.y }} onKeyDown={onKey} onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, i) =>
        it === 'sep' ? (
          <hr key={i} />
        ) : (
          <button key={i} type="button" role="menuitem" className="item" disabled={it.disabled} style={it.danger ? { color: 'var(--danger)' } : undefined}
            onClick={() => { onClose(); it.run(); }}>
            {it.icon ? <Icon name={it.icon} /> : <span style={{ width: 16 }} />}
            <span>{it.label}</span>
            {it.kbd && <span className="kbd">{it.kbd}</span>}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}

/** Drop leading/trailing/duplicate separators left after filtering. */
export function tidy(items: (MenuEntry | false | null | undefined)[]): MenuEntry[] {
  const out: MenuEntry[] = [];
  for (const it of items) {
    if (!it) continue;
    if (it === 'sep' && (out.length === 0 || out[out.length - 1] === 'sep')) continue;
    out.push(it);
  }
  while (out[out.length - 1] === 'sep') out.pop();
  return out;
}
