import { createAnimation, createChart, uid, createPresentation, createShape, createSlide, createTable, createText, para } from './factory';
import { layoutById } from './layouts';
import type { LayoutId, Presentation, Slide, SlideElement, TextElement, Theme } from './model';
import { themeById } from './themes';

/**
 * Templates contain structure and placeholder guidance only — no invented
 * figures, names or claims. Every number is an obvious placeholder.
 */
export interface TemplateDef {
  id: string;
  name: string;
  category: 'Business' | 'Education' | 'Research' | 'Investor pitch' | 'Product launch' | 'Technical' | 'Blank';
  description: string;
  themeId: string;
  build: () => Presentation;
}

type Fill = (els: SlideElement[]) => void;

function slide(pres: Presentation, layout: LayoutId, texts: Record<string, string | string[]>, extra: (t: Theme, w: number, h: number) => SlideElement[] = () => [], tweak?: Fill): Slide {
  const els = layoutById(layout).build(pres.theme, pres.width, pres.height);
  for (const el of els) {
    if (el.type !== 'text') continue;
    const v = texts[el.name];
    if (v === undefined) continue;
    const lines = Array.isArray(v) ? v : [v];
    el.paragraphs = lines.map((l, i) => ({ ...(el.paragraphs[Math.min(i, el.paragraphs.length - 1)] ?? para('')), runs: [{ text: l }] }));
  }
  const all = [...els, ...extra(pres.theme, pres.width, pres.height)];
  tweak?.(all);
  return createSlide({ layout, elements: all, transition: { kind: 'fade', duration: 500, direction: 'left', advanceAfter: 0 } });
}

function kicker(t: Theme, w: number, text: string): TextElement {
  return createText(t, {
    name: 'Kicker',
    x: w * 0.0833,
    y: 72,
    w: 900,
    h: 48,
    paragraphs: [para(text.toUpperCase())],
    style: { ...createText(t).style, size: 16, bold: true, color: t.colors.accent, letterSpacing: 0.16, padding: 0 },
  });
}

function cards(t: Theme, w: number, h: number, items: [string, string][], top = 0.36): SlideElement[] {
  const m = w * 0.0833, gap = 40;
  const cw = (w - 2 * m - gap * (items.length - 1)) / items.length;
  return items.flatMap(([title, body], i) => {
    const x = m + i * (cw + gap);
    const groupId = uid('gr');
    return ([
      createShape(t, 'roundRect', { name: `Card ${i + 1}`, x, y: h * top, w: cw, h: h * 0.46, cornerRadius: t.radius, fill: { kind: 'solid', color: t.colors.surface } }),
      createText(t, { name: `Card ${i + 1} title`, x: x + 40, y: h * top + 44, w: cw - 80, h: 90, paragraphs: [para(title)], style: { ...createText(t).style, font: t.fonts.heading, size: 34, bold: true, padding: 0 } }),
      createText(t, { name: `Card ${i + 1} body`, x: x + 40, y: h * top + 150, w: cw - 80, h: h * 0.46 - 190, paragraphs: [para(body)], style: { ...createText(t).style, size: 22, color: t.colors.muted, lineHeight: 1.4, padding: 0 } }),
    ] as SlideElement[]).map((e) => ({ ...e, groupId }));
  });
}

/** Every element whose name starts with a card label rises in together with its card, cards staggered. */
function staggerIn(s: Slide, names: RegExp): Slide {
  const targets = s.elements.filter((e) => names.test(e.name));
  s.animations = targets.map((e, i) => {
    const card = Number(/(\d+)/.exec(e.name)?.[1] ?? 1) - 1;
    return createAnimation(e.id, { effect: 'rise', trigger: i === 0 ? 'click' : 'with', delay: card * 150, duration: 600 });
  });
  return s;
}

function make(themeId: string, title: string, build: (p: Presentation) => Slide[]): Presentation {
  const pres = createPresentation({ title, theme: themeById(themeId) });
  pres.slides = build(pres);
  return pres;
}

export const TEMPLATES: TemplateDef[] = [
  {
    id: 'blank',
    name: 'Blank',
    category: 'Blank',
    description: 'A single title slide on the Graphite theme.',
    themeId: 'graphite',
    build: () => make('graphite', 'Untitled presentation', (p) => [slide(p, 'title', { Title: 'Untitled presentation', Subtitle: 'Click to add a subtitle' })]),
  },
  {
    id: 'business-review',
    name: 'Quarterly business review',
    category: 'Business',
    description: 'Agenda, highlights, metrics chart, risks and next steps.',
    themeId: 'meridian',
    build: () =>
      make('meridian', 'Quarterly business review', (p) => [
        slide(p, 'title', { Title: 'Quarterly business review', Subtitle: 'Team name · Quarter · Presenter' }),
        slide(p, 'title-content', { Title: 'Agenda', Body: ['Highlights', 'Key metrics', 'Risks and mitigations', 'Priorities for next quarter'] }),
        staggerIn(slide(p, 'title-only', { Title: 'Highlights' }, (t, w, h) => cards(t, w, h, [['Win', 'Describe the most important result and why it matters.'], ['Learning', 'What did the team learn that changes the plan?'], ['Focus', 'Where will the team concentrate next?']])), /^Card \d/),
        slide(p, 'title-only', { Title: 'Key metrics' }, (t, w, h) => [createChart(t, 'column', { x: w * 0.0833, y: h * 0.3, w: w * 0.8334, h: h * 0.6, categories: ['Month 1', 'Month 2', 'Month 3'], series: [{ name: 'Replace with your data', values: [1, 2, 3] }] })]),
        slide(p, 'two-column', { Title: 'Risks and mitigations', Body: ['Risk — describe it', 'Impact and likelihood'] }),
        slide(p, 'section', { Title: 'Next quarter' }),
        slide(p, 'title-content', { Title: 'Priorities', Body: ['Priority one — owner, date', 'Priority two — owner, date', 'Priority three — owner, date'] }),
      ]),
  },
  {
    id: 'lecture',
    name: 'Lecture',
    category: 'Education',
    description: 'Learning objectives, concept slides, worked example, quiz and summary.',
    themeId: 'paper',
    build: () =>
      make('paper', 'Lecture title', (p) => [
        slide(p, 'title', { Title: 'Lecture title', Subtitle: 'Course · Week · Instructor' }),
        slide(p, 'title-content', { Title: 'Learning objectives', Body: ['By the end of this session you will be able to…', 'Explain …', 'Apply …'] }, () => [], (els) => els.forEach((e) => e.type === 'text' && e.placeholder === 'body' && e.paragraphs.forEach((pp, i) => (pp.bullet = i ? 'number' : 'none')))),
        slide(p, 'quote', { Quote: '“A guiding question for today’s session?”', Attribution: 'Think about this as we go' }),
        slide(p, 'image-left', { Title: 'Key concept', Body: ['Define the concept in one sentence', 'Give a concrete example'] }),
        slide(p, 'title-only', { Title: 'Worked example' }, (t, w, h) => [createTable(t, 4, 3, { x: w * 0.0833, y: h * 0.3, w: w * 0.8334, h: h * 0.5, rows: [[{ text: 'Step' }, { text: 'What we do' }, { text: 'Why' }], [{ text: '1' }, { text: '' }, { text: '' }], [{ text: '2' }, { text: '' }, { text: '' }], [{ text: '3' }, { text: '' }, { text: '' }]] })]),
        slide(p, 'big-number', { Number: '?', Caption: 'Quick check: pose a question to the room.' }),
        slide(p, 'title-content', { Title: 'Summary', Body: ['Takeaway one', 'Takeaway two', 'Reading for next week'] }),
      ]),
  },
  {
    id: 'research',
    name: 'Research talk',
    category: 'Research',
    description: 'Motivation, method, results with chart, limitations and references.',
    themeId: 'sandstone',
    build: () =>
      make('sandstone', 'Research talk', (p) => [
        slide(p, 'title', { Title: 'Paper or project title', Subtitle: 'Authors · Affiliation · Venue' }),
        slide(p, 'title-content', { Title: 'Motivation', Body: ['The problem', 'Why existing approaches fall short', 'Our question'] }),
        slide(p, 'title-content', { Title: 'Method', Body: ['Data and setting', 'Approach', 'Evaluation'] }),
        slide(p, 'title-only', { Title: 'Results' }, (t, w, h) => [createChart(t, 'line', { x: w * 0.0833, y: h * 0.28, w: w * 0.8334, h: h * 0.62, categories: ['A', 'B', 'C', 'D'], series: [{ name: 'Replace with measured values', values: [0, 0, 0, 0] }] })]),
        slide(p, 'two-column', { Title: 'Limitations & future work', Body: ['Limitation', 'Next step'] }),
        slide(p, 'title-content', { Title: 'References', Body: ['Add each reference you cite'] }),
      ]),
  },
  {
    id: 'investor',
    name: 'Investor pitch',
    category: 'Investor pitch',
    description: 'Problem, solution, market, traction, business model, team and ask.',
    themeId: 'graphite',
    build: () =>
      make('graphite', 'Company — investor presentation', (p) => [
        slide(p, 'title', { Title: 'Company name', Subtitle: 'One sentence that says what you do' }, (t, w) => [kicker(t, w, 'Seed round')]),
        slide(p, 'big-number', { Number: 'The problem', Caption: 'Who has it, how often, and what it costs them.' }, () => [], (els) => els.forEach((e) => e.type === 'text' && e.name === 'Number' && (e.style.size = 140))),
        staggerIn(slide(p, 'title-only', { Title: 'Our solution' }, (t, w, h) => cards(t, w, h, [['Insight', 'What you understand that others miss.'], ['Product', 'What it does, in plain words.'], ['Why now', 'What changed that makes this possible.']])), /^Card \d/),
        slide(p, 'title-only', { Title: 'Market' }, (t, w, h) => [createChart(t, 'donut', { x: w * 0.2, y: h * 0.26, w: w * 0.6, h: h * 0.66, categories: ['Segment A', 'Segment B', 'Segment C'], series: [{ name: 'Replace with sourced estimates', values: [1, 1, 1] }] })]),
        slide(p, 'big-number', { Number: '00', Caption: 'Traction metric — state the source and date.' }),
        slide(p, 'two-column', { Title: 'Business model', Body: ['How you charge', 'Unit economics (sourced)'] }),
        slide(p, 'title-only', { Title: 'Team' }, (t, w, h) => cards(t, w, h, [['Name', 'Role · relevant experience'], ['Name', 'Role · relevant experience'], ['Name', 'Role · relevant experience']])),
        slide(p, 'section', { Title: 'The ask' }),
      ]),
  },
  {
    id: 'launch',
    name: 'Product launch',
    category: 'Product launch',
    description: 'Reveal, key features, how it works, availability.',
    themeId: 'noir',
    build: () =>
      make('noir', 'Product launch', (p) => {
        const reveal = slide(p, 'title', { Title: 'Introducing Product', Subtitle: 'The one line that makes people lean in' });
        reveal.transition = { kind: 'zoom', duration: 900, direction: 'left', advanceAfter: 0 };
        reveal.animations = reveal.elements.map((e, i) => createAnimation(e.id, { effect: i ? 'fade' : 'blur', trigger: i ? 'after' : 'click', duration: 900 }));
        return [
          reveal,
          staggerIn(slide(p, 'title-only', { Title: 'What’s new' }, (t, w, h) => cards(t, w, h, [['Feature', 'Benefit, not mechanism.'], ['Feature', 'Benefit, not mechanism.'], ['Feature', 'Benefit, not mechanism.']])), /^Card \d/),
          slide(p, 'image-left', { Title: 'How it works', Body: ['Step one', 'Step two', 'Step three'] }),
          slide(p, 'quote', { Quote: '“A real customer quote, with permission.”', Attribution: '— Name, Company' }),
          slide(p, 'big-number', { Number: 'Today', Caption: 'Availability, pricing and where to get it.' }),
        ];
      }),
  },
  {
    id: 'technical',
    name: 'Technical deep dive',
    category: 'Technical',
    description: 'Architecture diagram, API table, performance chart, trade-offs.',
    themeId: 'terminal',
    build: () =>
      make('terminal', 'Technical deep dive', (p) => [
        slide(p, 'title', { Title: 'System name: deep dive', Subtitle: 'Team · Date · Design review' }),
        slide(p, 'title-content', { Title: 'Goals & non-goals', Body: ['Goal', 'Goal', 'Non-goal'] }),
        slide(p, 'title-only', { Title: 'Architecture' }, (t, w, h) => {
          const box = (name: string, x: number) => createShape(t, 'roundRect', { name, x, y: h * 0.45, w: 360, h: 180, cornerRadius: 16, fill: { kind: 'solid', color: t.colors.surface }, stroke: { color: t.colors.accent, width: 2, dash: 'solid' }, paragraphs: [para(name)], style: { ...createText(t).style, align: 'center', valign: 'middle', size: 26, color: t.colors.text, font: t.fonts.mono } });
          const a = box('Client', w * 0.0833), b = box('Service', w * 0.5 - 180), c = box('Storage', w * 0.9167 - 360);
          const ln = (from: SlideElement, to: SlideElement) => ({ id: uid('el'), type: 'line' as const, name: 'Connector', x: from.x + from.w, y: from.y + from.h / 2, w: to.x - from.x - from.w, h: 0, rotation: 0, opacity: 1, x1: from.x + from.w, y1: from.y + from.h / 2, x2: to.x, y2: to.y + to.h / 2, stroke: { color: t.colors.accent, width: 3, dash: 'solid' as const }, startArrow: 'none' as const, endArrow: 'arrow' as const, curve: 'straight' as const, from: from.id, to: to.id });
          return [a, b, c, ln(a, b), ln(b, c)];
        }),
        slide(p, 'title-only', { Title: 'API surface' }, (t, w, h) => [createTable(t, 4, 3, { x: w * 0.0833, y: h * 0.3, w: w * 0.8334, h: h * 0.5, style: { ...createTable(t).style, font: t.fonts.mono }, rows: [[{ text: 'Endpoint' }, { text: 'Method' }, { text: 'Purpose' }], [{ text: '/resource' }, { text: 'GET' }, { text: '' }], [{ text: '/resource' }, { text: 'POST' }, { text: '' }], [{ text: '/resource/:id' }, { text: 'DELETE' }, { text: '' }]] })]),
        slide(p, 'title-only', { Title: 'Performance' }, (t, w, h) => [createChart(t, 'bar', { x: w * 0.0833, y: h * 0.28, w: w * 0.8334, h: h * 0.62, categories: ['p50', 'p95', 'p99'], series: [{ name: 'Replace with measured latency (ms)', values: [0, 0, 0] }] })]),
        slide(p, 'two-column', { Title: 'Trade-offs', Body: ['Option A — pros / cons', 'Option B — pros / cons'] }),
      ]),
  },
];

export function templateById(id: string): TemplateDef | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
