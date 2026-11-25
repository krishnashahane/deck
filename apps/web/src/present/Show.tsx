import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { buildSteps, safeHref, type DeckDoc, type Presentation, type Slide, type SlideElement } from '@deck/core';
import { SlideView } from '../render/SlideView';
import { applyState, finishAll, playStep, prepareSlide, runTransition } from './engine';
import { Icon } from '../editor/icons';
import { toast } from '../lib/toast';

export type ShowMsg = { type: 'goto'; index: number; step: number; from?: string } | { type: 'hello'; from: string } | { type: 'end'; from: string } | { type: 'state'; index: number; step: number; from: string };

export function channelName(docId: string) {
  return `deck-show-${docId}`;
}

export function visibleSlides(p: Presentation): Slide[] {
  return p.slides.filter((s) => !s.hidden);
}

/**
 * Full-screen slideshow. Keyboard: → / Space / Enter / PageDown next, ← / PageUp
 * previous, Home / End, digits + Enter to jump, B black, W white, L laser,
 * P pen, E erase ink, F fullscreen, Esc exit.
 */
export function Show({ pres, deck, docId, startIndex = 0, onExit }: { pres: Presentation; deck: DeckDoc; docId: string; startIndex?: number; onExit: () => void }) {
  const slides = visibleSlides(pres);
  const [index, setIndex] = useState(Math.min(startIndex, Math.max(0, slides.length - 1)));
  const [step, setStep] = useState(0);
  const [prevIndex, setPrevIndex] = useState<number | null>(null);
  const [blank, setBlank] = useState<null | 'black' | 'white'>(null);
  const [tool, setTool] = useState<'none' | 'laser' | 'pen'>('none');
  const [laser, setLaser] = useState<{ x: number; y: number } | null>(null);
  const [cursor, setCursor] = useState(true);
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [recording, setRecording] = useState<MediaRecorder | null>(null);
  const inRef = useRef<HTMLDivElement>(null);
  const outRef = useRef<HTMLDivElement>(null);
  const inkRef = useRef<HTMLCanvasElement>(null);
  const busy = useRef(false);
  const typed = useRef('');
  const chan = useRef<BroadcastChannel | null>(null);
  const me = useRef(Math.random().toString(36).slice(2));

  const slide = slides[index];
  const steps = slide ? buildSteps(slide) : { auto: null, steps: [] };
  const scale = Math.min(size.w / pres.width, size.h / pres.height);
  const w = pres.width * scale, h = pres.height * scale;

  useEffect(() => {
    const onR = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onR);
    document.documentElement.requestFullscreen?.().catch(() => undefined);
    return () => {
      window.removeEventListener('resize', onR);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    };
  }, []);

  // Presenter-view sync.
  useEffect(() => {
    const c = new BroadcastChannel(channelName(docId));
    chan.current = c;
    c.onmessage = (e: MessageEvent<ShowMsg>) => {
      const m = e.data;
      if (m.type === 'goto' && m.from !== me.current) go(m.index, m.step, false);
      if (m.type === 'hello') c.postMessage({ type: 'state', index: idxRef.current, step: stepRef.current, from: me.current } satisfies ShowMsg);
      if (m.type === 'end') onExit();
    };
    return () => c.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);
  const idxRef = useRef(index);
  const stepRef = useRef(step);
  idxRef.current = index;
  stepRef.current = step;
  const broadcast = (i: number, s: number) => chan.current?.postMessage({ type: 'state', index: i, step: s, from: me.current } satisfies ShowMsg);

  // On slide entry: set initial animation state, run transition, then the auto step.
  useLayoutEffect(() => {
    const root = inRef.current;
    if (!root || !slide) return;
    applyState(root, slide, 0);
    prepareSlide(root, slide);
    if (step > 0) applyState(root, slide, step);
    const run = async () => {
      busy.current = true;
      const from = prevIndex !== null ? slides[prevIndex] : undefined;
      if (from && prevIndex !== null && prevIndex < index) await runTransition(outRef.current, root, slide.transition, from, slide);
      setPrevIndex(null);
      if (steps.auto && step === 0) await playStep(root, slide, steps.auto);
      busy.current = false;
    };
    void run();
    clearInk();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, slide?.id]);

  // Auto-advance.
  useEffect(() => {
    if (!slide?.transition.advanceAfter) return;
    const t = setTimeout(() => next(), slide.transition.advanceAfter + (steps.auto?.duration ?? 0));
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, step, slide?.transition.advanceAfter]);

  const go = useCallback((i: number, s = 0, send = true) => {
    if (i < 0 || i >= slides.length) return;
    finishAll(inRef.current ?? document);
    if (i !== idxRef.current) {
      setPrevIndex(idxRef.current);
      setIndex(i);
      setStep(s);
    } else {
      setStep(s);
      if (inRef.current && slides[i]) applyState(inRef.current, slides[i]!, s);
    }
    if (send) broadcast(i, s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slides.length]);

  const next = useCallback(() => {
    if (!slide) return;
    if (busy.current) {
      finishAll(inRef.current!);
      return;
    }
    const plain = steps.steps.filter((s) => !s.triggerElementId);
    if (step < plain.length) {
      const s = plain[step]!;
      busy.current = true;
      setStep(step + 1);
      broadcast(index, step + 1);
      void playStep(inRef.current!, slide, s).then(() => (busy.current = false));
    } else if (index < slides.length - 1) go(index + 1);
    else setBlank('black');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slide, step, index, slides.length, go]);

  const prev = useCallback(() => {
    if (blank) return setBlank(null);
    if (step > 0) go(index, step - 1);
    else if (index > 0) {
      const p = slides[index - 1]!;
      go(index - 1, buildSteps(p).steps.filter((s) => !s.triggerElementId).length);
    }
  }, [blank, step, index, slides, go]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) { typed.current += e.key; return; }
      switch (e.key) {
        case 'ArrowRight': case 'ArrowDown': case 'PageDown': case ' ': case 'n':
          e.preventDefault(); setBlank(null); next(); break;
        case 'Enter':
          e.preventDefault();
          if (typed.current) { go(Math.max(0, Number(typed.current) - 1)); typed.current = ''; } else next();
          break;
        case 'ArrowLeft': case 'ArrowUp': case 'PageUp': case 'Backspace': case 'p':
          e.preventDefault(); prev(); break;
        case 'Home': go(0); break;
        case 'End': go(slides.length - 1); break;
        case 'b': case 'B': case '.': setBlank((b) => (b === 'black' ? null : 'black')); break;
        case 'w': case 'W': case ',': setBlank((b) => (b === 'white' ? null : 'white')); break;
        case 'l': case 'L': setTool((t) => (t === 'laser' ? 'none' : 'laser')); break;
        case 'P': setTool((t) => (t === 'pen' ? 'none' : 'pen')); break;
        case 'e': case 'E': clearInk(); break;
        case 'f': case 'F': document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.(); break;
        case 'Escape': if (!document.fullscreenElement) onExit(); else if (tool !== 'none') setTool('none'); else onExit(); break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, go, slides.length, onExit, tool]);

  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const onMove = () => {
      setCursor(true);
      clearTimeout(t);
      t = setTimeout(() => setCursor(false), 2200);
    };
    window.addEventListener('pointermove', onMove);
    onMove();
    return () => window.removeEventListener('pointermove', onMove);
  }, []);

  const clearInk = () => {
    const c = inkRef.current;
    c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
  };

  const onElementClick = (el: SlideElement) => {
    if (el.link?.kind === 'url') {
      const u = safeHref(el.link.url);
      if (u) window.open(u, '_blank', 'noopener,noreferrer');
      return true;
    }
    if (el.link?.kind === 'slide') {
      const target = slides.findIndex((s) => s.id === (el.link as { slideId: string }).slideId);
      if (target >= 0) go(target);
      return true;
    }
    const trig = steps.steps.find((s) => s.triggerElementId === el.id);
    if (trig && slide) {
      void playStep(inRef.current!, slide, trig);
      return true;
    }
    return el.type === 'media';
  };

  const record = async () => {
    if (recording) {
      recording.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true, preferCurrentTab: true } as DisplayMediaStreamOptions);
      let mic: MediaStream | null = null;
      try { mic = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { /* narration optional */ }
      const tracks = [...stream.getVideoTracks(), ...(mic?.getAudioTracks() ?? stream.getAudioTracks())];
      const rec = new MediaRecorder(new MediaStream(tracks), { mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm' });
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        mic?.getTracks().forEach((t) => t.stop());
        const url = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `${pres.title || 'presentation'} recording.webm`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        setRecording(null);
      };
      rec.start(1000);
      setRecording(rec);
      toast('Recording — press the record button again to stop');
    } catch {
      toast('Screen recording was not permitted');
    }
  };

  // Pen drawing.
  const drawing = useRef(false);
  const onInkDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (tool !== 'pen') return;
    drawing.current = true;
    const ctx = e.currentTarget.getContext('2d')!;
    const r = e.currentTarget.getBoundingClientRect();
    ctx.strokeStyle = '#ff3d2e';
    ctx.lineWidth = 4 * devicePixelRatio;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo((e.clientX - r.left) * devicePixelRatio, (e.clientY - r.top) * devicePixelRatio);
  };
  const onInkMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (tool === 'laser') setLaser({ x: e.clientX - r.left, y: e.clientY - r.top });
    if (!drawing.current) return;
    const ctx = e.currentTarget.getContext('2d')!;
    ctx.lineTo((e.clientX - r.left) * devicePixelRatio, (e.clientY - r.top) * devicePixelRatio);
    ctx.stroke();
  };

  if (!slide) {
    return (
      <div className="show cursor" onClick={onExit}>
        <div style={{ color: '#888' }}>No visible slides. Press Esc to exit.</div>
      </div>
    );
  }
  const prevSlide = prevIndex !== null ? slides[prevIndex] : undefined;

  return (
    <div className={`show ${cursor || tool !== 'none' ? 'cursor' : ''}`} role="application" aria-label="Slideshow" aria-roledescription="slideshow" style={{ cursor: tool === 'laser' ? 'none' : tool === 'pen' ? 'crosshair' : undefined }}>
      <div className="show-stage" style={{ width: w, height: h }} onClick={(e) => {
        if (tool !== 'none') return;
        const g = (e.target as Element).closest('[data-el]');
        const el = g && slide.elements.find((x) => x.id === g.getAttribute('data-el'));
        if (el && onElementClick(el)) return;
        if ((e.target as Element).closest('video, audio')) return;
        next();
      }}>
        {prevSlide && (
          <div className="show-layer" ref={outRef}>
            <SlideView slide={prevSlide} pres={pres} deck={deck} width={w} />
          </div>
        )}
        <div className="show-layer" ref={inRef} key={slide.id}>
          <SlideView slide={slide} pres={pres} deck={deck} width={w} live />
        </div>
        <canvas ref={inkRef} className="ink-layer" width={w * devicePixelRatio} height={h * devicePixelRatio} style={{ width: w, height: h, pointerEvents: tool === 'none' ? 'none' : 'auto' }} onPointerDown={onInkDown} onPointerMove={onInkMove} onPointerUp={() => (drawing.current = false)} onPointerLeave={() => { drawing.current = false; setLaser(null); }} />
        {tool === 'laser' && laser && <div className="laser" style={{ left: laser.x, top: laser.y }} />}
        {blank && <div className="show-layer" style={{ background: blank === 'black' ? '#000' : '#fff', zIndex: 6 }} onClick={(e) => { e.stopPropagation(); setBlank(null); }} />}
      </div>
      <div className="show-hud" onClick={(e) => e.stopPropagation()}>
        <button className="btn icon" aria-label="Previous" onClick={prev}><Icon name="chevronL" /></button>
        <span style={{ font: '500 12px var(--font-mono)', padding: '0 6px' }}>{index + 1} / {slides.length}</span>
        <button className="btn icon" aria-label="Next" onClick={next}><Icon name="chevronR" /></button>
        <span className="sep" style={{ background: 'rgba(255,255,255,.2)' }} />
        <button className={`btn icon ${tool === 'laser' ? 'on' : ''}`} aria-label="Laser pointer (L)" title="Laser (L)" onClick={() => setTool((t) => (t === 'laser' ? 'none' : 'laser'))}><Icon name="laser" /></button>
        <button className={`btn icon ${tool === 'pen' ? 'on' : ''}`} aria-label="Pen (Shift+P)" title="Pen (Shift+P) · E erases" onClick={() => setTool((t) => (t === 'pen' ? 'none' : 'pen'))}><Icon name="pen" /></button>
        <button className="btn icon" aria-label="Presenter view" title="Open presenter view" onClick={() => window.open(`${location.pathname}#/d/${docId}/presenter`, `deck-presenter-${docId}`, 'popup,width=1280,height=800')}><Icon name="presenter" /></button>
        <button className={`btn icon ${recording ? 'on' : ''}`} aria-label={recording ? 'Stop recording' : 'Record'} title="Record presentation" onClick={record} style={recording ? { color: '#ff4d3d' } : undefined}><Icon name="record" /></button>
        <button className="btn icon" aria-label="Exit (Esc)" onClick={onExit}><Icon name="close" /></button>
      </div>
    </div>
  );
}
