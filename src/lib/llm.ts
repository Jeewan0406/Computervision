import type { GenParams, ProviderDef, Slot } from './types';
import { anthropicEffort, openaiEffort } from './thinking';
import { createSSEParser, parseRetryAfter } from './sse';

export interface ChatMsg {
  role: 'system' | 'user' | 'assistant';
  content: string;
  /** Pictures (data: URLs) sent with a user message to models that can see images. */
  images?: string[];
}

/** OpenAI-style content: text plus image parts when the message has pictures. */
function oaiContent(m: OAIMessage): OAIMessage {
  const { images, ...rest } = m as ChatMsg;
  if (!images?.length) return images ? rest : m;
  return { ...rest, content: [{ type: 'text', text: rest.content || ' ' }, ...images.map((url) => ({ type: 'image_url', image_url: { url } }))] };
}

/** Anthropic content blocks for a message with pictures. */
function anthropicContent(m: ChatMsg) {
  if (!m.images?.length) return m.content;
  const pics = m.images.map((url) => {
    const [, mediaType = 'image/jpeg', data = ''] = /^data:([^;]+);base64,(.*)$/s.exec(url) ?? [];
    return { type: 'image' as const, source: { type: 'base64' as const, media_type: mediaType, data } };
  });
  return [...pics, { type: 'text' as const, text: m.content || ' ' }];
}

/** For providers that cannot take pictures here: say so instead of dropping them silently. */
const noPictures = (m: ChatMsg) => (m.images?.length ? `${m.content}\n\n[The user attached ${m.images.length} picture(s), but this provider could not receive them.]` : m.content);

export interface StreamHandlers {
  onText: (delta: string) => void;
  onReasoning?: (delta: string) => void;
  /** Short live note (e.g. an in-browser model downloading). */
  onStatus?: (text: string) => void;
}

export interface CallResult {
  content: string;
  reasoning: string;
  tokensIn?: number;
  tokensOut?: number;
  finishReason?: string;
  /** Native tool calls requested by the model (agent mode). */
  toolCalls?: { id: string; name: string; argsText: string }[];
}

/** OpenAI-style message, including tool calls and tool results (agent mode). */
export type OAIMessage = ChatMsg | Record<string, unknown>;

export interface OAITool {
  type: 'function';
  function: { name: string; description: string; parameters: unknown };
}

/** An HTTP or network failure, classified so the runner knows what to do. */
export class LLMError extends Error {
  status?: number;
  retryAfterMs?: number;
  network: boolean;
  constructor(message: string, opts: { status?: number; retryAfterMs?: number; network?: boolean } = {}) {
    super(message);
    this.name = 'LLMError';
    this.status = opts.status;
    this.retryAfterMs = opts.retryAfterMs;
    this.network = !!opts.network;
  }
}

export interface CallTarget {
  provider: ProviderDef;
  slot: Pick<Slot, 'apiKey' | 'baseUrl'> & { useProxy?: boolean };
  model: string;
  corsProxy: string;
}

const trimSlash = (u: string) => u.replace(/\/+$/, '');

function baseOf(t: CallTarget) {
  return trimSlash(t.slot.baseUrl || t.provider.baseUrl);
}

/** Prefix-style CORS proxy: `${proxy}${targetUrl}` (see proxy/cloudflare-worker.js). */
function viaProxy(url: string, t: CallTarget) {
  if (t.slot.useProxy && t.corsProxy) return `${t.corsProxy}${url}`;
  return url;
}

function headersFor(t: CallTarget): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json', ...(t.provider.headers ?? {}) };
  if (t.slot.apiKey) h.Authorization = `Bearer ${t.slot.apiKey}`;
  if (t.provider.id === 'openrouter') h['HTTP-Referer'] = location.origin + location.pathname;
  return h;
}

async function errorFrom(res: Response): Promise<LLMError> {
  let msg = `${res.status} ${res.statusText}`.trim();
  try {
    const text = await res.text();
    try {
      const j = JSON.parse(text);
      const m = j?.error?.message ?? j?.error?.metadata?.raw ?? j?.message ?? j?.detail ?? (typeof j?.error === 'string' ? j.error : undefined);
      if (m) msg = `${res.status}: ${typeof m === 'string' ? m : JSON.stringify(m)}`;
    } catch {
      if (text) msg = `${res.status}: ${text.slice(0, 300)}`;
    }
  } catch {
    /* body unreadable */
  }
  return new LLMError(msg, { status: res.status, retryAfterMs: parseRetryAfter(res.headers.get('retry-after')) });
}

async function doFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    // Browsers report CORS blocks, DNS failures and offline as the same TypeError.
    throw new LLMError(
      'Network error: the provider could not be reached from the browser (offline, wrong URL, or the API blocks browser calls — try the CORS proxy setting).',
      { network: true },
    );
  }
}

// ---------------------------------------------------------------- OpenAI style

export async function streamOpenAI(
  t: CallTarget,
  messages: OAIMessage[],
  params: GenParams,
  signal: AbortSignal,
  h: StreamHandlers,
  extra: { tools?: OAITool[]; toolChoice?: 'auto' | 'none' } = {},
): Promise<CallResult> {
  const body: Record<string, unknown> = { model: t.model, messages: messages.map(oaiContent), stream: true };
  if (extra.tools?.length) {
    body.tools = extra.tools;
    body.tool_choice = extra.toolChoice ?? 'auto';
  }
  // Only send what the user explicitly set: some models reject custom sampling values.
  if (params.temperature != null) body.temperature = params.temperature;
  if (params.topP != null) body.top_p = params.topP;
  if (params.maxTokens) body[t.provider.id === 'openai' ? 'max_completion_tokens' : 'max_tokens'] = params.maxTokens;
  if (t.provider.streamUsage) body.stream_options = { include_usage: true };
  const effort = params.effort ? openaiEffort(t.provider.id, t.model, params.effort) : undefined;
  if (effort) body.reasoning_effort = effort;

  const url = viaProxy(`${baseOf(t)}${t.provider.chatPath ?? '/chat/completions'}`, t);
  let res = await doFetch(url, { method: 'POST', headers: headersFor(t), body: JSON.stringify(body), signal });
  if (!res.ok && effort && res.status === 400) {
    // Some models refuse the effort setting: ask again without it.
    const err = await errorFrom(res);
    if (!/reasoning/i.test(err.message)) throw err;
    delete body.reasoning_effort;
    res = await doFetch(url, { method: 'POST', headers: headersFor(t), body: JSON.stringify(body), signal });
  }
  if (!res.ok) throw await errorFrom(res);

  const out: CallResult = { content: '', reasoning: '' };
  const ctype = res.headers.get('content-type') ?? '';

  if (!ctype.includes('text/event-stream') || !res.body) {
    // Non-streaming fallback (some gateways ignore `stream: true`).
    const text = await res.text();
    try {
      const j = JSON.parse(text);
      const msg = j?.choices?.[0]?.message ?? {};
      out.content = msg.content ?? '';
      if (Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
        out.toolCalls = msg.tool_calls.map((tc: { id?: string; function?: { name?: string; arguments?: string } }) => ({
          id: tc.id ?? '', name: tc.function?.name ?? '', argsText: tc.function?.arguments ?? '',
        }));
      }
      out.reasoning = msg.reasoning_content ?? msg.reasoning ?? '';
      out.tokensIn = j?.usage?.prompt_tokens;
      out.tokensOut = j?.usage?.completion_tokens;
      out.finishReason = j?.choices?.[0]?.finish_reason;
    } catch {
      out.content = text;
    }
    if (out.reasoning) h.onReasoning?.(out.reasoning);
    if (out.content) h.onText(out.content);
    return out;
  }

  let streamError: LLMError | null = null;
  const parser = createSSEParser((data) => {
    if (!data || data === '[DONE]') return;
    let j: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      j = JSON.parse(data);
    } catch {
      return;
    }
    if (j?.error) {
      streamError = new LLMError(String(j.error.message ?? JSON.stringify(j.error)), { status: Number(j.error.code) || undefined });
      return;
    }
    const choice = j?.choices?.[0];
    const delta = choice?.delta ?? {};
    const r = delta.reasoning_content ?? delta.reasoning;
    if (typeof r === 'string' && r) {
      out.reasoning += r;
      h.onReasoning?.(r);
    }
    if (typeof delta.content === 'string' && delta.content) {
      out.content += delta.content;
      h.onText(delta.content);
    }
    if (Array.isArray(delta.tool_calls)) {
      const calls = (out.toolCalls ??= []);
      for (const tc of delta.tool_calls) {
        const i = typeof tc.index === 'number' ? tc.index : calls.length ? calls.length - 1 : 0;
        const cur = (calls[i] ??= { id: '', name: '', argsText: '' });
        if (tc.id) cur.id = tc.id;
        const nm = tc.function?.name;
        if (nm) cur.name = cur.name && cur.name !== nm ? cur.name + nm : nm;
        if (typeof tc.function?.arguments === 'string') cur.argsText += tc.function.arguments;
        else if (tc.function?.arguments && typeof tc.function.arguments === 'object') cur.argsText = JSON.stringify(tc.function.arguments);
      }
    }
    if (choice?.finish_reason) out.finishReason = choice.finish_reason;
    if (j?.usage) {
      out.tokensIn = j.usage.prompt_tokens ?? out.tokensIn;
      out.tokensOut = j.usage.completion_tokens ?? out.tokensOut;
    }
  });

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.push(dec.decode(value, { stream: true }));
      if (streamError) throw streamError;
    }
    parser.flush();
  } finally {
    reader.releaseLock();
  }
  if (streamError) throw streamError;
  return out;
}

// ---------------------------------------------------------------------- Puter

/* eslint-disable @typescript-eslint/no-explicit-any */
let puterPromise: Promise<any> | null = null;

/** Load Puter.js (bundled, version pinned in package-lock) only when needed. */
export function loadPuter(): Promise<any> {
  const existing = (globalThis as any).puter; // already on the page (e.g. Puter's own script tag)
  puterPromise ??= (existing ? Promise.resolve(existing) : import('@heyputer/puter.js'))
    .then((m: any) => (m === existing ? m : m.puter ?? m.default ?? (globalThis as any).puter))
    .catch((e) => {
      puterPromise = null;
      throw new LLMError(`Could not start Puter.js: ${(e as Error).message}`, { network: true });
    });
  return puterPromise;
}

/** Ask Puter to sign the user in (call from a click so the popup is allowed). */
export async function puterSignIn(): Promise<boolean> {
  const puter = await loadPuter();
  if (puter?.auth?.isSignedIn?.()) return true;
  await puter.auth.signIn();
  return !!puter.auth.isSignedIn?.();
}

export async function streamPuter(t: CallTarget, messages: ChatMsg[], params: GenParams, signal: AbortSignal, h: StreamHandlers): Promise<CallResult> {
  const puter = await loadPuter();
  const opts: Record<string, unknown> = { stream: true };
  if (t.model && t.model !== 'default') opts.model = t.model;
  if (params.temperature != null) opts.temperature = params.temperature;
  if (params.maxTokens) opts.max_tokens = params.maxTokens;
  const out: CallResult = { content: '', reasoning: '' };
  let stream: any;
  try {
    stream = await puter.ai.chat(messages.map((m) => ({ role: m.role, content: noPictures(m) })), opts);
  } catch (e) {
    const msg = (e as any)?.error?.message ?? (e as any)?.message ?? String(e);
    throw new LLMError(`Puter: ${msg}`, { status: (e as any)?.status ?? (/sign|auth|login/i.test(msg) ? 401 : undefined) });
  }
  const onAbort = () => void stream?.cancel?.();
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    for await (const ch of stream as AsyncIterable<any>) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      if (ch?.type === 'text' && ch.text) {
        out.content += ch.text;
        h.onText(ch.text);
      } else if (ch?.type === 'reasoning' && ch.reasoning) {
        out.reasoning += ch.reasoning;
        h.onReasoning?.(ch.reasoning);
      } else if (ch?.type === 'usage' && ch.usageDetails) {
        out.tokensIn = ch.usageDetails.inputTokens;
        out.tokensOut = ch.usageDetails.outputTokens;
      } else if (ch?.type === 'error') {
        throw new LLMError(`Puter: ${ch.message ?? 'error'}`, { status: /limit|quota|insufficient/i.test(ch.message ?? '') ? 429 : undefined });
      } else if (typeof ch === 'string') {
        out.content += ch;
        h.onText(ch);
      }
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
  return out;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Plain text streaming for any provider kind. */
export function streamText(t: CallTarget, messages: ChatMsg[], params: GenParams, signal: AbortSignal, h: StreamHandlers): Promise<CallResult> {
  if (t.provider.kind === 'anthropic') return streamAnthropic(t, messages, params, signal, h);
  if (t.provider.kind === 'puter') return streamPuter(t, messages, params, signal, h);
  if (t.provider.kind === 'auto') return Promise.reject(new LLMError('Auto must choose a model before sending.', { status: 400 }));
  if (t.provider.kind === 'browser') {
    // Loaded only when someone picks an in-browser model.
    return import('./local').then((l) => (t.provider.id === l.CHROME_AI_ID ? l.streamChromeAI(messages, signal, h) : l.streamWebLLM(t.model, messages, signal, h)));
  }
  return streamOpenAI(t, messages, params, signal, h);
}

// ------------------------------------------------------------------ Anthropic

/** Claude's effort setting (output_config.effort) for the chosen thinking level, where the model has one. */
function effortConfig(model: string, params: GenParams) {
  const effort = params.effort ? anthropicEffort(model, params.effort) : undefined;
  return effort ? { output_config: { effort } } : {};
}

/** Claude models that take adaptive thinking (Claude 5 family and 4.6+). */
const ADAPTIVE = /claude-(opus|sonnet|haiku|fable|mythos)-(5|4-[6-9])/;

export async function streamAnthropic(
  t: CallTarget,
  messages: ChatMsg[],
  params: GenParams,
  signal: AbortSignal,
  h: StreamHandlers,
): Promise<CallResult> {
  // Loaded on demand so people who never use Claude don't download the SDK.
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({
    apiKey: t.slot.apiKey,
    baseURL: viaProxy(baseOf(t), t),
    dangerouslyAllowBrowser: true, // keys belong to the user and stay in their browser
    maxRetries: 0, // JeeA!'s runner handles retries and key rotation
  });

  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const convo = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: anthropicContent(m) }));
  if (convo[0]?.role === 'assistant') convo.unshift({ role: 'user', content: '(continue)' });

  // Note: the SDK's API version rejects temperature/top_p, so they are not sent.
  const req = {
    model: t.model,
    max_tokens: params.maxTokens ?? 32000,
    messages: convo,
    ...(system ? { system } : {}),
    ...(ADAPTIVE.test(t.model) ? { thinking: { type: 'adaptive' as const, display: 'summarized' as const } } : {}),
    ...effortConfig(t.model, params),
  };

  const out: CallResult = { content: '', reasoning: '' };
  try {
    const stream = client.messages.stream(req as Parameters<typeof client.messages.stream>[0], { signal });
    for await (const ev of stream) {
      if (ev.type === 'content_block_delta') {
        const d = ev.delta as { type: string; text?: string; thinking?: string };
        if (d.type === 'text_delta' && d.text) {
          out.content += d.text;
          h.onText(d.text);
        } else if (d.type === 'thinking_delta' && d.thinking) {
          out.reasoning += d.thinking;
          h.onReasoning?.(d.thinking);
        }
      }
    }
    const final = await stream.finalMessage();
    out.tokensIn = final.usage?.input_tokens;
    out.tokensOut = final.usage?.output_tokens;
    out.finishReason = final.stop_reason ?? undefined;
    if (final.stop_reason === 'refusal') {
      const note = '\n\n> The model declined this request.';
      out.content += note;
      h.onText(note);
    }
    return out;
  } catch (e) {
    if (e instanceof Anthropic.APIUserAbortError) throw new DOMException('Aborted', 'AbortError');
    if (e instanceof Anthropic.APIConnectionError) {
      throw new LLMError('Network error: could not reach the Anthropic API from the browser.', { network: true });
    }
    if (e instanceof Anthropic.APIError) {
      const ra = e.headers?.get?.('retry-after') ?? null;
      throw new LLMError(`${e.status ?? ''}: ${e.message}`.replace(/^: /, ''), {
        status: e.status,
        retryAfterMs: parseRetryAfter(ra),
      });
    }
    throw e;
  }
}

/** One agent turn with Anthropic tool use. The full assistant content
 * (including thinking blocks) is returned so it can be sent back unchanged. */
export async function streamAnthropicAgent(
  t: CallTarget,
  system: string,
  messages: unknown[],
  tools: { name: string; description: string; parameters: unknown }[],
  params: GenParams,
  signal: AbortSignal,
  h: StreamHandlers,
): Promise<CallResult & { assistantContent: unknown[]; toolUses: { id: string; name: string; input: Record<string, unknown> }[]; stopReason?: string }> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: t.slot.apiKey, baseURL: viaProxy(baseOf(t), t), dangerouslyAllowBrowser: true, maxRetries: 0 });
  const proxied = !!(t.slot.useProxy && t.corsProxy);
  const req = {
    model: t.model,
    max_tokens: params.maxTokens ?? 32000,
    system,
    messages,
    // Eager streaming sends tool input as it is written; JeeA! validates it before running a tool.
    tools: tools.map((x) => ({ name: x.name, description: x.description, input_schema: x.parameters, ...(proxied ? {} : { eager_input_streaming: true }) })),
    ...(ADAPTIVE.test(t.model) ? { thinking: { type: 'adaptive' as const, display: 'summarized' as const } } : {}),
    ...effortConfig(t.model, params),
  };
  const out: CallResult = { content: '', reasoning: '' };
  try {
    const stream = client.messages.stream(req as unknown as Parameters<typeof client.messages.stream>[0], { signal });
    for await (const ev of stream) {
      if (ev.type === 'content_block_delta') {
        const d = ev.delta as { type: string; text?: string; thinking?: string };
        if (d.type === 'text_delta' && d.text) {
          out.content += d.text;
          h.onText(d.text);
        } else if (d.type === 'thinking_delta' && d.thinking) {
          out.reasoning += d.thinking;
          h.onReasoning?.(d.thinking);
        }
      }
    }
    const final = await stream.finalMessage();
    const blocks = final.content as unknown as { type: string; id?: string; name?: string; input?: unknown }[];
    return {
      ...out,
      tokensIn: final.usage?.input_tokens,
      tokensOut: final.usage?.output_tokens,
      finishReason: final.stop_reason ?? undefined,
      stopReason: final.stop_reason ?? undefined,
      assistantContent: final.content as unknown[],
      toolUses: blocks
        .filter((b) => b.type === 'tool_use')
        .map((b) => ({ id: b.id ?? '', name: b.name ?? '', input: (b.input && typeof b.input === 'object' ? b.input : {}) as Record<string, unknown> })),
    };
  } catch (e) {
    if (e instanceof Anthropic.APIUserAbortError) throw new DOMException('Aborted', 'AbortError');
    if (e instanceof Anthropic.APIConnectionError) throw new LLMError('Network error: could not reach the Anthropic API from the browser.', { network: true });
    if (e instanceof Anthropic.APIError) {
      throw new LLMError(`${e.status ?? ''}: ${e.message}`.replace(/^: /, ''), { status: e.status, retryAfterMs: parseRetryAfter(e.headers?.get?.('retry-after') ?? null) });
    }
    throw e;
  }
}

// --------------------------------------------------------------- model lists

export async function listModels(t: Omit<CallTarget, 'model'>, signal?: AbortSignal): Promise<string[]> {
  const target = { ...t, model: '' } as CallTarget;
  if (t.provider.kind === 'auto') return ['auto'];
  if (t.provider.kind === 'browser') {
    const l = await import('./local');
    return t.provider.id === l.CHROME_AI_ID ? ['gemini-nano'] : l.webllmModels();
  }
  if (t.provider.kind === 'puter') {
    const puter = await loadPuter();
    const list = (await puter.ai.listModels()) as Record<string, unknown>[];
    const ids = list
      .map((m) => (typeof m === 'string' ? m : (m.id ?? m.name ?? m.model) as string))
      .filter((x): x is string => typeof x === 'string' && !!x);
    return ['default', ...new Set(ids.filter((id) => !/embed|tts|whisper|dall-e|image|moderation/i.test(id)))];
  }
  if (t.provider.kind === 'anthropic') {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({
      apiKey: t.slot.apiKey,
      baseURL: viaProxy(baseOf(target), target),
      dangerouslyAllowBrowser: true,
      maxRetries: 0,
    });
    const ids: string[] = [];
    try {
      for await (const m of client.models.list({ limit: 100 }, { signal })) ids.push(m.id);
    } catch (e) {
      if (e instanceof Anthropic.APIError) throw new LLMError(`${e.status ?? ''}: ${e.message}`, { status: e.status });
      throw e;
    }
    return ids;
  }

  const url = `${baseOf(target)}/models`;
  const res = await doFetch(viaProxy(url, target), {
    headers: t.slot.apiKey ? { Authorization: `Bearer ${t.slot.apiKey}` } : t.provider.headers?.Authorization ? { Authorization: t.provider.headers.Authorization } : {},
    signal,
  });
  if (!res.ok) throw await errorFrom(res);
  const j = await res.json();
  const arr: unknown[] = Array.isArray(j) ? j : Array.isArray(j?.data) ? j.data : Array.isArray(j?.models) ? j.models : [];
  let ids = arr
    .map((m) => (typeof m === 'string' ? m : (m as { id?: string; name?: string })?.id ?? (m as { name?: string })?.name))
    .filter((x): x is string => typeof x === 'string' && !!x)
    .map((id) => id.replace(/^models\//, ''));
  // Hide obvious non-chat models (embeddings, speech, image, moderation).
  ids = ids.filter((id) => !/embed|whisper|tts|dall-e|moderation|rerank|transcribe|imagen|veo|aqa|bge-|guard|stable-diffusion/i.test(id));
  if (t.provider.hideModels) {
    const hide = new RegExp(t.provider.hideModels, 'i');
    ids = ids.filter((id) => !hide.test(id));
  }
  // Put free OpenRouter models first.
  ids.sort((a, b) => Number(b.endsWith(':free')) - Number(a.endsWith(':free')) || a.localeCompare(b));
  return [...new Set(ids)];
}
