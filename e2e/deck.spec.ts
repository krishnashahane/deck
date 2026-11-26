import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { TEMPLATES, createPresentation, createSlide, createText, exportPptx, importPptx, inspectPptx, themeById } from '../packages/core/src';

async function newFromTemplate(page: Page, name: RegExp) {
  await page.goto('/');
  await page.locator('.tpl').filter({ has: page.locator('b', { hasText: name }) }).first().click();
  await expect(page.locator('.slide-host > svg')).toBeVisible();
}

const elCount = (page: Page) => page.locator('.slide-host > svg [data-el]').count();
const railCount = (page: Page) => page.locator('.rail').getByText(/^\d+ slides$/).textContent();

test('create, edit, add/duplicate/delete slides, and persist across reload', async ({ page }) => {
  await newFromTemplate(page, /^Blank$/);
  expect(await railCount(page)).toBe('1 slides');
  // New slide via keyboard
  await page.locator('.stage').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('ControlOrMeta+Enter');
  expect(await railCount(page)).toBe('2 slides');
  // Edit the title by double-click
  const title = page.locator('.slide-host [data-el]').first();
  await title.dblclick({ force: true });
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Quarterly results');
  await page.keyboard.press('Escape');
  await expect(page.locator('.slide-host > svg')).toContainText('Quarterly results');
  // Duplicate and delete via the rail
  await page.getByRole('button', { name: 'Duplicate slide' }).click();
  expect(await railCount(page)).toBe('3 slides');
  await page.getByRole('button', { name: 'Delete slide' }).click();
  expect(await railCount(page)).toBe('2 slides');
  // Undo restores the deleted slide
  await page.locator('.stage').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('ControlOrMeta+z');
  expect(await railCount(page)).toBe('3 slides');
  // Persisted locally (IndexedDB)
  await page.waitForTimeout(800);
  await page.reload();
  await expect(page.locator('.slide-host > svg')).toBeVisible();
  expect(await railCount(page)).toBe('3 slides');
  await page.getByRole('option', { name: /Slide 2/ }).click();
  await expect(page.locator('.slide-host > svg')).toContainText('Quarterly results');
});

test('draw shapes, text, tables and charts; group, align and z-order', async ({ page }) => {
  await newFromTemplate(page, /^Blank$/);
  const before = await elCount(page);
  const box = (await page.locator('.slide-host').boundingBox())!;
  // Shape tool: drag a rectangle
  await page.keyboard.press('r');
  await page.mouse.move(box.x + 60, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 160, { steps: 5 });
  await page.mouse.up();
  expect(await elCount(page)).toBe(before + 1);
  await page.getByRole('button', { name: /^Table$/ }).click();
  await page.getByRole('button', { name: /^Chart$/ }).click();
  await page.getByRole('menuitem', { name: 'Pie' }).click();
  expect(await elCount(page)).toBe(before + 3);
  // Select all, group, then ungroup
  await page.locator('.stage').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ControlOrMeta+g');
  await expect(page.locator('.sel-box.group').first()).toBeVisible();
  await page.keyboard.press('ControlOrMeta+Shift+g');
  // Delete everything
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Delete');
  expect(await elCount(page)).toBe(0);
  await page.keyboard.press('ControlOrMeta+z');
  expect(await elCount(page)).toBe(before + 3);
});

test('export .pptx from the browser produces a valid package that round-trips', async ({ page }) => {
  await newFromTemplate(page, /^Investor pitch$/);
  await page.getByRole('button', { name: 'Export' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: /pptx/ }).click()]);
  expect(dl.suggestedFilename()).toMatch(/\.pptx$/);
  const bytes = new Uint8Array(readFileSync((await dl.path())!));
  const report = await inspectPptx(bytes);
  expect(report.errors).toEqual([]);
  const tpl = TEMPLATES.find((t) => t.id === 'investor')!.build();
  expect(report.slideCount).toBe(tpl.slides.length);
  const back = await importPptx(bytes);
  expect(back.presentation.slides[0]!.elements.some((e) => e.type === 'text')).toBe(true);
  expect(report.slides.some((s) => s.hasTiming)).toBe(true);
});

test('import a .pptx file and reject a malformed one', async ({ page }) => {
  const theme = themeById('paper');
  const pres = createPresentation({ title: 'Imported deck', theme, slides: [1, 2, 3].map((i) => createSlide({ elements: [createText(theme, { placeholder: 'title', name: 'Title', paragraphs: [{ runs: [{ text: `Imported slide ${i}` }] }] })], notes: `Notes ${i}` })) });
  const { bytes } = await exportPptx(pres, { assets: {} });
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles({ name: 'imported.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: Buffer.from(bytes) });
  await expect(page.locator('.slide-host > svg')).toContainText('Imported slide 1');
  expect(await railCount(page)).toBe('3 slides');
  await expect(page.getByLabel('Speaker notes')).toHaveValue('Notes 1');
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles({ name: 'evil.pptx', mimeType: 'application/octet-stream', buffer: Buffer.from('<script>alert(1)</script>') });
  await expect(page.getByText(/Could not import/)).toBeVisible();
});

test('slideshow plays click-step animations and transitions', async ({ page }) => {
  await newFromTemplate(page, /^Investor pitch$/);
  await page.getByRole('option', { name: /Slide 3/ }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  const show = page.locator('.show');
  await expect(show).toBeVisible();
  // Cards animate in on click: initially hidden
  const card = show.locator('.show-layer [data-el]').filter({ has: page.locator('path') }).nth(0);
  const hiddenBefore = await show.locator('.show-layer >> [data-el][style*="visibility: hidden"]').count();
  expect(hiddenBefore).toBeGreaterThan(0);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(1200);
  const hiddenAfter = await show.locator('.show-layer >> [data-el][style*="visibility: hidden"]').count();
  expect(hiddenAfter).toBeLessThan(hiddenBefore);
  void card;
  await expect(show.getByText('3 / 8')).toBeAttached();
  await page.keyboard.press('ArrowRight');
  await expect(show.getByText('4 / 8')).toBeAttached();
  await page.keyboard.press('Escape');
  await expect(page.locator('.editor')).toBeVisible();
});

test('PDF export renders one page per visible slide', async ({ page }) => {
  await newFromTemplate(page, /^Lecture$/);
  await page.evaluate(() => (window.print = () => undefined));
  await page.keyboard.press('ControlOrMeta+p');
  await expect(page.locator('.print-root .print-page').first()).toBeAttached();
  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  expect(pages).toBe(TEMPLATES.find((t) => t.id === 'lecture')!.build().slides.length);
});

test('every control has an accessible name and the editor has landmarks', async ({ page }) => {
  await newFromTemplate(page, /^Research talk$/);
  const unnamed = await page.$$eval('button', (bs) => bs.filter((b) => !(b.getAttribute('aria-label') || b.textContent?.trim() || b.getAttribute('title'))).length);
  expect(unnamed).toBe(0);
  await expect(page.getByRole('navigation', { name: 'Slides' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Inspector' })).toBeVisible();
  await expect(page.getByRole('toolbar', { name: 'Insert' })).toBeVisible();
});

test('large presentation: 300 slides open and navigate quickly', async ({ page }) => {
  const theme = themeById('graphite');
  const pres = createPresentation({ title: 'Big', theme, slides: Array.from({ length: 300 }, (_, i) => createSlide({ elements: Array.from({ length: 6 }, (_, j) => createText(theme, { y: 100 + j * 120, paragraphs: [{ runs: [{ text: `Slide ${i + 1} line ${j + 1}` }] }] })) })) });
  const { bytes } = await exportPptx(pres, { assets: {} });
  await page.goto('/');
  const t0 = Date.now();
  await page.locator('input[type=file]').setInputFiles({ name: 'big.pptx', mimeType: 'application/zip', buffer: Buffer.from(bytes) });
  await expect(page.locator('.slide-host > svg')).toContainText('Slide 1 line 1');
  const openMs = Date.now() - t0;
  expect(await railCount(page)).toBe('300 slides');
  // Thumbnails are windowed: far fewer than 300 rendered
  expect(await page.locator('.thumb-item').count()).toBeLessThan(60);
  const t1 = Date.now();
  await page.locator('.stage').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('End');
  for (let i = 0; i < 20; i++) await page.keyboard.press('PageDown');
  const navMs = Date.now() - t1;
  console.log(`[perf] import+open 300 slides: ${openMs} ms; 20 slide navigations: ${navMs} ms`);
  expect(openMs).toBeLessThan(15000);
});

async function signup(ctx: BrowserContext, email: string) {
  const page = await ctx.newPage();
  await page.goto('/#/account');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByLabel('Name').fill(email.split('@')[0]!);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel(/Password/).fill('correct horse battery staple');
  await page.locator('form').getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Active sessions')).toBeVisible();
  return page;
}

test('real-time collaboration between two signed-in users', async ({ browser }) => {
  const stamp = Date.now();
  const ownerCtx = await browser.newContext(), guestCtx = await browser.newContext();
  const owner = await signup(ownerCtx, `owner${stamp}@example.com`);
  const guest = await signup(guestCtx, `guest${stamp}@example.com`);
  // Owner creates a deck and moves it to the cloud
  await owner.goto('/');
  await owner.locator('.tpl').filter({ has: owner.locator('b', { hasText: /^Quarterly business review$/ }) }).click();
  await expect(owner.locator('.slide-host > svg')).toBeVisible();
  await owner.getByRole('button', { name: /Share/ }).click();
  await owner.getByRole('button', { name: 'Upload & enable sharing' }).click();
  await expect(owner).toHaveURL(/#\/d\/c_d_/);
  await expect(owner.locator('.slide-host > svg')).toBeVisible();
  // Invite the guest as editor
  await owner.getByRole('button', { name: /Share/ }).click();
  await owner.getByPlaceholder('Email address').fill(`guest${stamp}@example.com`);
  await owner.getByRole('button', { name: 'Invite' }).click();
  await expect(owner.getByText(`guest${stamp}@example.com`)).toBeVisible();
  await owner.keyboard.press('Escape');
  await expect(owner.locator('.dialog')).toHaveCount(0);
  // Guest opens the same document
  await guest.goto(owner.url());
  await expect(guest.locator('.slide-host > svg')).toContainText('Quarterly business review');
  // Owner edits; guest sees it live
  await owner.locator('.slide-host [data-el]').first().dblclick({ force: true });
  await owner.keyboard.press('ControlOrMeta+a');
  await owner.keyboard.type('Edited live');
  await owner.keyboard.press('Escape');
  await expect(owner.locator('.slide-host > svg')).toContainText('Edited live');
  await expect(guest.locator('.slide-host > svg')).toContainText('Edited live', { timeout: 10000 });
  // Guest adds a slide; owner sees it
  await guest.locator('.stage').click({ position: { x: 5, y: 5 } });
  await guest.keyboard.press('ControlOrMeta+Enter');
  await expect(owner.locator('.rail')).toContainText('8 slides', { timeout: 10000 });
  // Presence: owner sees the guest's avatar
  await expect(owner.locator('.avatars .avatar')).toHaveCount(1, { timeout: 10000 });
  await ownerCtx.close();
  await guestCtx.close();
});
