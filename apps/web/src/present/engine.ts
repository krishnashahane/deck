import { buildSteps, easingCss, initiallyHidden, keyframes, persists, visibilityAfter, type Animation, type Slide, type Step, type Transition } from '@deck/core';
import type { EditorStore } from '../lib/store';

/**
 * Runtime animation engine. Elements are SVG <g data-el="id"> nodes rendered by
 * SlideView; effects are played with the Web Animations API so they are
 * GPU-composited where the browser allows and can be cancelled/finished.
 */

const q = (root: ParentNode, id: string) => root.querySelector<SVGGElement>(`[data-el="${CSS.escape(id)}"]`);

export function reducedMotion(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Put a slide's elements in the state they have after `stepsDone` click steps (no animation). */
export function applyState(root: ParentNode, slide: Slide, stepsDone: number) {
  const vis = visibilityAfter(slide, stepsDone);
  for (const el of slide.elements) {
    const g = q(root, el.id);
    if (!g) continue;
    g.getAnimations().forEach((a) => a.cancel());
    const v = vis.get(el.id);
    g.style.visibility = v === false ? 'hidden' : '';
    g.style.transform = '';
  }
  // Persisted transforms (motion paths, grow) from completed steps.
  const { auto, steps } = buildSteps(slide);
  const done = [...(auto ? [auto] : []), ...steps.slice(0, stepsDone)];
  for (const s of done) for (const it of s.items) {
    if (!persists(it.anim)) continue;
    const g = q(root, it.anim.elementId);
    const kf = keyframes(it.anim, slide.elements.find((e) => e.id === it.anim.elementId));
    const last = kf[kf.length - 1];
    if (g && last?.transform) g.style.transform = last.transform;
  }
}

/** Play one step; resolves when every animation in it has finished. */
export function playStep(root: ParentNode, slide: Slide, step: Step, speed = 1): Promise<void> {
  const rm = reducedMotion();
  const jobs = step.items.map(
    (it) =>
      new Promise<void>((resolve) => {
        const a: Animation = it.anim;
        const g = q(root, a.elementId);
        if (!g) return resolve();
        const el = slide.elements.find((e) => e.id === a.elementId);
        const start = () => {
          if (a.class === 'entrance') g.style.visibility = '';
          if (rm) {
            if (a.class === 'exit') g.style.visibility = 'hidden';
            return resolve();
          }
          const frames = keyframes(a, el) as Keyframe[];
          const anim = g.animate(frames, { duration: a.duration / speed, easing: easingCss(a.easing), fill: persists(a) ? 'forwards' : 'none' });
          anim.onfinish = () => {
            if (a.class === 'exit') g.style.visibility = 'hidden';
            if (persists(a)) {
              const last = frames[frames.length - 1] as { transform?: string };
              if (last.transform) g.style.transform = last.transform;
              anim.cancel();
            }
            resolve();
          };
          anim.oncancel = () => resolve();
        };
        const delay = it.start / speed;
        if (delay > 0) setTimeout(start, delay);
        else start();
      }),
  );
  return Promise.all(jobs).then(() => undefined);
}

/** Finish any running animations immediately (used when the presenter clicks through quickly). */
export function finishAll(root: ParentNode) {
  root.querySelectorAll<SVGGElement>('[data-el]').forEach((g) => g.getAnimations().forEach((a) => a.finish()));
}

export function prepareSlide(root: ParentNode, slide: Slide) {
  for (const id of initiallyHidden(slide)) {
    const g = q(root, id);
    if (g) g.style.visibility = 'hidden';
  }
}

/* ───────────── transitions ───────────── */

export function transitionFrames(t: Transition): { out: Keyframe[]; in: Keyframe[]; zIn: boolean } {
  const vec = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[t.direction] as [number, number];
  const pct = (k: number) => `translate(${-vec[0] * k * 100}%, ${-vec[1] * k * 100}%)`;
  switch (t.kind) {
    case 'fade': return { out: [{ opacity: 1 }, { opacity: 0 }], in: [{ opacity: 0 }, { opacity: 1 }], zIn: true };
    case 'push': return { out: [{ transform: 'translate(0,0)' }, { transform: pct(-1) }], in: [{ transform: pct(1) }, { transform: 'translate(0,0)' }], zIn: true };
    case 'cover': return { out: [{ opacity: 1 }, { opacity: 0.6 }], in: [{ transform: pct(1) }, { transform: 'translate(0,0)' }], zIn: true };
    case 'wipe': {
      const from = vec[0] < 0 ? 'inset(0 0 0 100%)' : vec[0] > 0 ? 'inset(0 100% 0 0)' : vec[1] < 0 ? 'inset(100% 0 0 0)' : 'inset(0 0 100% 0)';
      return { out: [{ opacity: 1 }, { opacity: 1 }], in: [{ clipPath: from }, { clipPath: 'inset(0 0 0 0)' }], zIn: true };
    }
    case 'zoom': return { out: [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(1.15)' }], in: [{ opacity: 0, transform: 'scale(0.85)' }, { opacity: 1, transform: 'scale(1)' }], zIn: true };
    case 'split': return { out: [{ clipPath: 'inset(0 0 0 0)' }, { clipPath: 'inset(0 50% 0 50%)' }], in: [{ opacity: 1 }, { opacity: 1 }], zIn: false };
    case 'flip': return { out: [{ transform: 'perspective(2000px) rotateY(0deg)', opacity: 1 }, { transform: 'perspective(2000px) rotateY(-90deg)', opacity: 1, offset: 0.5 }, { transform: 'perspective(2000px) rotateY(-90deg)', opacity: 0 }], in: [{ transform: 'perspective(2000px) rotateY(90deg)', opacity: 0 }, { transform: 'perspective(2000px) rotateY(90deg)', opacity: 1, offset: 0.5 }, { transform: 'perspective(2000px) rotateY(0deg)', opacity: 1 }], zIn: true };
    default: return { out: [{ opacity: 1 }, { opacity: 0 }], in: [{ opacity: 0 }, { opacity: 1 }], zIn: true };
  }
}

/** Animate two stacked layers (old under/over new). Resolves when done. */
export async function runTransition(outLayer: HTMLElement | null, inLayer: HTMLElement, t: Transition, from?: Slide, to?: Slide): Promise<void> {
  if (t.kind === 'none' || reducedMotion() || !outLayer) return;
  if (t.kind === 'smart-move' && from && to) return smartMove(outLayer, inLayer, from, to, t.duration);
  const f = transitionFrames(t);
  inLayer.style.zIndex = f.zIn ? '2' : '1';
  outLayer.style.zIndex = f.zIn ? '1' : '2';
  const opts: KeyframeAnimationOptions = { duration: t.duration, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', fill: 'both' };
  const a = outLayer.animate(f.out, opts);
  const b = inLayer.animate(f.in, opts);
  await Promise.all([a.finished, b.finished]).catch(() => undefined);
  a.cancel();
  b.cancel();
}

/**
 * Smart move: objects that appear on both slides (same name, or same id after
 * duplication) glide from their old geometry to the new one; everything else
 * cross-fades. Implemented FLIP-style on the incoming layer.
 */
async function smartMove(outLayer: HTMLElement, inLayer: HTMLElement, from: Slide, to: Slide, duration: number) {
  const key = (e: { id: string; name: string }) => e.name;
  const prev = new Map<string, Slide['elements'][number]>();
  for (const e of from.elements) if (!prev.has(key(e))) prev.set(key(e), e);
  const used = new Set<string>();
  const anims: globalThis.Animation[] = [];
  const opts: KeyframeAnimationOptions = { duration, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', fill: 'both' };
  inLayer.style.zIndex = '2';
  outLayer.style.zIndex = '1';
  for (const e of to.elements) {
    const g = inLayer.querySelector<SVGGElement>(`[data-el="${CSS.escape(e.id)}"]`);
    if (!g) continue;
    const p = from.elements.find((x) => x.id === e.id) ?? prev.get(key(e));
    if (!p || used.has(p.id)) {
      anims.push(g.animate([{ opacity: 0 }, { opacity: e.opacity }], opts));
      continue;
    }
    used.add(p.id);
    const sx = p.w / Math.max(1, e.w), sy = p.h / Math.max(1, e.h);
    const dx = p.x + p.w / 2 - (e.x + e.w / 2), dy = p.y + p.h / 2 - (e.y + e.h / 2);
    anims.push(g.animate([
      { transform: `translate(${dx}px, ${dy}px) rotate(${p.rotation - e.rotation}deg) scale(${sx}, ${sy})`, opacity: p.opacity },
      { transform: 'translate(0px, 0px) rotate(0deg) scale(1, 1)', opacity: e.opacity },
    ], opts));
    const og = outLayer.querySelector<SVGGElement>(`[data-el="${CSS.escape(p.id)}"]`);
    if (og) og.style.visibility = 'hidden';
  }
  // Background + unmatched outgoing objects fade.
  anims.push(outLayer.animate([{ opacity: 1 }, { opacity: 0 }], opts));
  const bg = inLayer.querySelector('svg > rect');
  if (bg) anims.push((bg as SVGElement).animate([{ opacity: 0 }, { opacity: 1 }], opts));
  await Promise.all(anims.map((a) => a.finished)).catch(() => undefined);
  anims.forEach((a) => a.cancel());
}

/* ───────────── in-editor previews ───────────── */

export async function previewSlideAnimations(store: EditorStore, slideId: string) {
  const slide = store.pres.slides.find((s) => s.id === slideId);
  const root = document.querySelector('.slide-host');
  if (!slide || !root) return;
  store.setUi({ selection: [], editingId: null });
  await new Promise((r) => requestAnimationFrame(r));
  prepareSlide(root, slide);
  const { auto, steps } = buildSteps(slide);
  if (auto) await playStep(root, slide, auto);
  for (const s of steps) {
    await new Promise((r) => setTimeout(r, 350));
    await playStep(root, slide, s);
  }
  await new Promise((r) => setTimeout(r, 600));
  applyState(root, { ...slide, animations: [] }, 0);
}

export async function previewTransition(store: EditorStore, slideId: string) {
  const host = document.querySelector<HTMLElement>('.slide-host');
  const slide = store.pres.slides.find((s) => s.id === slideId);
  if (!host || !slide) return;
  const svg = host.querySelector('svg');
  if (!svg) return;
  const clone = svg.cloneNode(true) as SVGElement;
  const idx = store.pres.slides.indexOf(slide);
  const wrapOut = document.createElement('div');
  const wrapIn = document.createElement('div');
  for (const w of [wrapOut, wrapIn]) Object.assign(w.style, { position: 'absolute', inset: '0', overflow: 'hidden' });
  wrapOut.style.background = store.pres.theme.colors.background;
  // Outgoing = previous slide's background colour (a lightweight stand-in), incoming = this slide.
  const prev = store.pres.slides[idx - 1];
  wrapOut.style.background = prev?.background?.kind === 'solid' ? prev.background.color : '#000';
  wrapIn.appendChild(clone);
  host.appendChild(wrapOut);
  host.appendChild(wrapIn);
  await runTransition(wrapOut, wrapIn, slide.transition.kind === 'smart-move' ? { ...slide.transition, kind: 'fade' } : slide.transition);
  wrapOut.remove();
  wrapIn.remove();
}
