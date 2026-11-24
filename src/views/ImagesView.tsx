import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, ImagePlus, Sparkles, Trash2, Wand2 } from 'lucide-react';
import { TopBar } from '../components/Shell';
import { useUI } from '../lib/ui';
import { useRuntime, useSettings } from '../lib/settings';
import { convertImage, imageModels, makeAndSave, useGallery, type GenImage, type ImageModelOption, type Ratio } from '../lib/images';
import { fileBase } from '../lib/exporter';

const RATIOS: Ratio[] = ['1:1', '16:9', '9:16', '4:3', '3:4'];
const IDEAS = [
  'A watercolour of Tashichho Dzong at sunrise, prayer flags in the wind',
  'A clean infographic-style illustration of how a hydropower plant works, labelled parts',
  'A friendly cartoon yak reading a book under a blue pine tree',
  'A photorealistic bowl of ema datshi on a wooden table, soft daylight',
];

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function ImageCard({ img }: { img: GenImage }) {
  const toast = useUI((s) => s.toast);
  const remove = useGallery((s) => s.remove);
  const download = async (type: 'image/png' | 'image/jpeg' | 'image/webp') => {
    try {
      const ext = type.split('/')[1].replace('jpeg', 'jpg');
      save(await convertImage(img.dataUrl, type), `${fileBase(img.prompt)}.${ext}`);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  return (
    <figure className="img-card">
      <img src={img.dataUrl} alt={img.prompt} loading="lazy" />
      <figcaption>
        <span className="img-prompt" title={img.prompt}>{img.prompt}</span>
        <span className="muted xs">{img.label} · {img.ratio} · {new Date(img.createdAt).toLocaleString()}</span>
        <span className="img-actions">
          <button className="btn ghost xs" onClick={() => download('image/png')}><Download size={13} /> PNG</button>
          <button className="btn ghost xs" onClick={() => download('image/jpeg')}>JPG</button>
          <button className="btn ghost xs" onClick={() => download('image/webp')}>WebP</button>
          <button className="icon-btn xs" title="Delete" aria-label="Delete image" onClick={() => remove(img.id)}><Trash2 size={13} /></button>
        </span>
      </figcaption>
    </figure>
  );
}

export function ImagesView() {
  const toast = useUI((s) => s.toast);
  const runtime = useRuntime((s) => s.v);
  const slots = useSettings((s) => s.slots);
  const options = useMemo(() => imageModels(), [runtime, slots]); // eslint-disable-line react-hooks/exhaustive-deps
  const [choice, setChoice] = useState(0);
  const [prompt, setPrompt] = useState('');
  const [ratio, setRatio] = useState<Ratio>('1:1');
  const [busy, setBusy] = useState(false);
  const ctrl = useRef<AbortController | null>(null);
  const { images, load } = useGallery();
  useEffect(() => void load(), [load]);
  const option: ImageModelOption | undefined = options[Math.min(choice, options.length - 1)];

  const make = async () => {
    if (!option || !prompt.trim() || busy) return;
    setBusy(true);
    ctrl.current = new AbortController();
    try {
      await makeAndSave({ option, prompt, ratio, signal: ctrl.current.signal });
      toast('Image ready', 'success');
    } catch (e) {
      toast(`Could not make the image: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="view images-view">
      <TopBar>
        <span className="topbar-title strong">Images</span>
        <span className="muted sm hide-sm">Describe a picture; JeeA! draws it</span>
      </TopBar>
      <div className="scroll">
        <div className="img-studio">
          <div className="img-form">
            <label className="field">
              <span className="field-label">Describe the image</span>
              <textarea
                value={prompt}
                rows={3}
                placeholder="e.g. A watercolour of Punakha Dzong in spring, jacaranda trees in bloom"
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void make();
                }}
                aria-label="Image description"
              />
            </label>
            <div className="img-ideas">
              {IDEAS.map((i) => (
                <button key={i} className="chip" onClick={() => setPrompt(i)} title={i}><Sparkles size={12} /> {i.split(',')[0]}</button>
              ))}
            </div>
            <div className="img-row">
              <label className="field grow">
                <span className="field-label">Model</span>
                <select value={choice} onChange={(e) => setChoice(Number(e.target.value))} aria-label="Image model">
                  {options.map((o, i) => (
                    <option key={`${o.source}:${o.model}`} value={i}>{o.label}{o.free ? ' · Free' : ''}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">Shape</span>
                <div className="seg" role="radiogroup" aria-label="Image shape">
                  {RATIOS.map((r) => (
                    <button key={r} className={ratio === r ? 'active' : ''} onClick={() => setRatio(r)} role="radio" aria-checked={ratio === r}>{r}</button>
                  ))}
                </div>
              </label>
            </div>
            <div className="row gap-8 wrap">
              <button className="btn primary" onClick={make} disabled={busy || !prompt.trim() || !option}>
                {busy ? <><Wand2 size={16} className="spin" /> Drawing…</> : <><ImagePlus size={16} /> Make image</>}
              </button>
              {busy && <button className="btn ghost" onClick={() => ctrl.current?.abort()}>Stop</button>}
              <span className="muted xs">
                {option?.source === 'puter' && 'Free with a Puter account; the first time, a Puter sign-in window opens. Usage counts against your own Puter allowance.'}
                {option?.source === 'gateway' && 'Free for visitors of this site, on Cloudflare\'s daily allowance; a few images per minute.'}
                {option?.source === 'openai' && 'Uses your own OpenAI key and is charged to your OpenAI account.'}
              </span>
            </div>
          </div>

          {images.length === 0 ? (
            <div className="img-empty">
              <ImagePlus size={36} />
              <p>Your images appear here. They are kept only in this browser (the last 40).</p>
              <p className="muted sm">Download any image as PNG, JPG or WebP. For diagrams and charts, ask in Chat for SVG or HTML and open it in CodeFrame.</p>
            </div>
          ) : (
            <div className="img-grid">
              {images.map((img) => <ImageCard key={img.id} img={img} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
