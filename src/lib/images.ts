// Image generation for the Images view.
//  - Puter (free with a Puter account): puter.ai.txt2img, many models.
//  - JeeA Gateway (site owner's Cloudflare Workers AI): FLUX.1 [schnell].
//  - OpenAI with your own key: POST /images/generations (GPT image models
//    always return base64).
import { create } from 'zustand';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import { gatewayInfo, getProvider, slotsFor } from './settings';
import { loadPuter, puterSignIn } from './llm';
import { log } from './logs';
import { uid } from './utils';

export type ImageSource = 'puter' | 'gateway' | 'openai';

export interface ImageModelOption {
  source: ImageSource;
  model: string;
  label: string;
  free: boolean;
}

/** Puter model names as listed in Puter.js (src/modules/ai/types.js, Txt2ImgOptions). */
const PUTER_MODELS: [string, string][] = [
  ['', 'Puter default (GPT Image 2)'],
  ['gemini-3.1-flash-image', 'Gemini 3.1 Flash Image'],
  ['@cf/black-forest-labs/flux-1-schnell', 'FLUX.1 schnell (Cloudflare)'],
  ['black-forest-labs/flux-schnell', 'FLUX schnell (Replicate)'],
  ['grok-imagine-image', 'Grok Imagine'],
];
/** OpenAI image models (openai-node SDK, ImageModel). */
const OPENAI_MODELS: [string, string][] = [
  ['gpt-image-2', 'GPT Image 2'],
  ['gpt-image-1.5', 'GPT Image 1.5'],
  ['gpt-image-1-mini', 'GPT Image 1 mini'],
];

export function imageModels(): ImageModelOption[] {
  const out: ImageModelOption[] = [];
  if (gatewayInfo()) out.push({ source: 'gateway', model: '@cf/black-forest-labs/flux-1-schnell', label: 'FLUX.1 schnell · JeeA Free+', free: true });
  for (const [model, label] of PUTER_MODELS) out.push({ source: 'puter', model, label: `${label} · Puter`, free: true });
  if (slotsFor('openai').some((s) => s.enabled && s.apiKey)) for (const [model, label] of OPENAI_MODELS) out.push({ source: 'openai', model, label: `${label} · your OpenAI key`, free: false });
  return out;
}

export type Ratio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
const RATIO: Record<Ratio, { w: number; h: number; openai: string }> = {
  '1:1': { w: 1, h: 1, openai: '1024x1024' },
  '16:9': { w: 16, h: 9, openai: '1536x1024' },
  '9:16': { w: 9, h: 16, openai: '1024x1536' },
  '4:3': { w: 4, h: 3, openai: '1536x1024' },
  '3:4': { w: 3, h: 4, openai: '1024x1536' },
};

/** MIME type of base64 image data from its first bytes. */
export function mimeOfBase64(b64: string): string {
  if (b64.startsWith('/9j/')) return 'image/jpeg';
  if (b64.startsWith('iVBOR')) return 'image/png';
  if (b64.startsWith('UklGR')) return 'image/webp';
  if (b64.startsWith('R0lGOD')) return 'image/gif';
  return 'image/png';
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** Make one image; resolves to a data: URL. */
export async function generateImage(opt: { source: ImageSource; model: string; prompt: string; ratio: Ratio; signal?: AbortSignal }): Promise<string> {
  const prompt = opt.prompt.trim();
  if (!prompt) throw new Error('Describe the image first.');
  if (opt.source === 'puter') {
    const puter = await loadPuter();
    if (!puter?.auth?.isSignedIn?.()) {
      const ok = await puterSignIn();
      if (!ok) throw new Error('Sign in to Puter to make free images.');
    }
    const r = RATIO[opt.ratio];
    const img = (await puter.ai.txt2img(prompt, { ...(opt.model ? { model: opt.model } : {}), ratio: { w: r.w, h: r.h } })) as HTMLImageElement;
    const src = img?.src;
    if (!src) throw new Error('Puter returned no image.');
    return src.startsWith('data:') ? src : blobToDataUrl(await (await fetch(src)).blob());
  }
  const post = async (url: string, body: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: opt.signal });
    const data = (await res.json().catch(() => ({}))) as { data?: { b64_json?: string; url?: string }[]; error?: { message?: string } };
    if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);
    const first = data.data?.[0];
    if (first?.b64_json) return `data:${mimeOfBase64(first.b64_json)};base64,${first.b64_json}`;
    if (first?.url) return blobToDataUrl(await (await fetch(first.url, { signal: opt.signal })).blob());
    throw new Error('No image came back.');
  };
  if (opt.source === 'gateway') {
    const gw = gatewayInfo();
    if (!gw) throw new Error('This site has no JeeA Gateway.');
    return post(`${gw.baseUrl}/images/generations`, { prompt, steps: 4 });
  }
  const p = getProvider('openai');
  const slot = slotsFor('openai').find((s) => s.enabled && s.apiKey);
  if (!p || !slot) throw new Error('Add an OpenAI key in API Slots first.');
  const base = (slot.baseUrl || p.baseUrl).replace(/\/+$/, '');
  return post(`${base}/images/generations`, { model: opt.model, prompt, size: RATIO[opt.ratio].openai, n: 1 }, { Authorization: `Bearer ${slot.apiKey}` });
}

/** Convert an image to PNG, JPEG or WebP in the browser. */
export async function convertImage(dataUrl: string, type: 'image/png' | 'image/jpeg' | 'image/webp'): Promise<Blob> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext('2d')!;
  if (type === 'image/jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
  }
  ctx.drawImage(img, 0, 0);
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not convert the image.'))), type, 0.95));
}

// ---------------------------------------------------------------------------
// Gallery (kept in this browser, newest first, at most 40 images)
// ---------------------------------------------------------------------------

export interface GenImage {
  id: string;
  prompt: string;
  label: string;
  source: ImageSource;
  model: string;
  ratio: Ratio;
  dataUrl: string;
  createdAt: number;
}

const KEY = 'jeea.images';
interface Gallery {
  images: GenImage[];
  loaded: boolean;
  load: () => Promise<void>;
  add: (img: GenImage) => void;
  remove: (id: string) => void;
}
export const useGallery = create<Gallery>()((set, get) => ({
  images: [],
  loaded: false,
  load: async () => {
    if (get().loaded) return;
    const saved = ((await idbGet(KEY).catch(() => undefined)) as GenImage[] | undefined) ?? [];
    set({ images: saved, loaded: true });
  },
  add: (img) => {
    const images = [img, ...get().images].slice(0, 40);
    set({ images });
    void idbSet(KEY, images).catch(() => undefined);
  },
  remove: (id) => {
    const images = get().images.filter((i) => i.id !== id);
    set({ images });
    void idbSet(KEY, images).catch(() => undefined);
  },
}));

export async function makeAndSave(opt: { option: ImageModelOption; prompt: string; ratio: Ratio; signal?: AbortSignal }): Promise<GenImage> {
  const t0 = performance.now();
  try {
    const dataUrl = await generateImage({ source: opt.option.source, model: opt.option.model, prompt: opt.prompt, ratio: opt.ratio, signal: opt.signal });
    const img: GenImage = { id: uid(), prompt: opt.prompt.trim(), label: opt.option.label, source: opt.option.source, model: opt.option.model, ratio: opt.ratio, dataUrl, createdAt: Date.now() };
    useGallery.getState().add(img);
    log({ level: 'info', type: 'system', feature: 'images', message: `Image made with ${opt.option.label} in ${Math.round(performance.now() - t0)} ms` });
    return img;
  } catch (e) {
    log({ level: 'error', type: 'system', feature: 'images', message: `Image failed (${opt.option.label}): ${(e as Error).message}` });
    throw e;
  }
}
