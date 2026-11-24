// Models that run inside the visitor's own browser: no server, no key.
//  - WebLLM (MLC AI): open models (Llama, Qwen, Phi, Gemma...) on the GPU
//    through WebGPU. The model is downloaded once and kept in the browser cache.
//  - Chrome built-in AI (Gemini Nano): only where the browser offers the
//    Prompt API (LanguageModel). Detected at run time.
// These models are small and see about 4,000 tokens at once, so they get a
// short version of the instructions plus the web results.
import type { ChatMsg, StreamHandlers, CallResult } from './llm';
import { LLMError } from './llm';
import { smallModelMessages } from './small';

export const WEBLLM_ID = 'webllm';
export const CHROME_AI_ID = 'chrome-ai';

export const hasWebGPU = () => typeof navigator !== 'undefined' && 'gpu' in navigator;
export const hasChromeAI = () => typeof globalThis !== 'undefined' && 'LanguageModel' in globalThis;

/** Can this local provider run in this browser at all? */
export function localAvailable(providerId: string): boolean {
  if (providerId === WEBLLM_ID) return hasWebGPU();
  if (providerId === CHROME_AI_ID) return hasChromeAI();
  return false;
}

// ------------------------------------------------------------------ WebLLM

type Engine = {
  chat: { completions: { create: (req: unknown) => Promise<AsyncIterable<{ choices: { delta?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } }>> } };
  interruptGenerate: () => void;
  reload: (model: string) => Promise<void>;
};

let engine: Engine | null = null;
let engineModel = '';
let loading: Promise<Engine> | null = null;
let progressListener: ((text: string) => void) | null = null;

async function getEngine(model: string, onStatus?: (t: string) => void): Promise<Engine> {
  progressListener = onStatus ?? null;
  if (engine && engineModel === model) return engine;
  if (loading) await loading.catch(() => undefined);
  if (engine && engineModel === model) return engine;
  const webllm = await import('@mlc-ai/web-llm');
  const report = (p: { text?: string; progress?: number }) => progressListener?.(`Loading ${model} in your browser: ${Math.round((p.progress ?? 0) * 100)}% (first time only; it is then kept in the browser)`);
  loading = (async () => {
    if (engine) {
      await engine.reload(model);
    } else {
      // A worker keeps the page smooth while the model runs.
      const worker = new Worker(new URL('./webllm.worker.ts', import.meta.url), { type: 'module' });
      engine = (await webllm.CreateWebWorkerMLCEngine(worker, model, { initProgressCallback: report })) as unknown as Engine;
    }
    engineModel = model;
    return engine!;
  })();
  try {
    return await loading;
  } catch (e) {
    engineModel = '';
    throw new LLMError(`The in-browser model could not start: ${(e as Error).message}. It needs WebGPU and enough free graphics memory; try a smaller model.`, { status: 400 });
  } finally {
    loading = null;
  }
}

/** Context size of a WebLLM model (most are 4,096 tokens). */
async function webllmContext(model: string): Promise<number> {
  try {
    const { prebuiltAppConfig } = await import('@mlc-ai/web-llm');
    const rec = prebuiltAppConfig.model_list.find((m) => m.model_id === model) as { overrides?: { context_window_size?: number } } | undefined;
    return rec?.overrides?.context_window_size ?? 4096;
  } catch {
    return 4096;
  }
}

export async function streamWebLLM(model: string, messages: ChatMsg[], signal: AbortSignal, h: StreamHandlers): Promise<CallResult> {
  if (!hasWebGPU()) {
    throw new LLMError('In-browser models need WebGPU, which this browser does not offer. Use a recent Chrome or Edge on a computer, or pick another free model.', { status: 400 });
  }
  const eng = await getEngine(model, h.onStatus);
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  h.onStatus?.('');
  const ctx = await webllmContext(model);
  const stop = () => eng.interruptGenerate();
  signal.addEventListener('abort', stop, { once: true });
  const out: CallResult = { content: '', reasoning: '' };
  try {
    const chunks = await eng.chat.completions.create({ messages: smallModelMessages(messages, ctx), stream: true, stream_options: { include_usage: true } });
    for await (const ch of chunks) {
      const d = ch.choices[0]?.delta?.content ?? '';
      if (d) {
        out.content += d;
        h.onText(d);
      }
      if (ch.usage) {
        out.tokensIn = ch.usage.prompt_tokens;
        out.tokensOut = ch.usage.completion_tokens;
      }
    }
  } finally {
    signal.removeEventListener('abort', stop);
  }
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  return out;
}

/** Models offered for WebLLM: chat models from the library's own list, smallest first. */
export async function webllmModels(): Promise<string[]> {
  const { prebuiltAppConfig } = await import('@mlc-ai/web-llm');
  return prebuiltAppConfig.model_list
    .filter((m) => /q4f16_1-MLC$/.test(m.model_id) && !/embed|snowflake|bge|Base-|Math|jpn/i.test(m.model_id) && ((m as { model_type?: number }).model_type ?? 0) === 0)
    .sort((a, b) => (a.vram_required_MB ?? 0) - (b.vram_required_MB ?? 0))
    .map((m) => m.model_id);
}

// ------------------------------------------------------- Chrome built-in AI

type LMSession = { promptStreaming: (input: string, opts?: { signal?: AbortSignal }) => AsyncIterable<string> | ReadableStream<string>; destroy?: () => void };
type LMStatic = {
  availability: (opts?: unknown) => Promise<string>;
  create: (opts: unknown) => Promise<LMSession>;
};

export async function streamChromeAI(messages: ChatMsg[], signal: AbortSignal, h: StreamHandlers): Promise<CallResult> {
  const LM = (globalThis as unknown as { LanguageModel?: LMStatic }).LanguageModel;
  if (!LM) {
    throw new LLMError('This browser does not offer built-in AI (Gemini Nano). It is available only in some versions of desktop Chrome on supported computers. Pick another free model.', { status: 400 });
  }
  const avail = await LM.availability().catch(() => 'unavailable');
  if (avail === 'unavailable') throw new LLMError('Built-in AI is not available on this device (Chrome reports it as unavailable). Pick another free model.', { status: 400 });
  const small = smallModelMessages(messages, 4096);
  const sys = small[0];
  const turns = small.slice(1);
  const last = turns.pop();
  let session: LMSession;
  try {
    session = await LM.create({
      initialPrompts: [sys, ...turns].map((m) => ({ role: m.role, content: m.content })),
      signal,
      monitor(m: EventTarget) {
        m.addEventListener('downloadprogress', (e) => h.onStatus?.(`Downloading Chrome’s built-in model: ${Math.round(((e as unknown as { loaded?: number }).loaded ?? 0) * 100)}% (first time only)`));
      },
    });
  } catch (e) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    throw new LLMError(`Chrome’s built-in AI could not start on this device (${(e as Error).message}). Pick another free model.`, { status: 400 });
  }
  const out: CallResult = { content: '', reasoning: '' };
  try {
    h.onStatus?.('');
    const stream = session.promptStreaming(last?.content ?? '', { signal });
    const iter: AsyncIterable<string> = Symbol.asyncIterator in (stream as object) ? (stream as AsyncIterable<string>) : readAll(stream as ReadableStream<string>);
    // Chromium without the model answers with a stub that echoes the input,
    // so hold back the first characters until it is clear this is a real answer.
    let shown = 0;
    const flush = () => {
      if (STUB.test(out.content)) throw new LLMError('This browser has the built-in AI interface but no model behind it (Chromium only echoes the message back). Use Google Chrome on a supported computer, or pick another free model.', { status: 400 });
      if (out.content.length > shown) {
        h.onText(out.content.slice(shown));
        shown = out.content.length;
      }
    };
    for await (const chunk of iter) {
      // Older versions sent the whole text so far; newer ones send only the new part.
      const d = out.content && chunk.startsWith(out.content) ? chunk.slice(out.content.length) : chunk;
      out.content += d;
      if (out.content.length >= 80 || shown) flush();
    }
    flush();
  } finally {
    session.destroy?.();
  }
  return out;
}

/** Chromium's placeholder reply when no on-device model is installed. */
const STUB = /^\s*On-device model is not available/i;

async function* readAll(stream: ReadableStream<string>): AsyncIterable<string> {
  const reader = stream.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    if (value) yield value;
  }
}
