export const uid = (): string =>
  (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

export const now = () => Date.now();

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Rough token estimate (about 4 characters per token for English text). */
export const estimateTokens = (text: string) => Math.max(0, Math.ceil(text.length / 4));

export const maskKey = (key: string) => {
  if (!key) return 'no key';
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
};

export const fmtMs = (ms?: number) => {
  if (ms == null || !isFinite(ms)) return '–';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`;
};

export const fmtNum = (n?: number) => (n == null ? '–' : n.toLocaleString());

export const fmtTime = (ts: number) =>
  new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export const fmtDateTime = (ts: number) =>
  new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export function dayBucket(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = (today.getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86400000;
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return 'Previous 7 days';
  if (diff < 30) return 'Previous 30 days';
  return 'Older';
}

export function downloadText(filename: string, text: string, type = 'text/plain') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

export const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

export const isAbort = (e: unknown) =>
  (e instanceof DOMException && e.name === 'AbortError') ||
  (typeof e === 'object' && e !== null && ((e as { name?: string }).name === 'AbortError' || (e as { name?: string }).name === 'APIUserAbortError'));

export const titleFrom = (text: string, max = 48) => {
  // Leave out attached files' text; use the first file's name when there is no question.
  const at = text.indexOf('**Attached file: ');
  const file = at >= 0 ? /\*\*Attached file: ([^*\n]+)\*\*/.exec(text.slice(at))?.[1] : undefined;
  const body = at >= 0 ? text.slice(0, at) : text;
  const t = (body.trim() ? body : file ?? body).replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t || 'New chat';
};
