import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons';

/** Popover anchored to a trigger; closes on outside click or Escape. Keyboard: arrows move between items. */
export function Popover({ trigger, children, align = 'start', width }: { trigger: (open: () => void, isOpen: boolean) => ReactNode; children: (close: () => void) => ReactNode; align?: 'start' | 'end' | 'center'; width?: number }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  useLayoutEffect(() => {
    if (!open || !anchor.current) return;
    const r = anchor.current.getBoundingClientRect();
    const mw = menu.current?.offsetWidth ?? width ?? 220;
    const mh = menu.current?.offsetHeight ?? 200;
    let x = align === 'end' ? r.right - mw : align === 'center' ? r.left + r.width / 2 - mw / 2 : r.left;
    let y = r.bottom + 6;
    x = Math.max(8, Math.min(window.innerWidth - mw - 8, x));
    if (y + mh > window.innerHeight - 8) y = Math.max(8, r.top - mh - 6);
    setPos({ x, y });
  }, [open, align, width]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (menu.current?.contains(e.target as Node) || anchor.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const items = Array.from(menu.current?.querySelectorAll<HTMLElement>('.item, button') ?? []);
        const i = items.indexOf(document.activeElement as HTMLElement);
        const n = items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
        n?.focus();
        e.preventDefault();
      }
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <>
      <span ref={anchor} style={{ display: 'inline-flex' }}>{trigger(() => setOpen((o) => !o), open)}</span>
      {open && createPortal(
        <div ref={menu} className="menu" role="menu" style={{ left: pos.x, top: pos.y, width }} onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); e.stopPropagation(); }}>
          {children(() => setOpen(false))}
        </div>,
        document.body,
      )}
    </>
  );
}

export function MenuItem({ icon, label, kbd, onClick, active, danger }: { icon?: string; label: ReactNode; kbd?: string; onClick: () => void; active?: boolean; danger?: boolean }) {
  return (
    <button className={`item ${active ? 'active' : ''}`} role="menuitem" onClick={onClick} style={danger ? { color: 'var(--danger)' } : undefined}>
      {icon && <Icon name={icon} />}
      <span>{label}</span>
      {kbd && <span className="kbd">{kbd}</span>}
    </button>
  );
}

const EXTRA = ['#FFFFFF', '#000000', '#6B7280', '#EF4444', '#F97316', '#EAB308', '#22C55E', '#14B8A6', '#3B82F6', '#8B5CF6', '#EC4899', '#00000000'];

export function ColorPicker({ value, palette, onChange, label = 'Color', allowNone }: { value: string | undefined; palette: string[]; onChange: (c: string) => void; label?: string; allowNone?: boolean }) {
  const [hex, setHex] = useState(value ?? '');
  useEffect(() => setHex(value ?? ''), [value]);
  return (
    <Popover
      width={236}
      trigger={(open) => (
        <button className="swatch" aria-label={`${label}: ${value ?? 'none'}`} title={label} onClick={open} style={{ background: value && value !== 'none' ? value : 'repeating-conic-gradient(#888 0 25%, transparent 0 50%) 50% / 8px 8px' }} />
      )}
    >
      {(close) => (
        <div style={{ padding: 6, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="label">Theme</div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {palette.map((c) => <button key={c} className={`swatch ${c.toLowerCase() === value?.toLowerCase() ? 'on' : ''}`} style={{ background: c }} aria-label={c} onClick={() => { onChange(c); close(); }} />)}
          </div>
          <div className="label">Standard</div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {EXTRA.filter((c) => allowNone || c !== '#00000000').map((c) => <button key={c} className={`swatch ${c === value ? 'on' : ''}`} style={{ background: c === '#00000000' ? 'repeating-conic-gradient(#888 0 25%, transparent 0 50%) 50% / 8px 8px' : c }} aria-label={c === '#00000000' ? 'None' : c} onClick={() => { onChange(c); close(); }} />)}
          </div>
          <div className="row">
            <input type="color" aria-label="Custom colour" value={/^#[0-9a-f]{6}/i.test(hex) ? hex.slice(0, 7) : '#000000'} onChange={(e) => { setHex(e.target.value); onChange(e.target.value); }} />
            <input className="input num" aria-label="Hex colour" value={hex} onChange={(e) => setHex(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hex)) { onChange(hex); close(); } }} />
          </div>
        </div>
      )}
    </Popover>
  );
}

/** Numeric field that commits on Enter/blur and supports arrow-key and drag-scrub adjustment. */
export function NumberField({ value, onChange, label, step = 1, min, max, suffix, width }: { value: number; onChange: (v: number) => void; label: string; step?: number; min?: number; max?: number; suffix?: string; width?: number }) {
  const [text, setText] = useState(fmt(value));
  useEffect(() => setText(fmt(value)), [value]);
  const clamp = (v: number) => Math.max(min ?? -Infinity, Math.min(max ?? Infinity, v));
  const commit = () => {
    const v = Number(text);
    if (Number.isFinite(v)) onChange(clamp(v));
    else setText(fmt(value));
  };
  return (
    <label className="field" style={{ width }}>
      <span
        style={{ cursor: 'ew-resize', userSelect: 'none' }}
        onPointerDown={(e) => {
          const start = e.clientX, v0 = value;
          const move = (ev: PointerEvent) => onChange(clamp(Math.round((v0 + ((ev.clientX - start) / 2) * step) / step) * step));
          const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
        }}
      >
        {label}
      </span>
      <div style={{ position: 'relative' }}>
        <input
          className="input num"
          inputMode="decimal"
          aria-label={label}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') commit();
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              onChange(clamp(value + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1)));
            }
          }}
        />
        {suffix && <span style={{ position: 'absolute', right: 8, top: 7, color: 'var(--faint)', fontSize: 11, pointerEvents: 'none' }}>{suffix}</span>}
      </div>
    </label>
  );
}

function fmt(v: number): string {
  return String(Math.round(v * 100) / 100);
}

export function Dialog({ title, onClose, children, footer, width }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // Runs once per dialog: focus the first control, restore focus on close.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input, textarea, select, button')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, []);
  return createPortal(
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="dialog" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} style={width ? { width: `min(${width}px, calc(100vw - 32px))` } : undefined} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); e.stopPropagation(); }}>
        <header>
          <h2>{title}</h2>
          <span className="spacer" />
          <button className="btn icon" aria-label="Close" onClick={onClose}><Icon name="close" /></button>
        </header>
        <div className="body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
