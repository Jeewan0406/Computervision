// Files and pictures added to the message box: what to do on paste, which
// files are pictures, and making pictures small enough to send.
import type { ImageAtt } from './types';

export const PICTURE_TYPES = /^image\/(png|jpe?g|webp|gif|bmp|avif)$/i;
export const PICTURE_EXT = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;
export const isPicture = (f: { name: string; type: string }) => PICTURE_TYPES.test(f.type) || (!f.type && PICTURE_EXT.test(f.name));

/** File picker filter: documents, code and pictures. */
export const ATTACH_ACCEPT =
  '.txt,.md,.markdown,.csv,.tsv,.json,.xml,.html,.htm,.css,.js,.jsx,.ts,.tsx,.py,.java,.c,.cpp,.cs,.go,.rs,.rb,.php,.sql,.yaml,.yml,.tex,.bib,.log,.ini,.toml,.rtf,.sh,.r,.m,.swift,.kt,.pdf,.docx,.pptx,.ppsx,.xlsx,.xlsm,.png,.jpg,.jpeg,.webp,.gif,.bmp,.avif,image/*';

/** Characters of one file's text sent with a message. */
export const MAX_ATTACH_CHARS = 300_000;

/**
 * What a paste should do.
 * - 'text': let the browser paste the text. Copying from Word, PowerPoint,
 *   Excel or a web page puts the text AND a picture of it on the clipboard;
 *   the text is what people mean, so the picture is ignored.
 * - 'files': attach the files (a copied file, a screenshot, a copied picture).
 */
export function pasteAction(text: string, files: { name: string; type: string }[]): 'text' | 'files' {
  if (!files.length) return 'text';
  if (files.some((f) => !isPicture(f))) return 'files'; // a document copied in the file manager
  const t = text.trim();
  if (!t) return 'files';
  // Some systems also put the copied file's name on the clipboard as text.
  if (files.some((f) => f.name && t === f.name)) return 'files';
  return 'text';
}

/** Longest side of a picture sent to a model (larger pictures cost more and are cut down by the providers anyway). */
export const MAX_SIDE = 1568;

/** Read a picture and make it at most MAX_SIDE pixels on its longest side. Browser only. */
export async function loadPicture(file: File): Promise<ImageAtt> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    throw new Error(`${file.name}: this picture format cannot be opened in the browser. Use PNG, JPEG or WebP.`);
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const small = /^image\/(png|jpeg|webp)$/i.test(file.type) && scale === 1 && file.size <= 1_500_000;
  if (small) {
    bmp.close();
    return { name: file.name || 'picture', dataUrl: await asDataUrl(file) };
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot resize pictures.');
  ctx.fillStyle = '#ffffff'; // JPEG has no transparency
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return { name: file.name || 'picture', dataUrl: canvas.toDataURL('image/jpeg', 0.88) };
}

function asDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('Could not read the picture.'));
    r.readAsDataURL(file);
  });
}

/** Approximate size of a data: URL in kilobytes (for the chip label). */
export const dataUrlKb = (u: string) => Math.round((u.length * 3) / 4 / 1024);
