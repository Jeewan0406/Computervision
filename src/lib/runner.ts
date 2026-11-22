import type { GenParams, ModelRef, MsgMeta, ProviderDef, Slot, View } from './types';
import { LLMError, streamAnthropic, streamOpenAI, type CallTarget, type ChatMsg } from './llm';
import { getProvider, useSettings } from './settings';
import { log } from './logs';
import { estimateTokens, isAbort, sleep } from './utils';

/**
 * The runner turns "send these messages to this model" into a reliable call:
 *
 *  1. Picks a key ("slot") for the provider, rotating round-robin so load is
 *     spread across all your keys.
 *  2. On 429/402 (rate limit) it cools that key down (honouring Retry-After)
 *     and moves to the next key at once.
 *  3. On 401/403 it marks the key as broken and moves on.
 *  4. On 5xx or network errors it retries the same key with exponential
 *     backoff plus random jitter, so thousands of browsers do not retry in
 *     lock-step against a struggling provider.
 *  5. If every key fails before any text arrived, it falls back to the next
 *     model in your fallback chain.
 *  6. Every attempt is written to the activity log.
 */

export interface RunOptions {
  ref: ModelRef;
  messages: ChatMsg[];
  params?: GenParams;
  feature: View;
  signal: AbortSignal;
  onText: (delta: string) => void;
  onReasoning?: (delta: string) => void;
  /** Short status text, e.g. "Free slot busy, retrying in 20 s". */
  onStatus?: (text: string) => void;
}

export interface RunResult {
  content: string;
  reasoning: string;
  meta: MsgMeta;
  usedRef: ModelRef;
}

type SlotLike = Slot & { virtual?: boolean };

// ---- per-slot concurrency limiter ------------------------------------------
const active = new Map<string, number>();
const waiters = new Map<string, (() => void)[]>();
async function acquire(key: string, max: number, signal: AbortSignal) {
  while ((active.get(key) ?? 0) >= max) {
    await new Promise<void>((resolve, reject) => {
      const list = waiters.get(key) ?? [];
      const wake = () => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      };
      const onAbort = () => {
        waiters.set(key, (waiters.get(key) ?? []).filter((w) => w !== wake));
        reject(new DOMException('Aborted', 'AbortError'));
      };
      list.push(wake);
      waiters.set(key, list);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }
  active.set(key, (active.get(key) ?? 0) + 1);
}
function release(key: string) {
  active.set(key, Math.max(0, (active.get(key) ?? 1) - 1));
  const list = waiters.get(key);
  const next = list?.shift();
  if (next) next();
}

// ---- keyless pacing (Pollinations Classic: one at a time, >= 45 s apart) ----
const KEYLESS_GAP_MS = 45_000;
let keylessLastStart = 0;
let keylessCooldownUntil = 0;

async function waitWithCountdown(ms: number, label: string, opts: RunOptions) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const left = Math.ceil((end - Date.now()) / 1000);
    opts.onStatus?.(`${label} ${left} s…`);
    await sleep(Math.min(1000, end - Date.now()), opts.signal);
  }
  opts.onStatus?.('');
}

// ---- slot selection ---------------------------------------------------------
const rr = new Map<string, number>();

function candidateSlots(p: ProviderDef, pinned?: string): SlotLike[] {
  if (p.access === 'keyless') {
    return [{
      id: `keyless:${p.id}`, providerId: p.id, label: 'Free', apiKey: '', enabled: true, createdAt: 0,
      status: 'ok', uses: 0, failures: 0, virtual: true,
    }];
  }
  const all = useSettings.getState().slots.filter((s) => s.providerId === p.id && s.enabled);
  if (pinned) {
    const s = all.find((x) => x.id === pinned);
    if (s) return [s];
  }
  const t = Date.now();
  const ready = all.filter((s) => !s.cooldownUntil || s.cooldownUntil <= t);
  const cooling = all.filter((s) => s.cooldownUntil && s.cooldownUntil > t).sort((a, b) => (a.cooldownUntil ?? 0) - (b.cooldownUntil ?? 0));
  if (ready.length > 1) {
    const i = (rr.get(p.id) ?? 0) % ready.length;
    rr.set(p.id, i + 1);
    return [...ready.slice(i), ...ready.slice(0, i), ...cooling];
  }
  return [...ready, ...cooling];
}

function patchSlot(slot: SlotLike, patch: Partial<Slot>) {
  if (slot.virtual) return;
  useSettings.getState().updateSlot(slot.id, patch);
}

const backoff = (attempt: number) => Math.min(8000, 600 * 2 ** attempt) * (0.6 + Math.random() * 0.8);

const sameRef = (a: ModelRef, b: ModelRef) => a.providerId === b.providerId && a.model === b.model;

// ---- main entry ---------------------------------------------------------------
export async function runChat(opts: RunOptions): Promise<RunResult> {
  const settings = useSettings.getState();
  const chain: ModelRef[] = [opts.ref];
  if (settings.fallback.enabled) for (const r of settings.fallback.chain) if (!chain.some((c) => sameRef(c, r))) chain.push(r);

  let lastErr: unknown = null;
  let triedAny = false;

  for (let ci = 0; ci < chain.length; ci++) {
    const ref = chain[ci];
    const provider = getProvider(ref.providerId);
    if (!provider) continue;
    const slots = candidateSlots(provider, ci === 0 ? ref.slotId : undefined);
    if (!slots.length) {
      lastErr = new LLMError(`No API key for ${provider.name}. Add one in API Slots.`);
      log({ level: 'warn', type: 'system', feature: opts.feature, providerId: provider.id, providerName: provider.name, model: ref.model, message: `Skipped ${provider.name}: no enabled key.` });
      continue;
    }
    if (ci > 0) {
      opts.onStatus?.(`Falling back to ${provider.name} · ${ref.model}`);
      log({ level: 'warn', type: 'system', feature: opts.feature, providerId: provider.id, providerName: provider.name, model: ref.model, message: `Fallback: trying ${provider.name} / ${ref.model}.` });
    }

    let modelProblem = false;
    for (const slot of slots) {
      if (modelProblem) break;
      const maxAttempts = 1 + Math.max(0, settings.maxRetries);
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        triedAny = true;
        if (provider.access === 'keyless') {
          const wait = Math.max(keylessCooldownUntil, keylessLastStart + KEYLESS_GAP_MS) - Date.now();
          if (wait > 0) await waitWithCountdown(wait, 'Free model is shared: next free slot in', opts);
        }
        const lockKey = slot.id;
        await acquire(lockKey, provider.maxConcurrent ?? 4, opts.signal);
        if (provider.access === 'keyless') keylessLastStart = Date.now();

        const t0 = performance.now();
        let ttft: number | undefined;
        let received = 0;
        const target: CallTarget = { provider, slot, model: ref.model, corsProxy: settings.corsProxy };
        const handlers = {
          onText: (d: string) => {
            if (ttft == null) ttft = performance.now() - t0;
            received += d.length;
            opts.onText(d);
          },
          onReasoning: (d: string) => {
            if (ttft == null) ttft = performance.now() - t0;
            received += d.length;
            opts.onReasoning?.(d);
          },
        };
        try {
          opts.onStatus?.('');
          const fn = provider.kind === 'anthropic' ? streamAnthropic : streamOpenAI;
          const r = await fn(target, opts.messages, opts.params ?? {}, opts.signal, handlers);
          const totalMs = performance.now() - t0;
          const estimated = r.tokensOut == null;
          const tokensIn = r.tokensIn ?? estimateTokens(opts.messages.map((m) => m.content).join('\n'));
          const tokensOut = r.tokensOut ?? estimateTokens(r.content + r.reasoning);
          patchSlot(slot, { status: 'ok', lastError: undefined, cooldownUntil: undefined, uses: slot.uses + 1 });
          log({
            level: 'info', type: 'request', feature: opts.feature, providerId: provider.id, providerName: provider.name,
            model: ref.model, slotLabel: slot.label, status: 'ok', httpStatus: 200, ttftMs: ttft, totalMs,
            tokensIn, tokensOut, estimated, attempt: attempt + 1,
            message: r.finishReason && r.finishReason !== 'stop' && r.finishReason !== 'end_turn' ? `Finished (${r.finishReason}).` : 'Completed.',
          });
          return {
            content: r.content,
            reasoning: r.reasoning,
            usedRef: { providerId: provider.id, model: ref.model },
            meta: {
              ttftMs: ttft, totalMs, tokensIn, tokensOut, estimated, slotLabel: slot.label, providerName: provider.name,
              attempts: attempt + 1, fellBackFrom: ci > 0 ? `${opts.ref.providerId}/${opts.ref.model}` : undefined,
            },
          };
        } catch (e) {
          const totalMs = performance.now() - t0;
          if (isAbort(e) || opts.signal.aborted) {
            log({ level: 'info', type: 'request', feature: opts.feature, providerId: provider.id, providerName: provider.name, model: ref.model, slotLabel: slot.label, status: 'aborted', totalMs, ttftMs: ttft, message: 'Stopped by user.' });
            throw new DOMException('Aborted', 'AbortError');
          }
          const err = e instanceof LLMError ? e : new LLMError(String((e as Error)?.message ?? e));
          lastErr = err;
          const status = err.status;
          const base = { type: 'request' as const, feature: opts.feature, providerId: provider.id, providerName: provider.name, model: ref.model, slotLabel: slot.label, httpStatus: status, totalMs, ttftMs: ttft, attempt: attempt + 1 };

          // Text already shown: retrying would duplicate it, so stop here.
          if (received > 0) {
            log({ ...base, level: 'error', status: 'error', message: `Stream broke after partial output: ${err.message}` });
            throw err;
          }

          if (status === 401 || status === 403) {
            patchSlot(slot, { status: 'error', lastError: 'Key rejected (401/403). Check or replace this key.', failures: slot.failures + 1 });
            log({ ...base, level: 'error', status: 'error', message: `Key rejected: ${err.message}` });
            break; // next slot
          }
          if (status === 429 || status === 402) {
            const cool = err.retryAfterMs ?? (provider.access === 'keyless' ? KEYLESS_GAP_MS : 30_000);
            if (provider.access === 'keyless') {
              keylessCooldownUntil = Date.now() + cool;
              log({ ...base, level: 'warn', status: 'retry', message: `Free tier busy; waiting ${Math.ceil(cool / 1000)} s.` });
              if (cool <= 90_000 && attempt + 1 < maxAttempts) continue; // loop waits with a countdown
              break;
            }
            patchSlot(slot, { status: 'cooldown', cooldownUntil: Date.now() + cool, lastError: `Rate limited (${status}).`, failures: slot.failures + 1 });
            log({ ...base, level: 'warn', status: 'retry', message: `Rate limited; key "${slot.label}" cooling for ${Math.ceil(cool / 1000)} s, rotating to next key.` });
            break; // next slot
          }
          if (err.network || status === 408 || status === 409 || (status != null && status >= 500)) {
            if (attempt + 1 < maxAttempts) {
              const wait = backoff(attempt);
              log({ ...base, level: 'warn', status: 'retry', message: `${err.message} — retrying in ${Math.round(wait)} ms.` });
              await waitWithCountdown(wait, 'Provider hiccup, retrying in', opts);
              continue;
            }
            patchSlot(slot, { status: 'error', lastError: err.message, failures: slot.failures + 1 });
            log({ ...base, level: 'error', status: 'error', message: err.message });
            break; // next slot
          }
          // 400/404/422: bad model name or request. Other keys won't help.
          log({ ...base, level: 'error', status: 'error', message: err.message });
          modelProblem = true;
          break;
        } finally {
          release(lockKey);
        }
      }
    }
  }

  if (!triedAny && lastErr) throw lastErr;
  throw lastErr ?? new LLMError('All providers failed.');
}

/** Quick check used by the "Test" button on a key. */
export async function testSlot(slot: Slot, model: string): Promise<{ ok: boolean; ms: number; text: string }> {
  const provider = getProvider(slot.providerId);
  if (!provider) return { ok: false, ms: 0, text: 'Unknown provider' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  const t0 = performance.now();
  let text = '';
  try {
    const fn = provider.kind === 'anthropic' ? streamAnthropic : streamOpenAI;
    const r = await fn(
      { provider, slot, model, corsProxy: useSettings.getState().corsProxy },
      [{ role: 'user', content: 'Reply with exactly: JeeA ready' }],
      { maxTokens: provider.kind === 'anthropic' ? 2000 : 30 },
      ctrl.signal,
      { onText: (d) => (text += d) },
    );
    const ms = performance.now() - t0;
    useSettings.getState().updateSlot(slot.id, { status: 'ok', lastError: undefined, cooldownUntil: undefined });
    log({ level: 'info', type: 'request', feature: 'keys', providerId: provider.id, providerName: provider.name, model, slotLabel: slot.label, status: 'ok', totalMs: ms, tokensIn: r.tokensIn, tokensOut: r.tokensOut, message: 'Key test passed.' });
    return { ok: true, ms, text: (r.content || text).trim().slice(0, 80) };
  } catch (e) {
    const ms = performance.now() - t0;
    const msg = isAbort(e) ? 'Timed out after 30 s.' : String((e as Error)?.message ?? e);
    const status = (e as LLMError)?.status;
    useSettings.getState().updateSlot(slot.id, { status: 'error', lastError: msg });
    log({ level: 'error', type: 'request', feature: 'keys', providerId: provider.id, providerName: provider.name, model, slotLabel: slot.label, status: 'error', httpStatus: status, totalMs: ms, message: `Key test failed: ${msg}` });
    return { ok: false, ms, text: msg };
  } finally {
    clearTimeout(timer);
  }
}

// ---- abort registry: lets any view stop work it started ---------------------
const controllers = new Map<string, AbortController>();
export function startJob(id: string): AbortController {
  controllers.get(id)?.abort();
  const c = new AbortController();
  controllers.set(id, c);
  return c;
}
export function endJob(id: string) {
  controllers.delete(id);
}
export function stopJobs(prefix: string) {
  for (const [k, c] of controllers) if (k.startsWith(prefix)) {
    c.abort();
    controllers.delete(k);
  }
}
export function isRunning(prefix: string) {
  for (const k of controllers.keys()) if (k.startsWith(prefix)) return true;
  return false;
}
