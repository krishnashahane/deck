import { analyzeSlide, layoutById, para, plainText, type Presentation, type Slide } from '@deck/core';
import { api } from './api';

/**
 * Provider-independent assistant.
 *  - 'local'  : deterministic heuristics that run in the browser; nothing leaves the device.
 *  - 'server' : the DECK server forwards the task to the AI provider its operator configured.
 *               The browser never sees provider credentials, and the server builds the
 *               system prompt so imported content cannot override instructions.
 * Every result is a *proposal*: the user previews it and nothing changes until they accept.
 */

export type AiTask = 'outline' | 'document' | 'rewrite' | 'notes' | 'titles' | 'review';
export type Provider = 'local' | 'server';

export interface ProposalSlide {
  title: string;
  bullets: string[];
  notes?: string;
  layout?: 'title' | 'title-content' | 'section' | 'two-column' | 'big-number' | 'quote';
}

export interface Proposal {
  task: AiTask;
  provider: Provider;
  slides?: ProposalSlide[];
  rewrites?: { elementId: string; text: string }[];
  notes?: string;
  titles?: string[];
  suggestions?: string[];
  /** Numbers or URLs present in the output but absent from the input — must be verified by the user. */
  unverified: string[];
}

export interface AiInput {
  task: AiTask;
  prompt?: string;
  document?: string;
  tone?: 'concise' | 'formal' | 'friendly' | 'simpler';
  slide?: Slide;
  pres: Presentation;
  elementIds?: string[];
}

function slideText(s: Slide): { title: string; body: string[] } {
  const title = s.elements.find((e) => e.placeholder === 'title');
  const bodies = s.elements.filter((e) => e.id !== title?.id && (e.type === 'text' || e.type === 'shape'));
  return {
    title: title && (title.type === 'text' || title.type === 'shape') ? plainText(title.paragraphs) : '',
    body: bodies.flatMap((e) => (e.type === 'text' || e.type === 'shape' ? e.paragraphs.map((p) => p.runs.map((r) => r.text).join('')).filter(Boolean) : [])),
  };
}

/** Facts check: tokens that look like figures or links and do not occur in the source. */
export function unverifiedFacts(output: string, source: string): string[] {
  const norm = (s: string) => s.replace(/[,\s]/g, '').toLowerCase();
  const src = norm(source);
  const found = output.match(/https?:\/\/\S+|\$?\d[\d,.]*\s?(%|percent|[kmb]n?|million|billion)?/gi) ?? [];
  return [...new Set(found.map((f) => f.trim()).filter((f) => /\d|http/.test(f) && f.replace(/\D/g, '').length > 0 && !src.includes(norm(f))))].slice(0, 20);
}

/* ───────────── local heuristics ───────────── */

function sentences(t: string): string[] {
  return t.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z0-9“"(])/).map((s) => s.trim()).filter(Boolean);
}

function shorten(s: string, words = 8): string {
  const w = s.replace(/[.!?:;]+$/, '').split(/\s+/);
  return w.length <= words ? w.join(' ') : w.slice(0, words).join(' ') + '…';
}

function localDocument(doc: string): ProposalSlide[] {
  const blocks = doc.replace(/\r/g, '').split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const slides: ProposalSlide[] = [];
  let pending: ProposalSlide | null = null;
  for (const b of blocks.slice(0, 120)) {
    const lines = b.split('\n').map((l) => l.trim()).filter(Boolean);
    const heading = lines[0]!.match(/^#{1,6}\s+(.*)$/) ?? (lines.length === 1 && lines[0]!.length < 70 && !/[.!?]$/.test(lines[0]!) ? [lines[0], lines[0]] : null);
    if (heading) {
      if (pending) slides.push(pending);
      pending = { title: heading[1]!.trim(), bullets: [], layout: 'title-content' };
      continue;
    }
    const bullets = lines.every((l) => /^[-*•\d]+[.)]?\s/.test(l)) ? lines.map((l) => l.replace(/^[-*•\d]+[.)]?\s+/, '')) : sentences(b).map((s) => shorten(s, 14));
    if (!pending) pending = { title: shorten(sentences(b)[0] ?? 'Overview', 7), bullets: [], layout: 'title-content' };
    pending.bullets.push(...bullets);
    pending.notes = (pending.notes ? pending.notes + '\n' : '') + b;
    if (pending.bullets.length >= 5) {
      slides.push(pending);
      pending = null;
    }
  }
  if (pending) slides.push(pending);
  return slides.map((s) => ({ ...s, bullets: s.bullets.slice(0, 6) }));
}

function localOutline(prompt: string): ProposalSlide[] {
  const topic = prompt.trim().replace(/\.$/, '') || 'Your topic';
  return [
    { title: topic, bullets: ['Presenter · date'], layout: 'title' },
    { title: 'Why this matters', bullets: ['[Problem or opportunity — add your source]', '[Who is affected]', '[What happens if nothing changes]'] },
    { title: 'Key ideas', bullets: ['[Idea 1]', '[Idea 2]', '[Idea 3]'] },
    { title: 'Evidence', bullets: ['[Add data with its source]'], layout: 'big-number' },
    { title: 'What we propose', bullets: ['[Recommendation]', '[What it takes]', '[Timeline]'] },
    { title: 'Next steps', bullets: ['[Owner — action — date]'] },
  ];
}

function localNotes(s: Slide): string {
  const { title, body } = slideText(s);
  if (!title && !body.length) return '';
  return [`This slide covers ${title || 'the following points'}.`, ...body.map((b) => `• ${b}${/[.!?]$/.test(b) ? '' : '.'}`), 'Pause for questions before moving on.'].join('\n');
}

function localRewrite(text: string, tone: AiInput['tone']): string {
  let t = text.replace(/\s+/g, ' ').trim();
  const fillers = /\b(very|really|basically|actually|just|quite|in order to|it is important to note that|that being said)\b\s*/gi;
  if (tone === 'concise' || tone === 'simpler') t = t.replace(fillers, '').replace(/\bin order to\b/gi, 'to');
  if (tone === 'simpler') t = t.replace(/\butili[sz]e\b/gi, 'use').replace(/\bcommence\b/gi, 'start').replace(/\bapproximately\b/gi, 'about');
  if (tone === 'formal') t = t.replace(/\bcan't\b/gi, 'cannot').replace(/\bwon't\b/gi, 'will not').replace(/\bdon't\b/gi, 'do not').replace(/\bit's\b/gi, 'it is');
  if (tone === 'friendly') t = t.replace(/\bcannot\b/gi, "can't").replace(/\bdo not\b/gi, "don't");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function runLocal(input: AiInput): Proposal {
  const base = { task: input.task, provider: 'local' as const, unverified: [] };
  switch (input.task) {
    case 'outline': return { ...base, slides: localOutline(input.prompt ?? '') };
    case 'document': return { ...base, slides: localDocument(input.document ?? '') };
    case 'notes': return { ...base, notes: input.slide ? localNotes(input.slide) : '' };
    case 'titles': {
      const { title, body } = input.slide ? slideText(input.slide) : { title: '', body: [] };
      const cands = [title, ...body].filter(Boolean).map((t) => shorten(t, 6));
      return { ...base, titles: [...new Set(cands)].slice(0, 5) };
    }
    case 'rewrite': {
      const els = input.slide?.elements.filter((e) => (input.elementIds?.length ? input.elementIds.includes(e.id) : true) && (e.type === 'text' || e.type === 'shape')) ?? [];
      return { ...base, rewrites: els.map((e) => ({ elementId: e.id, text: (e.type === 'text' || e.type === 'shape') ? e.paragraphs.map((p) => localRewrite(p.runs.map((r) => r.text).join(''), input.tone)).join('\n') : '' })).filter((r) => r.text) };
    }
    case 'review': {
      const issues = input.pres.slides.flatMap((s, i) => analyzeSlide(s, input.pres).map((x) => `Slide ${i + 1}: ${x.message}`));
      const fonts = new Set(input.pres.slides.flatMap((s) => s.elements.flatMap((e) => (e.type === 'text' || e.type === 'shape' ? [e.style.font] : []))));
      if (fonts.size > 3) issues.push(`The deck uses ${fonts.size} fonts; consider the theme's heading and body fonts only.`);
      const layouts = new Set(input.pres.slides.map((s) => s.layout));
      if (input.pres.slides.length > 6 && layouts.size < 2) issues.push('Every slide uses the same layout; vary layouts (section, big number, quote) to create rhythm.');
      return { ...base, suggestions: issues.length ? issues : ['No consistency or readability issues detected.'] };
    }
  }
}

/* ───────────── server ───────────── */

function sourceFor(input: AiInput): string {
  if (input.task === 'document') return input.document ?? '';
  if (input.task === 'outline') return input.prompt ?? '';
  if (input.task === 'review') return input.pres.slides.map((s) => { const t = slideText(s); return [t.title, ...t.body].join('\n'); }).join('\n\n');
  if (!input.slide) return '';
  const t = slideText(input.slide);
  return [t.title, ...t.body, input.slide.notes].join('\n');
}

export async function runAi(input: AiInput, provider: Provider): Promise<Proposal> {
  if (provider === 'local') return runLocal(input);
  const source = sourceFor(input).slice(0, 60000);
  const elements = input.task === 'rewrite' && input.slide
    ? input.slide.elements.filter((e) => (input.elementIds?.length ? input.elementIds.includes(e.id) : true) && (e.type === 'text' || e.type === 'shape')).map((e) => ({ id: e.id, text: e.type === 'text' || e.type === 'shape' ? plainText(e.paragraphs) : '' }))
    : undefined;
  const res = await api<Omit<Proposal, 'unverified' | 'provider' | 'task'>>('/ai', { body: { task: input.task, tone: input.tone, source, elements, consent: true } });
  const outText = JSON.stringify(res);
  return { ...res, task: input.task, provider, unverified: unverifiedFacts(outText, source) };
}

/** Turn proposed slides into real slides using the presentation's layouts. */
export function proposalToSlides(pres: Presentation, slides: ProposalSlide[]): Slide[] {
  return slides.map((ps) => {
    const layout = ps.layout ?? 'title-content';
    const els = layoutById(layout).build(pres.theme, pres.width, pres.height);
    for (const e of els) {
      if (e.type !== 'text') continue;
      if (e.placeholder === 'title') e.paragraphs = [{ ...e.paragraphs[0]!, runs: [{ text: ps.title }] }];
      else if (e.placeholder === 'body' || e.placeholder === 'subtitle') {
        const proto = e.paragraphs[0] ?? para('');
        e.paragraphs = (ps.bullets.length ? ps.bullets : ['']).map((b) => ({ ...proto, runs: [{ text: b }] }));
      }
    }
    // Two-column layouts get the second half of the bullets on the right.
    const bodies = els.filter((e) => e.placeholder === 'body' && e.type === 'text');
    if (bodies.length === 2 && ps.bullets.length > 1) {
      const half = Math.ceil(ps.bullets.length / 2);
      [ps.bullets.slice(0, half), ps.bullets.slice(half)].forEach((list, i) => {
        const b = bodies[i]!;
        if (b.type === 'text') b.paragraphs = list.map((t) => ({ ...(b.paragraphs[0] ?? para('')), runs: [{ text: t }] }));
      });
    }
    return {
      id: crypto.randomUUID().replace(/-/g, '').slice(0, 16),
      layout,
      background: null,
      elements: els,
      notes: ps.notes ?? '',
      hidden: false,
      transition: { kind: 'fade', duration: 500, direction: 'left', advanceAfter: 0 },
      animations: [],
    } satisfies Slide;
  });
}
