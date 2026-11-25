import { gatewayToken } from './account';
import { GATEWAY_ID } from './providers';
import { currentThinking } from './thinkrun';
import type { GenParams, ModelRef, MsgMeta, ProviderDef, Slot, View } from './types';
import { LLMError, streamText, type CallTarget, type ChatMsg } from './llm';
import { getProvider, modelLabel, useSettings } from './settings';
import { autoPick, cooldownUntil, lastStart, recordResult, type AutoHint } from './autopick';
import { isAuto } from './router';
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
 *  5. If the model fails (even halfway through an answer, or with an empty
 *     answer, or no reply in time), it switches to the next model: your
 *     fallback list first, then other good models chosen like Auto does.
 *     A half-written answer is cleared and started again.
 *  "Auto" picks the first model itself, from how demanding the question is.
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
  /** Called when a half-written answer is dropped because another model starts again. */
  onReset?: () => void;
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

// Pacing for shared free tiers (lastStart, cooldownUntil) lives in autopick.ts, so Auto can see which are busy.

async function waitWithCountdown(ms: number, label: string, opts: { signal: AbortSignal; onStatus?: (t: string) => void }) {
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
  if (p.access === 'keyless' || p.kind === 'browser') {
    return [{
      // The site's gateway gets the visitor's sign-in (accounts), if any.
      id: `keyless:${p.id}`, providerId: p.id, label: 'Free', apiKey: p.id === GATEWAY_ID ? gatewayToken() ?? '' : '', enabled: true, createdAt: 0,
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

/** A few plain words on why a model failed, for the switch note. */
function shortReason(err: LLMError): string {
  const s = err.status;
  if (s === 429 || s === 402) return 'busy or out of free use';
  if (s === 401 || s === 403) return 'key refused';
  if (s === 404) return 'model not found';
  if (s === 422 && /empty answer/.test(err.message)) return 'empty answer';
  if (/WebGPU|built-in AI/i.test(err.message)) return 'cannot run in this browser';
  if (/context|too long|too many tokens|maximum.{0,30}tokens|token limit/i.test(err.message)) return 'question too long for it';
  if (s === 400 || s === 422) return 'request refused';
  if (s === 408 || /timed? ?out/i.test(err.message)) return 'too slow';
  if (err.network) return 'could not be reached';
  if (s != null && s >= 500) return 'server error';
  return 'failed';
}

// ---- main entry ---------------------------------------------------------------
export interface AttemptResult {
  content: string;
  reasoning: string;
  tokensIn?: number;
  tokensOut?: number;
  finishReason?: string;
}

export type Attempt<R extends AttemptResult> = (
  target: CallTarget,
  handlers: { onText: (d: string) => void; onReasoning: (d: string) => void },
  signal: AbortSignal,
) => Promise<R>;

export interface SlotRunOptions {
  ref: ModelRef;
  feature: View;
  signal: AbortSignal;
  onText?: (delta: string) => void;
  onReasoning?: (delta: string) => void;
  onStatus?: (text: string) => void;
  /** Agent turns keep provider-specific history, so they must not switch provider. */
  allowFallback?: boolean;
  /** Text used to estimate input tokens when the provider does not report them. */
  inputForEstimate?: string;
  /** The question, for Auto and for choosing alternative models. */
  autoHint?: AutoHint;
  /** An empty answer counts as a failure (plain chat; not agent tool turns). */
  requireText?: boolean;
  onReset?: () => void;
}

/** Waiting longer than this for a busy free model: try another model instead (only when Auto chose it or it is already a backup). */
const SKIP_WAIT_MS = 15_000;
/** No first word within this time (when another model is available): switch. Longer at high thinking levels. */
function firstTokenLimit(): number {
  const t = useSettings.getState().thinking;
  return t === 'max' || t === 'xhigh' ? 180_000 : 75_000;
}

/** Plain chat: send messages, stream the answer. */
export async function runChat(opts: RunOptions): Promise<RunResult> {
  const lastUser = [...opts.messages].reverse().find((m) => m.role === 'user');
  const { result, meta, usedRef } = await runWithSlots(
    {
      ...opts,
      allowFallback: true,
      requireText: true,
      inputForEstimate: opts.messages.map((m) => m.content).join('\n'),
      autoHint: { text: lastUser?.content ?? '', images: lastUser?.images?.length ?? 0 },
    },
    (target, h, signal) => streamText(target, opts.messages, { effort: currentThinking(), ...(opts.params ?? {}) }, signal, h),
  );
  return { content: result.content, reasoning: result.reasoning, meta, usedRef };
}

/** Run one model call with key rotation, cooldowns, retries, fallback and logging. */
export async function runWithSlots<R extends AttemptResult>(
  opts: SlotRunOptions,
  attempt: Attempt<R>,
): Promise<{ result: R; meta: MsgMeta; usedRef: ModelRef }> {
  const settings = useSettings.getState();
  const switching = opts.allowFallback !== false;
  const hint: AutoHint = opts.autoHint ?? { text: opts.inputForEstimate ?? '' };
  let autoNote: string | undefined;
  let chain: ModelRef[] = [opts.ref];
  if (isAuto(opts.ref)) {
    const pick = autoPick(hint);
    if (!pick.chain.length) throw new LLMError('Auto found no model you can use right now. Add a key in API Slots, or choose a model.');
    chain = switching ? pick.chain : pick.chain.slice(0, 1);
    autoNote = pick.reason;
    log({ level: 'info', type: 'system', feature: opts.feature, message: `${pick.reason} First choice: ${modelLabel(chain[0])}; then ${chain.slice(1).map(modelLabel).join(', ') || 'none'}.` });
  }
  const add = (r: ModelRef) => {
    if (!isAuto(r) && !chain.some((c) => sameRef(c, r)) && chain.length < 8) chain.push({ providerId: r.providerId, model: r.model });
  };
  if (switching && settings.fallback.enabled) settings.fallback.chain.forEach(add);
  if (switching && settings.fallback.auto !== false) autoPick(hint, { exclude: chain }).chain.slice(0, 4).forEach(add);

  let lastErr: unknown = null;
  let firstErr: unknown = null;
  let triedAny = false;
  /** Why each model in the chain was left, for the status line and the note on the answer. */
  const reasons: string[] = [];
  let current = 0;
  const leave = (reason: string) => {
    reasons[current] = reason;
  };

  for (let ci = 0; ci < chain.length; ci++) {
    const ref = chain[ci];
    const provider = getProvider(ref.providerId);
    if (!provider) continue;
    const hasNext = switching && ci < chain.length - 1;
    current = ci;
    const why = ci > 0 ? reasons[ci - 1] ?? '' : '';
    const slots = candidateSlots(provider, ci === 0 ? ref.slotId : undefined);
    if (!slots.length) {
      lastErr = new LLMError(`No API key for ${provider.name}. Add one in API Slots.`);
      current = ci;
      leave('no key added');
      log({ level: 'warn', type: 'system', feature: opts.feature, providerId: provider.id, providerName: provider.name, model: ref.model, message: `Skipped ${provider.name}: no enabled key.` });
      continue;
    }
    if (ci > 0) {
      opts.onStatus?.(`${why ? `${modelLabel(chain[ci - 1])}: ${why}. ` : ''}Switching to ${modelLabel(ref)}…`);
      log({ level: 'warn', type: 'system', feature: opts.feature, providerId: provider.id, providerName: provider.name, model: ref.model, message: `Switching to ${provider.name} / ${ref.model}${why ? ` (previous model: ${why})` : ''}.` });
    }

    let modelProblem = false;
    for (const slot of slots) {
      if (modelProblem) break;
      const maxAttempts = 1 + Math.max(0, settings.maxRetries);
      for (let tryNo = 0; tryNo < maxAttempts; tryNo++) {
        triedAny = true;
        if (provider.access === 'keyless') {
          const wait = Math.max(cooldownUntil.get(provider.id) ?? 0, (lastStart.get(provider.id) ?? 0) + (provider.minGapMs ?? 0)) - Date.now();
          // A busy free model that Auto picked (or a backup): use the next model instead of waiting.
          if (wait > SKIP_WAIT_MS && hasNext && (isAuto(opts.ref) || ci > 0)) {
            log({ level: 'info', type: 'system', feature: opts.feature, providerId: provider.id, providerName: provider.name, model: ref.model, message: `Busy for ${Math.ceil(wait / 1000)} s more; trying the next model instead of waiting.` });
            leave(`busy for ${Math.ceil(wait / 1000)} s`);
            modelProblem = true;
            break;
          }
          if (wait > 0) await waitWithCountdown(wait, 'Free model is shared: next free slot in', opts);
        }
        const lockKey = slot.id;
        await acquire(lockKey, provider.maxConcurrent ?? 4, opts.signal);
        if (provider.access === 'keyless') lastStart.set(provider.id, Date.now());

        const t0 = performance.now();
        let ttft: number | undefined;
        let received = 0;
        const target: CallTarget = { provider, slot, model: ref.model, corsProxy: settings.corsProxy };
        const handlers = {
          onText: (d: string) => {
            if (ttft == null) ttft = performance.now() - t0;
            received += d.length;
            opts.onText?.(d);
          },
          onReasoning: (d: string) => {
            if (ttft == null) ttft = performance.now() - t0;
            received += d.length;
            opts.onReasoning?.(d);
          },
          onStatus: (text: string) => opts.onStatus?.(text),
        };
        // Own stop switch for this attempt: the user's Stop, or no first word in time.
        const ac = new AbortController();
        const relay = () => ac.abort();
        opts.signal.addEventListener('abort', relay);
        let timedOut = false;
        const limit = firstTokenLimit();
        const timer = hasNext && provider.kind !== 'browser'
          ? setTimeout(() => {
            if (ttft == null) {
              timedOut = true;
              ac.abort();
            }
          }, limit)
          : undefined;
        try {
          opts.onStatus?.('');
          const r = await attempt(target, handlers, ac.signal);
          if (opts.requireText && !r.content.trim() && !(r as { toolCalls?: unknown[] }).toolCalls?.length) {
            throw new LLMError('The model sent an empty answer.', { status: 422 });
          }
          const totalMs = performance.now() - t0;
          const estimated = r.tokensOut == null;
          const tokensIn = r.tokensIn ?? estimateTokens(opts.inputForEstimate ?? '');
          const tokensOut = r.tokensOut ?? estimateTokens(r.content + r.reasoning);
          patchSlot(slot, { status: 'ok', lastError: undefined, cooldownUntil: undefined, uses: slot.uses + 1 });
          recordResult(ref, true);
          log({
            level: 'info', type: 'request', feature: opts.feature, providerId: provider.id, providerName: provider.name,
            model: ref.model, slotLabel: slot.label, status: 'ok', httpStatus: 200, ttftMs: ttft, totalMs,
            tokensIn, tokensOut, estimated, attempt: tryNo + 1,
            message: r.finishReason && r.finishReason !== 'stop' && r.finishReason !== 'end_turn' ? `Finished (${r.finishReason}).` : 'Completed.',
          });
          return {
            result: r,
            usedRef: { providerId: provider.id, model: ref.model },
            meta: {
              ttftMs: ttft, totalMs, tokensIn, tokensOut, estimated, slotLabel: slot.label, providerName: provider.name,
              attempts: tryNo + 1,
              fellBackFrom: ci > 0 ? modelLabel(chain[0]) : undefined,
              switchReason: ci > 0 ? [reasons[0], ci > 1 ? `${ci} models before this one were busy or failed` : ''].filter(Boolean).join('; ') || undefined : undefined,
              auto: autoNote,
            },
          };
        } catch (e) {
          const totalMs = performance.now() - t0;
          if (opts.signal.aborted) {
            log({ level: 'info', type: 'request', feature: opts.feature, providerId: provider.id, providerName: provider.name, model: ref.model, slotLabel: slot.label, status: 'aborted', totalMs, ttftMs: ttft, message: 'Stopped by user.' });
            throw new DOMException('Aborted', 'AbortError');
          }
          if (timedOut || isAbort(e)) {
            // No first word in time: try the next model.
            log({ level: 'warn', type: 'request', feature: opts.feature, providerId: provider.id, providerName: provider.name, model: ref.model, slotLabel: slot.label, status: 'error', totalMs, message: `No reply within ${Math.round(limit / 1000)} s; switching model.` });
            recordResult(ref, false);
            lastErr = new LLMError(`No reply within ${Math.round(limit / 1000)} seconds.`, { status: 408 });
            if (ci === 0 && !firstErr) firstErr = lastErr;
            leave(`no reply within ${Math.round(limit / 1000)} s`);
            modelProblem = true;
            break;
          }
          const err = e instanceof LLMError ? e : new LLMError(String((e as Error)?.message ?? e));
          lastErr = err;
          if (ci === 0 && !firstErr) firstErr = err;
          recordResult(ref, false);
          const status = err.status;
          const base = { type: 'request' as const, feature: opts.feature, providerId: provider.id, providerName: provider.name, model: ref.model, slotLabel: slot.label, httpStatus: status, totalMs, ttftMs: ttft, attempt: tryNo + 1 };
          leave(shortReason(err));

          // Text already shown: retrying the same model would repeat it. With
          // another model available, clear the half answer and start again.
          if (received > 0) {
            log({ ...base, level: 'error', status: 'error', message: `Stream broke after partial output: ${err.message}${hasNext && opts.onReset ? ' — starting again with the next model.' : ''}` });
            if (hasNext && opts.onReset) {
              opts.onReset();
              leave('stopped halfway through the answer');
              modelProblem = true;
              break;
            }
            throw err;
          }

          if (status === 401 || status === 403) {
            patchSlot(slot, { status: 'error', lastError: 'Key rejected (401/403). Check or replace this key.', failures: slot.failures + 1 });
            log({ ...base, level: 'error', status: 'error', message: `Key rejected: ${err.message}` });
            break; // next slot
          }
          if (status === 429 || status === 402) {
            const cool = err.retryAfterMs ?? (provider.minGapMs ?? 30_000);
            if (provider.access === 'keyless') {
              cooldownUntil.set(provider.id, Date.now() + cool);
              log({ ...base, level: 'warn', status: 'retry', message: hasNext ? 'Free tier busy; switching to the next model.' : `Free tier busy; waiting ${Math.ceil(cool / 1000)} s.` });
              if (!hasNext && cool <= 90_000 && tryNo + 1 < maxAttempts) continue; // loop waits with a countdown
              break;
            }
            patchSlot(slot, { status: 'cooldown', cooldownUntil: Date.now() + cool, lastError: `Rate limited (${status}).`, failures: slot.failures + 1 });
            log({ ...base, level: 'warn', status: 'retry', message: `Rate limited; key "${slot.label}" cooling for ${Math.ceil(cool / 1000)} s, rotating to next key.` });
            break; // next slot
          }
          if (err.network || status === 408 || status === 409 || (status != null && status >= 500)) {
            if (tryNo + 1 < maxAttempts) {
              const wait = backoff(tryNo);
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
          clearTimeout(timer);
          opts.signal.removeEventListener('abort', relay);
          release(lockKey);
        }
      }
    }
  }

  if (!triedAny && lastErr) throw lastErr;
  // Every model failed: the first model's error is usually the most useful one.
  const first = firstErr ?? lastErr;
  const others = reasons.filter(Boolean).length - 1;
  if (first instanceof LLMError && others > 0 && first !== lastErr) {
    throw new LLMError(`${first.message} (${others} other model${others === 1 ? '' : 's'} could not answer either. See Logs.)`, { status: first.status, retryAfterMs: first.retryAfterMs, network: first.network });
  }
  throw first ?? new LLMError('All providers failed.');
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
    const r = await streamText(
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
