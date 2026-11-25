import * as Y from 'yjs';
import { DeckDoc, exportPptx, importPptx } from '@deck/core';
import type { EditorStore } from './store';
import { rasterizeSvg } from './assets';
import { toast } from './toast';

export function download(bytes: Uint8Array | Blob, name: string, type = 'application/octet-stream') {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 180);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** Export to .pptx. Returns warnings so the UI can tell the user exactly what was approximated. */
export async function exportToPptx(store: EditorStore): Promise<string[]> {
  const pres = store.pres;
  const assets: Record<string, Uint8Array> = {};
  for (const id of Object.keys(pres.assets)) {
    const b = store.deck.getAsset(id);
    if (b) assets[id] = b;
  }
  const { bytes, warnings } = await exportPptx(pres, { assets, rasterizeSvg, appName: 'DECK' });
  download(bytes, `${pres.title || 'Presentation'}.pptx`, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  return warnings;
}

/** Export DECK's native format: the full Yjs state (lossless, includes assets). */
export async function exportNative(store: EditorStore) {
  download(Y.encodeStateAsUpdate(store.deck.doc), `${store.pres.title || 'Presentation'}.deck`, 'application/x-deck');
}

export const MAX_IMPORT_BYTES = 300 * 1024 * 1024;

export async function readPresentationFile(file: File) {
  if (file.size > MAX_IMPORT_BYTES) throw new Error('File is larger than 300 MB');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (/\.deck$/i.test(file.name)) {
    const d = new DeckDoc();
    try {
      Y.applyUpdate(d.doc, bytes);
    } catch {
      throw new Error('This .deck file is damaged or not a DECK document');
    }
    const assets: Record<string, Uint8Array> = {};
    for (const [k, v] of d.assetData.entries()) assets[k] = v;
    return { presentation: d.presentation, assets };
  }
  if (/\.key$/i.test(file.name)) throw new Error('.key packages cannot be opened directly. Export the presentation as .pptx from the application that created it, then import the .pptx (see docs/COMPATIBILITY.md).');
  return importPptx(bytes, file.name);
}

/** Print / save as PDF: renders every visible slide as one page sized exactly to the slide. */
export function printDeck(setPrinting: (v: boolean) => void) {
  setPrinting(true);
  // Give the print tree a frame to render and images to decode.
  setTimeout(async () => {
    const imgs = Array.from(document.querySelectorAll<SVGImageElement>('.print-root image'));
    await Promise.all(imgs.map((i) => new Promise((r) => { const im = new Image(); im.onload = im.onerror = r; im.src = i.href.baseVal; })));
    await document.fonts.ready;
    window.print();
    setPrinting(false);
  }, 120);
}

export function reportWarnings(w: string[]) {
  if (!w.length) toast('Exported .pptx');
  else toast(`Exported .pptx with ${w.length} note${w.length > 1 ? 's' : ''} — see Review › Export notes`, 4000);
}
