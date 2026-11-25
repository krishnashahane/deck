/**
 * DECK document model.
 *
 * Coordinates are slide units: 1 unit = 1 CSS pixel at 100% zoom.
 * The default slide is 1920 × 1080 (16:9). Conversions to EMU
 * (English Metric Units, 914400 per inch, 12700 per point) happen in the
 * file-format layer: 1 unit = 1/96 inch = 9525 EMU.
 */

export type Id = string;

export interface Presentation {
  id: Id;
  title: string;
  width: number;
  height: number;
  theme: Theme;
  slides: Slide[];
  /** Binary assets referenced by elements as `asset:<id>`. Bytes live in the Y.Doc. */
  assets: Record<Id, AssetMeta>;
  /** Import diagnostics: anything we could not represent is listed, never silently dropped. */
  importReport?: ImportReport;
}

export interface AssetMeta {
  id: Id;
  mime: string;
  name: string;
  size: number;
}

export interface ImportReport {
  source: string;
  warnings: ImportWarning[];
}

export interface ImportWarning {
  slide?: number;
  code: string;
  message: string;
}

export interface Theme {
  id: string;
  name: string;
  colors: ThemeColors;
  fonts: { heading: string; body: string; mono: string };
  /** Corner radius used by components, in slide units. */
  radius: number;
}

export interface ThemeColors {
  background: string;
  surface: string;
  text: string;
  muted: string;
  accent: string;
  accent2: string;
  accent3: string;
  accent4: string;
}

export type LayoutId = 'title' | 'title-content' | 'section' | 'two-column' | 'title-only' | 'big-number' | 'quote' | 'image-left' | 'blank';

export interface Slide {
  id: Id;
  layout: LayoutId;
  background: Fill | null; // null → theme background
  elements: SlideElement[];
  notes: string;
  hidden: boolean;
  section?: string;
  transition: Transition;
  animations: Animation[];
}

export type Fill =
  | { kind: 'solid'; color: string }
  | { kind: 'linear'; angle: number; stops: GradientStop[] }
  | { kind: 'radial'; stops: GradientStop[] }
  | { kind: 'image'; src: string; fit: 'cover' | 'contain' | 'stretch' }
  | { kind: 'none' };

export interface GradientStop {
  offset: number; // 0..1
  color: string;
}

export interface Stroke {
  color: string;
  width: number;
  dash: 'solid' | 'dash' | 'dot';
}

export interface Shadow {
  x: number;
  y: number;
  blur: number;
  color: string;
}

export type ElementType = 'text' | 'shape' | 'image' | 'line' | 'table' | 'chart' | 'media' | 'equation' | 'raw';

export interface BaseElement {
  id: Id;
  type: ElementType;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number; // degrees, clockwise
  opacity: number; // 0..1
  locked?: boolean;
  hidden?: boolean;
  groupId?: Id;
  link?: Hyperlink;
  /** Placeholder role inherited from a layout, if any. */
  placeholder?: 'title' | 'body' | 'subtitle';
}

export type Hyperlink = { kind: 'url'; url: string } | { kind: 'slide'; slideId: Id };

export type TextAlign = 'left' | 'center' | 'right' | 'justify';
export type VerticalAlign = 'top' | 'middle' | 'bottom';

export interface TextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string;
  size?: number; // points
  font?: string;
  highlight?: string;
  link?: string;
}

export interface Paragraph {
  runs: TextRun[];
  align?: TextAlign;
  bullet?: 'none' | 'bullet' | 'number';
  level?: number; // 0..8
  lineHeight?: number; // multiple, e.g. 1.2
  spaceBefore?: number; // points
  spaceAfter?: number; // points
}

export interface TextStyle {
  font: string;
  size: number; // points
  color: string;
  bold?: boolean;
  italic?: boolean;
  align: TextAlign;
  valign: VerticalAlign;
  lineHeight: number;
  letterSpacing: number; // em
  autofit: 'none' | 'shrink';
  padding: number;
  effect?: 'none' | 'shadow' | 'outline' | 'glow';
}

export interface TextElement extends BaseElement {
  type: 'text';
  paragraphs: Paragraph[];
  style: TextStyle;
  fill: Fill;
  stroke: Stroke | null;
}

export type ShapeKind =
  | 'rect'
  | 'roundRect'
  | 'ellipse'
  | 'triangle'
  | 'diamond'
  | 'pentagon'
  | 'hexagon'
  | 'star'
  | 'arrowRight'
  | 'chevron'
  | 'speech'
  | 'cloud'
  | 'heart'
  | 'plus';

export interface ShapeElement extends BaseElement {
  type: 'shape';
  shape: ShapeKind;
  fill: Fill;
  stroke: Stroke | null;
  shadow: Shadow | null;
  cornerRadius: number;
  paragraphs: Paragraph[];
  style: TextStyle;
}

export interface Crop {
  left: number; // fractions 0..1 of the source
  top: number;
  right: number;
  bottom: number;
}

export interface ImageElement extends BaseElement {
  type: 'image';
  src: string; // asset:<id> or data URL
  alt: string;
  crop: Crop;
  mask: 'none' | 'circle' | 'rounded';
  stroke: Stroke | null;
  shadow: Shadow | null;
}

export interface LineElement extends BaseElement {
  type: 'line';
  /** Endpoints in slide units, absolute. x/y/w/h is the bounding box (kept in sync). */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke: Stroke;
  startArrow: 'none' | 'arrow' | 'dot';
  endArrow: 'none' | 'arrow' | 'dot';
  /** Connector endpoints attached to elements; the line follows them. */
  from?: Id;
  to?: Id;
  curve: 'straight' | 'elbow' | 'curved';
}

export interface TableCell {
  text: string;
  bold?: boolean;
  fill?: string;
  color?: string;
  align?: TextAlign;
}

export interface TableElement extends BaseElement {
  type: 'table';
  rows: TableCell[][];
  colWidths: number[]; // fractions summing to 1
  headerRow: boolean;
  bandedRows: boolean;
  style: { font: string; size: number; color: string; border: string; headerFill: string; bandFill: string };
}

export type ChartKind = 'bar' | 'column' | 'line' | 'area' | 'pie' | 'donut' | 'scatter';

export interface ChartSeries {
  name: string;
  values: number[];
  color?: string;
}

export interface ChartElement extends BaseElement {
  type: 'chart';
  chart: ChartKind;
  categories: string[];
  series: ChartSeries[];
  title: string;
  legend: boolean;
  dataLabels: boolean;
  style: { font: string; color: string; grid: string };
}

export interface MediaElement extends BaseElement {
  type: 'media';
  kind: 'video' | 'audio';
  src: string;
  poster?: string;
  autoplay: boolean;
  loop: boolean;
  muted: boolean;
}

export interface EquationElement extends BaseElement {
  type: 'equation';
  latex: string;
  color: string;
  size: number; // points
}

/** Content we imported but cannot edit. Rendered as a labelled placeholder; preserved for export when self-contained. */
export interface RawElement extends BaseElement {
  type: 'raw';
  format: 'ooxml';
  xml: string;
  reason: string;
}

export type SlideElement =
  | TextElement
  | ShapeElement
  | ImageElement
  | LineElement
  | TableElement
  | ChartElement
  | MediaElement
  | EquationElement
  | RawElement;

export type TransitionKind = 'none' | 'fade' | 'push' | 'wipe' | 'cover' | 'zoom' | 'split' | 'flip' | 'smart-move';

export interface Transition {
  kind: TransitionKind;
  duration: number; // ms
  direction: 'left' | 'right' | 'up' | 'down';
  /** Auto-advance after N ms (0 = on click). */
  advanceAfter: number;
}

export type AnimationClass = 'entrance' | 'exit' | 'emphasis' | 'motion';

export type AnimationEffect =
  | 'appear'
  | 'fade'
  | 'fly'
  | 'zoom'
  | 'wipe'
  | 'rise'
  | 'blur'
  | 'pulse'
  | 'spin'
  | 'grow'
  | 'shake'
  | 'color'
  | 'path';

export interface Animation {
  id: Id;
  elementId: Id;
  class: AnimationClass;
  effect: AnimationEffect;
  /** click = new step; with = starts with previous; after = starts when previous ends. */
  trigger: 'click' | 'with' | 'after';
  delay: number; // ms
  duration: number; // ms
  direction: 'left' | 'right' | 'up' | 'down';
  easing: 'linear' | 'ease' | 'ease-in' | 'ease-out' | 'spring';
  /** Motion path in slide units relative to the element origin (motion class). */
  path?: { x: number; y: number }[];
  /** Optional trigger element: animation starts when this element is clicked. */
  triggerElementId?: Id;
}

export const SLIDE_PRESETS = {
  '16:9': { width: 1920, height: 1080 },
  '4:3': { width: 1440, height: 1080 },
  '16:10': { width: 1920, height: 1200 },
  'A4 portrait': { width: 1123, height: 1587 },
  '9:16 portrait': { width: 1080, height: 1920 },
  square: { width: 1080, height: 1080 },
} as const;

export const EMU_PER_UNIT = 9525;
export const UNITS_PER_POINT = 96 / 72;
