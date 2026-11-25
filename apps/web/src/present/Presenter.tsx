import { useEffect, useRef, useState } from 'react';
import { buildSteps, type DeckDoc, type Presentation } from '@deck/core';
import { SlideView } from '../render/SlideView';
import { applyState } from './engine';
import { channelName, visibleSlides, type ShowMsg } from './Show';
import { Icon } from '../editor/icons';

/** Presenter view: current + next slide, notes, elapsed timer and clock. Drives the audience window over BroadcastChannel. */
export function Presenter({ pres, deck, docId }: { pres: Presentation; deck: DeckDoc; docId: string }) {
  const slides = visibleSlides(pres);
  const [index, setIndex] = useState(0);
  const [step, setStep] = useState(0);
  const [start, setStart] = useState(() => Date.now());
  const [paused, setPaused] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [fontSize, setFontSize] = useState(22);
  const chan = useRef<BroadcastChannel | null>(null);
  const curRef = useRef<HTMLDivElement>(null);
  const me = useRef(Math.random().toString(36).slice(2));

  useEffect(() => {
    const c = new BroadcastChannel(channelName(docId));
    chan.current = c;
    c.onmessage = (e: MessageEvent<ShowMsg>) => {
      if (e.data.type === 'state' && e.data.from !== me.current) {
        setIndex(e.data.index);
        setStep(e.data.step);
      }
    };
    c.postMessage({ type: 'hello', from: me.current } satisfies ShowMsg);
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => {
      clearInterval(t);
      c.close();
    };
  }, [docId]);

  const slide = slides[index];
  const plainSteps = slide ? buildSteps(slide).steps.filter((s) => !s.triggerElementId).length : 0;
  useEffect(() => {
    if (curRef.current && slide) applyState(curRef.current, slide, step);
  }, [slide, step]);

  const send = (i: number, s: number) => {
    setIndex(i);
    setStep(s);
    chan.current?.postMessage({ type: 'goto', index: i, step: s, from: me.current } satisfies ShowMsg);
  };
  const next = () => (step < plainSteps ? send(index, step + 1) : index < slides.length - 1 && send(index + 1, 0));
  const prev = () => (step > 0 ? send(index, step - 1) : index > 0 && send(index - 1, 0));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (['ArrowRight', 'ArrowDown', ' ', 'PageDown', 'Enter'].includes(e.key)) { e.preventDefault(); next(); }
      if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); prev(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const elapsed = Math.max(0, (paused ?? now) - start);
  const mm = String(Math.floor(elapsed / 60000)).padStart(2, '0');
  const ss = String(Math.floor((elapsed % 60000) / 1000)).padStart(2, '0');
  const curW = Math.min(window.innerWidth * 0.55, 900);
  const nextW = Math.min(window.innerWidth * 0.32, 520);

  return (
    <div className="presenter">
      <div className="clock">
        <span><small>Elapsed</small><br />{mm}:{ss}</span>
        <span><small>Time</small><br />{new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        <span><small>Slide</small><br />{index + 1} / {slides.length}{plainSteps ? <span style={{ fontSize: 18, color: '#888' }}> · build {step}/{plainSteps}</span> : null}</span>
      </div>
      <div className="cur" ref={curRef}>
        {slide && <SlideView slide={slide} pres={pres} deck={deck} width={curW} style={{ borderRadius: 8, boxShadow: '0 0 0 1px #333' }} />}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minHeight: 0 }}>
        <div className="next">
          <div style={{ color: '#888', fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>Next</div>
          {slides[index + 1] ? <SlideView slide={slides[index + 1]!} pres={pres} deck={deck} width={nextW} style={{ borderRadius: 6, opacity: 0.9 }} /> : <div style={{ color: '#666' }}>End of presentation</div>}
        </div>
        <div className="notes-view" style={{ fontSize }} aria-label="Speaker notes">{slide?.notes || <span style={{ color: '#555' }}>No notes for this slide.</span>}</div>
      </div>
      <div className="ctrls">
        <button className="btn ghost-strong" style={{ color: '#ddd' }} onClick={prev}><Icon name="chevronL" />Previous</button>
        <button className="btn primary" onClick={next}>Next<Icon name="chevronR" /></button>
        <span className="spacer" />
        <button className="btn" style={{ color: '#ccc' }} onClick={() => setFontSize((f) => Math.max(12, f - 2))}>A−</button>
        <button className="btn" style={{ color: '#ccc' }} onClick={() => setFontSize((f) => Math.min(48, f + 2))}>A+</button>
        <button className="btn" style={{ color: '#ccc' }} onClick={() => (paused ? (setStart(start + (Date.now() - paused)), setPaused(null)) : setPaused(Date.now()))}>{paused ? 'Resume timer' : 'Pause timer'}</button>
        <button className="btn" style={{ color: '#ccc' }} onClick={() => { setStart(Date.now()); setPaused(null); }}>Reset timer</button>
        <button className="btn" style={{ color: '#ccc' }} onClick={() => window.open(`${location.pathname}#/d/${docId}/play/${index}`, `deck-audience-${docId}`)}>Open audience window</button>
        <button className="btn danger" onClick={() => { chan.current?.postMessage({ type: 'end', from: me.current } satisfies ShowMsg); window.close(); }}>End show</button>
      </div>
    </div>
  );
}
