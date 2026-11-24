// Auto model choice inside the app: collects the models this person can
// use right now, remembers recent failures, and asks router.ts to rank them.
import type { ModelRef, ProviderDef } from './types';
import { allProviders, isUsable, modelKey, modelsFor, useSettings } from './settings';
import { isFreeModel } from './models';
import { assess, autoReason, chainFrom, isAuto, profile, rankModels, type Assessment, type Candidate } from './router';
import { isThinkLevel } from './thinking';

export interface AutoHint {
  /** The question (latest user message, with any attached file text). */
  text: string;
  /** Number of pictures sent with it. */
  images?: number;
}

// ---- pacing for shared free tiers (e.g. Pollinations: >= 45 s apart) --------
/** When each no-key service last started a request, and until when it is resting after a rate limit. */
export const lastStart = new Map<string, number>();
export const cooldownUntil = new Map<string, number>();

/** Milliseconds until this free service may be used again (0 = now). */
export function busyFor(p: ProviderDef): number {
  if (p.access !== 'keyless') return 0;
  return Math.max(0, Math.max(cooldownUntil.get(p.id) ?? 0, (lastStart.get(p.id) ?? 0) + (p.minGapMs ?? 0)) - Date.now());
}

// ---- recent failures (kept in memory for this visit) -----------------------
const FORGET_MS = 15 * 60_000;
const failures = new Map<string, { n: number; at: number }>();

/** Remember how a model did, so Auto avoids models that just failed. */
export function recordResult(ref: ModelRef, ok: boolean) {
  const k = modelKey(ref);
  if (ok) failures.delete(k);
  else failures.set(k, { n: (failures.get(k)?.n ?? 0) + 1, at: Date.now() });
}
/** Failure weight for ranking: a failure in the last 5 minutes counts double, so Auto keeps away from that model for a while. */
function recentFailures(ref: ModelRef): number {
  const f = failures.get(modelKey(ref));
  if (!f) return 0;
  const ago = Date.now() - f.at;
  if (ago > FORGET_MS) {
    failures.delete(modelKey(ref));
    return 0;
  }
  return ago < 5 * 60_000 ? f.n * 2 : f.n;
}

/** Services Auto leaves out: itself, in-browser models (big downloads), Puter (needs a sign-in window) and AI Horde (slow; volunteers see prompts). */
const leaveOut = (p: ProviderDef) => p.kind === 'auto' || p.kind === 'browser' || p.kind === 'puter' || p.id === 'aihorde';

/** Every model Auto may choose from right now. */
export function autoCandidates(forAgent = false): Candidate[] {
  const { slots, leaderboard } = useSettings.getState();
  const allowPaid = useSettings.getState().autoUsePaid !== false;
  const out: Candidate[] = [];
  for (const p of allProviders()) {
    if (leaveOut(p) || !isUsable(p, slots)) continue;
    const { list, live } = modelsFor(p, slots);
    const known = [p.defaultModel, ...p.suggestedModels].filter((m) => !live || list.includes(m));
    // Long live lists (hundreds of models): keep the well-known ones plus the strongest-looking others.
    const extra = live ? list.filter((m) => !known.includes(m)).sort((a, b) => profile(b).strength - profile(a).strength).slice(0, Math.max(0, 12 - known.length)) : [];
    const ownKey = p.access !== 'keyless' && p.kind !== 'browser';
    for (const model of [...new Set([...known, ...extra])]) {
      const ref = { providerId: p.id, model };
      const free = isFreeModel(p, model);
      if (!free && !allowPaid) continue;
      const lb = leaderboard[modelKey(ref)];
      out.push({ ref, provider: p, free, ownKey, failures: recentFailures(ref), winRate: lb && lb.battles >= 3 ? lb.wins / lb.battles : undefined, forAgent, busyMs: busyFor(p) });
    }
  }
  return out;
}

export interface AutoPick {
  chain: ModelRef[];
  reason: string;
  assessment: Assessment;
}

/** Choose a model (and alternatives) for this question. */
export function autoPick(hint: AutoHint, opts: { exclude?: ModelRef[]; forAgent?: boolean } = {}): AutoPick {
  const level = useSettings.getState().thinking;
  const a = assess(hint.text, { images: hint.images, thinking: isThinkLevel(level) ? level : 'medium' });
  const skip = new Set((opts.exclude ?? []).filter((r) => !isAuto(r)).map(modelKey));
  const ranked = rankModels(a, autoCandidates(opts.forAgent).filter((c) => !skip.has(modelKey(c.ref))));
  const chain = chainFrom(ranked, 5);
  return { chain: chain.map((c) => c.ref), reason: autoReason(a, chain[0]), assessment: a };
}
