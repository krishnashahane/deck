import type { Animation, Slide, SlideElement } from './model';

/**
 * Animation sequencing.
 *
 * A slide's animations form an ordered list. `click` starts a new step;
 * `with` starts at the same time as the previous animation; `after` starts
 * when the previous animation ends. Each step is a set of scheduled
 * animations with absolute offsets (ms) from the start of the step.
 */
export interface ScheduledAnimation {
  anim: Animation;
  start: number; // ms from step start, includes delay
  end: number;
}

export interface Step {
  /** Element whose click triggers this step (interactive trigger), if any. */
  triggerElementId?: string;
  items: ScheduledAnimation[];
  duration: number;
}

export function buildSteps(slide: Pick<Slide, 'animations'>): { auto: Step | null; steps: Step[] } {
  const steps: Step[] = [];
  let auto: Step | null = null;
  let cur: Step | null = null;
  let prevStart = 0;
  let prevEnd = 0;
  slide.animations.forEach((a, i) => {
    const isClick = a.trigger === 'click';
    const startsNew = isClick || i === 0;
    if (startsNew) {
      cur = { items: [], duration: 0, triggerElementId: isClick ? a.triggerElementId : undefined };
      if (isClick) steps.push(cur);
      else auto = cur; // first animation is with/after-previous: plays automatically on slide entry
      prevStart = 0;
      prevEnd = 0;
    }
    const base = startsNew ? 0 : a.trigger === 'after' ? prevEnd : prevStart;
    const start = base + a.delay;
    const end = start + a.duration;
    cur!.items.push({ anim: a, start, end });
    cur!.duration = Math.max(cur!.duration, end);
    prevStart = start;
    prevEnd = end;
  });
  return { auto, steps };
}

/** Elements that start hidden because their first animation is an entrance. */
export function initiallyHidden(slide: Pick<Slide, 'animations'>): Set<string> {
  const first = new Map<string, Animation>();
  for (const a of slide.animations) if (!first.has(a.elementId)) first.set(a.elementId, a);
  const out = new Set<string>();
  for (const [id, a] of first) if (a.class === 'entrance') out.add(id);
  return out;
}

/** Visibility of every animated element after `stepIndex` click-steps have completed (auto step always included). */
export function visibilityAfter(slide: Pick<Slide, 'animations'>, stepsDone: number): Map<string, boolean> {
  const { auto, steps } = buildSteps(slide);
  const vis = new Map<string, boolean>();
  for (const id of initiallyHidden(slide)) vis.set(id, false);
  const apply = (s: Step) => {
    for (const it of [...s.items].sort((a, b) => a.end - b.end)) {
      if (it.anim.class === 'entrance') vis.set(it.anim.elementId, true);
      if (it.anim.class === 'exit') vis.set(it.anim.elementId, false);
    }
  };
  if (auto) apply(auto);
  steps.slice(0, stepsDone).forEach(apply);
  return vis;
}

const OFF = 220; // fly distance in slide units

function dirVec(d: Animation['direction']): [number, number] {
  switch (d) {
    case 'left': return [-1, 0];
    case 'right': return [1, 0];
    case 'up': return [0, -1];
    default: return [0, 1];
  }
}

export interface Keyframe {
  offset?: number;
  opacity?: number;
  transform?: string;
  filter?: string;
  clipPath?: string;
}

/**
 * Web-Animations keyframes for an effect. Transforms are applied to a wrapper
 * whose transform-origin is the element centre; translation is in slide units.
 */
export function keyframes(a: Animation, el?: Pick<SlideElement, 'w' | 'h'>): Keyframe[] {
  const [dx, dy] = dirVec(a.direction);
  const enter = a.class === 'entrance';
  const pair = (from: Keyframe, to: Keyframe) => (enter ? [from, to] : [to, from]);
  switch (a.effect) {
    case 'appear':
      return enter ? [{ opacity: 0, offset: 0 }, { opacity: 0, offset: 0.999 }, { opacity: 1, offset: 1 }] : [{ opacity: 1, offset: 0 }, { opacity: 1, offset: 0.999 }, { opacity: 0, offset: 1 }];
    case 'fade':
      return pair({ opacity: 0 }, { opacity: 1 });
    case 'fly':
      return pair({ opacity: 0, transform: `translate(${-dx * OFF * 3}px, ${-dy * OFF * 3}px)` }, { opacity: 1, transform: 'translate(0px, 0px)' });
    case 'rise':
      return pair({ opacity: 0, transform: `translate(0px, ${OFF / 2}px)` }, { opacity: 1, transform: 'translate(0px, 0px)' });
    case 'zoom':
      return pair({ opacity: 0, transform: 'scale(0.3)' }, { opacity: 1, transform: 'scale(1)' });
    case 'blur':
      return pair({ opacity: 0, filter: 'blur(24px)' }, { opacity: 1, filter: 'blur(0px)' });
    case 'wipe': {
      const from = dx < 0 ? 'inset(0 0 0 100%)' : dx > 0 ? 'inset(0 100% 0 0)' : dy < 0 ? 'inset(100% 0 0 0)' : 'inset(0 0 100% 0)';
      return pair({ clipPath: from }, { clipPath: 'inset(0 0 0 0)' });
    }
    case 'pulse':
      return [{ transform: 'scale(1)' }, { transform: 'scale(1.08)', offset: 0.5 }, { transform: 'scale(1)' }];
    case 'grow':
      return [{ transform: 'scale(1)' }, { transform: 'scale(1.25)' }];
    case 'spin':
      return [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }];
    case 'shake':
      return [0, -18, 18, -12, 12, -6, 0].map((x, i, arr) => ({ transform: `translate(${x}px, 0px)`, offset: i / (arr.length - 1) }));
    case 'color':
      return [{ filter: 'brightness(1)' }, { filter: 'brightness(1.6) saturate(1.4)', offset: 0.5 }, { filter: 'brightness(1)' }];
    case 'path': {
      const pts = a.path?.length ? a.path : [{ x: 0, y: 0 }, { x: (el?.w ?? 200) * 1.2, y: 0 }];
      return pts.map((p, i) => ({ transform: `translate(${p.x}px, ${p.y}px)`, offset: pts.length > 1 ? i / (pts.length - 1) : 1 }));
    }
  }
}

export function easingCss(e: Animation['easing']): string {
  switch (e) {
    case 'linear': return 'linear';
    case 'ease': return 'ease';
    case 'ease-in': return 'cubic-bezier(0.4, 0, 1, 1)';
    case 'ease-out': return 'cubic-bezier(0.16, 1, 0.3, 1)';
    case 'spring': return 'cubic-bezier(0.34, 1.56, 0.64, 1)';
  }
}

/** Whether the element should keep its final transform after the effect (motion paths and grow persist). */
export function persists(a: Animation): boolean {
  return a.effect === 'path' || a.effect === 'grow';
}

export const EFFECTS_BY_CLASS: Record<Animation['class'], Animation['effect'][]> = {
  entrance: ['appear', 'fade', 'fly', 'rise', 'zoom', 'wipe', 'blur'],
  exit: ['appear', 'fade', 'fly', 'zoom', 'wipe', 'blur'],
  emphasis: ['pulse', 'grow', 'spin', 'shake', 'color'],
  motion: ['path'],
};
