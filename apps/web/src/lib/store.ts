import { useSyncExternalStore } from 'react';
import { DeckDoc, expandToGroups, type Presentation, type Slide, type SlideElement } from '@deck/core';

export type Tool = 'select' | 'text' | 'shape' | 'line' | 'pan';
export type InspectorTab = 'design' | 'format' | 'animate' | 'review';
export type BottomTab = 'notes' | 'timeline' | null;

export interface UiState {
  slideId: string | null;
  selection: string[]; // element ids on the current slide
  slideSelection: string[]; // multi-select in the rail
  editingId: string | null; // text element being edited
  zoom: number; // 0 = fit
  fitZoom: number;
  tool: Tool;
  shapeKind: import('@deck/core').ShapeKind;
  inspector: InspectorTab;
  bottom: BottomTab;
  railMode: 'slides' | 'outline';
  showGrid: boolean;
  snap: boolean;
  animId: string | null;
  palette: boolean;
  dialog: null | 'import-report' | 'share' | 'ai' | 'shortcuts' | 'history' | 'export' | 'size' | 'brand';
  inspectorOpen: boolean;
  /** Format painter: the next click on an object applies this style (sticky keeps it armed). */
  painter: { style: import('@deck/core').StyleSnapshot; sticky: boolean } | null;
  /** Full-screen slide sorter. */
  sorter: boolean;
  /** Viewer/commenter roles: every document mutation is refused client-side (and server-side). */
  readOnly: boolean;
}

const initialUi: UiState = {
  slideId: null,
  selection: [],
  slideSelection: [],
  editingId: null,
  zoom: 0,
  fitZoom: 0.5,
  tool: 'select',
  shapeKind: 'rect',
  inspector: 'design',
  bottom: 'notes',
  railMode: 'slides',
  showGrid: false,
  snap: true,
  animId: null,
  palette: false,
  dialog: null,
  inspectorOpen: true,
  readOnly: false,
  painter: null,
  sorter: false,
};

type Listener = () => void;

/**
 * EditorStore — the single place the UI reads from and writes to.
 * Document state lives in a DeckDoc (Yjs). UI state is local.
 */
export class EditorStore {
  readonly deck: DeckDoc;
  ui: UiState = { ...initialUi };
  private listeners = new Set<Listener>();
  private snapshot: { pres: Presentation; ui: UiState };
  /** Coalesce key: consecutive commits with the same key merge into one undo step. */
  private lastKey: string | null = null;
  private lastKeyAt = 0;

  constructor(deck: DeckDoc) {
    this.deck = deck;
    this.snapshot = { pres: deck.presentation, ui: this.ui };
    deck.subscribe(() => {
      this.fixSelection();
      this.emit();
    });
    this.ui.slideId = deck.presentation.slides[0]?.id ?? null;
  }

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getSnapshot = () => this.snapshot;

  private emit() {
    this.snapshot = { pres: this.deck.presentation, ui: this.ui };
    for (const l of this.listeners) l();
  }

  get pres(): Presentation {
    return this.deck.presentation;
  }

  get slide(): Slide | undefined {
    return this.pres.slides.find((s) => s.id === this.ui.slideId) ?? this.pres.slides[0];
  }

  get selected(): SlideElement[] {
    const s = this.slide;
    if (!s) return [];
    const ids = new Set(this.ui.selection);
    return s.elements.filter((e) => ids.has(e.id));
  }

  setUi(patch: Partial<UiState>) {
    this.ui = { ...this.ui, ...patch };
    this.emit();
  }

  private fixSelection() {
    const s = this.slide;
    if (!s) {
      if (this.ui.slideId !== null) this.ui = { ...this.ui, slideId: this.pres.slides[0]?.id ?? null };
      return;
    }
    if (this.ui.slideId !== s.id) this.ui = { ...this.ui, slideId: s.id };
    const ids = new Set(s.elements.map((e) => e.id));
    const sel = this.ui.selection.filter((id) => ids.has(id));
    if (sel.length !== this.ui.selection.length || (this.ui.editingId && !ids.has(this.ui.editingId))) {
      this.ui = { ...this.ui, selection: sel, editingId: this.ui.editingId && ids.has(this.ui.editingId) ? this.ui.editingId : null };
    }
  }

  /**
   * Apply an immutable update to the presentation. `key` lets rapid
   * repeated edits (dragging, typing) collapse into a single undo step.
   */
  update(fn: (p: Presentation) => Presentation, key?: string) {
    if (this.ui.readOnly) return;
    const now = performance.now();
    if (!key || key !== this.lastKey || now - this.lastKeyAt > 800) this.deck.undo.stopCapturing();
    this.lastKey = key ?? null;
    this.lastKeyAt = now;
    const next = fn(this.pres);
    if (next !== this.pres) this.deck.commit(next);
  }

  updateSlide(slideId: string, fn: (s: Slide) => Slide, key?: string) {
    this.update((p) => ({ ...p, slides: p.slides.map((s) => (s.id === slideId ? fn(s) : s)) }), key);
  }

  updateElements(ids: Iterable<string>, fn: (e: SlideElement) => SlideElement, key?: string) {
    const set = new Set(ids);
    const sid = this.slide?.id;
    if (!sid || !set.size) return;
    this.updateSlide(sid, (s) => ({ ...s, elements: s.elements.map((e) => (set.has(e.id) ? fn(e) : e)) }), key);
  }

  select(ids: string[], additive = false) {
    const s = this.slide;
    if (!s) return;
    const base = additive ? new Set([...this.ui.selection, ...ids]) : new Set(ids);
    const expanded = expandToGroups(s, base);
    this.setUi({ selection: [...expanded], editingId: null, inspector: expanded.size ? (this.ui.inspector === 'design' ? 'format' : this.ui.inspector) : this.ui.inspector === 'format' ? 'design' : this.ui.inspector });
  }

  goToSlide(id: string) {
    if (id === this.ui.slideId) return;
    this.setUi({ slideId: id, selection: [], editingId: null, slideSelection: [id], animId: null });
  }

  undo() {
    this.deck.undo.undo();
  }
  redo() {
    this.deck.undo.redo();
  }
}

export function useEditor<T>(store: EditorStore, select: (s: { pres: Presentation; ui: UiState }) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(store.getSnapshot()));
}
