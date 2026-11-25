import { IMAGE_TYPES, MAX_ASSET_BYTES, MEDIA_TYPES, sanitizeSvg, sniff, type AssetMeta, type DeckDoc } from '@deck/core';

const urlCache = new WeakMap<DeckDoc, Map<string, string>>();

/** Resolve `asset:<id>` to a blob: URL (cached per document). Other URLs are passed through only if they are data:image. */
export function assetUrl(deck: DeckDoc, src: string | undefined): string | undefined {
  if (!src) return undefined;
  if (src.startsWith('data:image/') || src.startsWith('blob:')) return src;
  if (!src.startsWith('asset:')) return undefined; // never load arbitrary remote URLs (privacy / SSRF-by-proxy)
  const id = src.slice(6);
  let cache = urlCache.get(deck);
  if (!cache) urlCache.set(deck, (cache = new Map()));
  const hit = cache.get(id);
  if (hit) return hit;
  const bytes = deck.getAsset(id);
  if (!bytes) return undefined;
  const mime = deck.presentation.assets[id]?.mime ?? 'application/octet-stream';
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  cache.set(id, url);
  return url;
}

export interface AddedAsset {
  src: string;
  meta: AssetMeta;
  kind: 'image' | 'video' | 'audio';
  width: number;
  height: number;
}

async function sha(bytes: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
  return Array.from(d.subarray(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
}

function imageSize(url: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth || 800, h: img.naturalHeight || 600 });
    img.onerror = () => resolve({ w: 800, h: 600 });
    img.src = url;
  });
}

function videoSize(url: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => resolve({ w: v.videoWidth || 1280, h: v.videoHeight || 720 });
    v.onerror = () => resolve({ w: 1280, h: 720 });
    v.src = url;
  });
}

/**
 * Validate a user file by its content, sanitise SVG, store it content-addressed
 * in the document and return a reference. Throws a user-readable error.
 */
export async function addFile(deck: DeckDoc, file: File): Promise<AddedAsset> {
  if (file.size > MAX_ASSET_BYTES) throw new Error(`${file.name} is larger than ${MAX_ASSET_BYTES / 1024 / 1024} MB`);
  let bytes: Uint8Array = new Uint8Array(await file.arrayBuffer());
  const mime = sniff(bytes);
  if (!IMAGE_TYPES.has(mime) && !MEDIA_TYPES.has(mime)) throw new Error(`${file.name} is not a supported image, video or audio file`);
  if (mime === 'image/svg+xml') bytes = new TextEncoder().encode(sanitizeSvg(new TextDecoder().decode(bytes)));
  const id = await sha(bytes);
  const meta: AssetMeta = { id, mime, name: file.name.slice(0, 200), size: bytes.length };
  deck.putAsset(meta, bytes);
  const src = `asset:${id}`;
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const kind = mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : 'audio';
  const size = kind === 'image' ? await imageSize(url) : kind === 'video' ? await videoSize(url) : { w: 480, h: 96 };
  URL.revokeObjectURL(url);
  return { src, meta, kind, width: size.w, height: size.h };
}

/** Rasterise SVG bytes to PNG (used for interoperable export fallbacks). */
export async function rasterizeSvg(svg: Uint8Array, w: number, h: number): Promise<Uint8Array> {
  const url = URL.createObjectURL(new Blob([svg as BlobPart], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('SVG could not be rasterised'));
      img.src = url;
    });
    const scale = Math.min(2, 4096 / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * scale));
    c.height = Math.max(1, Math.round(h * scale));
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b!), 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}
