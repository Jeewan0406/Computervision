// Auto model choice. Two pure steps, so they can be tested without the app:
//  1. assess(): how demanding is this question? (simple, standard, complex)
//     and does it need pictures, code skills or a long memory?
//  2. rankModels(): order the models you can use for that question, by an
//     estimate of each model's strength, cost, speed and recent failures.
// The estimate comes from the model's name (family and size, e.g. "70b").
// It is a rule of thumb, not a benchmark, so the reason is always shown.
import type { ModelRef, ProviderDef } from './types';
import type { ThinkLevel } from './thinking';

export const AUTO_ID = 'auto';
export const AUTO_REF: ModelRef = { providerId: AUTO_ID, model: 'auto' };
export const isAuto = (r?: { providerId: string } | null) => r?.providerId === AUTO_ID;

export type Tier = 'simple' | 'standard' | 'complex';

export interface Assessment {
  tier: Tier;
  score: number;
  vision: boolean;
  code: boolean;
  maths: boolean;
  long: boolean;
  /** Plain words, e.g. ["reasoning", "maths"]. */
  reasons: string[];
}

const SMALL_TALK = /^(hi+|hello|hey|hiya|thanks?|thank you|thx|ok(ay)?|cool|nice|great|good (morning|afternoon|evening|night)|bye|goodbye|yes|no|sure|who are you\??|how are you\??)[\s!.?]*$/i;
const CODE = /```|\b(function|class|def|import|const|let|var|select\s+\w+\s+from|regex|stack ?trace|traceback|exception|compile[rd]?|bug|debug|refactor|typescript|javascript|python|java|c\+\+|c#|rust|golang|sql|html|css|api|endpoint|algorithm|unit tests?)\b/i;
const MATHS = /\$[^$\n]+\$|\\frac|\\sum|\\int|∫|∑|\b(equations?|integral|derivative|calculate|calculation|probability|statistics?|regression|matrix|eigen\w*)\b/i;
const PROOF = /\b(prove|proof|derive|derivation|theorem|lemma)\b/i;
const REASONING = /\b(analy[sz]e|analysis|compare|comparison|contrast|evaluate|assess|critique|critically|justify|trade-?offs?|pros and cons|strateg(y|ic)|plan|design|architecture|research|literature review|evidence|hypothes[ie]s|step[- ]by[- ]step|why|implications?|optimi[sz]e|recommend|in depth|in-depth|thorough)\b/gi;
const FILE_MARK = '**Attached file: ';

/** How demanding a question is. `thinking` nudges the result up or down. */
export function assess(text: string, opts: { images?: number; thinking?: ThinkLevel } = {}): Assessment {
  const at = text.indexOf(FILE_MARK);
  const body = (at >= 0 ? text.slice(0, at) : text).trim();
  const fileChars = at >= 0 ? text.length - at : 0;
  const files = at >= 0 ? text.split(FILE_MARK).length - 1 : 0;
  const words = body ? body.split(/\s+/).length : 0;
  const reasons: string[] = [];
  let score = 0;

  if (!files && SMALL_TALK.test(body)) {
    score -= 3;
    reasons.push('short chat');
  }
  if (words > 150) {
    score += 2;
    reasons.push('long question');
  } else if (words > 40) score += 1;
  else if (words <= 8 && !files) score -= 1;

  const code = CODE.test(body) || /\.(py|js|ts|tsx|java|c|cpp|cs|go|rs|rb|php|sql)\*\*/.test(text);
  if (code) {
    score += 2;
    reasons.push('code');
  }
  const proof = PROOF.test(body);
  const maths = proof || MATHS.test(body);
  if (maths) {
    score += proof ? 3 : 2;
    reasons.push(proof ? 'proof' : 'maths');
  }
  // Several different reasoning words ("compare", "evaluate", "recommend") mean a demanding task.
  const reasoning = new Set((body.match(REASONING) ?? []).map((w) => w.toLowerCase())).size;
  if (reasoning) {
    score += reasoning >= 4 ? 4 : reasoning >= 2 ? 2 : 1;
    reasons.push('reasoning');
  }
  const questions = (body.match(/\?/g) ?? []).length;
  const parts = (body.match(/^\s*(\d+[.)]|[-*•])\s+/gm) ?? []).length;
  if (questions >= 3 || parts >= 3) {
    score += 1;
    reasons.push('several parts');
  }
  const long = fileChars > 40_000;
  if (files) {
    score += long ? 2 : 1;
    reasons.push(long ? 'long files' : 'files');
  }
  const vision = (opts.images ?? 0) > 0;
  if (vision) {
    score += 1;
    reasons.push('picture');
  }
  const bump: Record<ThinkLevel, number> = { low: -2, medium: 0, high: 1, xhigh: 2, max: 3 };
  if (opts.thinking && bump[opts.thinking]) {
    score += bump[opts.thinking];
    reasons.push(`thinking level ${opts.thinking === 'xhigh' ? 'Extra high' : opts.thinking[0].toUpperCase() + opts.thinking.slice(1)}`);
  }
  const tier: Tier = score <= 0 ? 'simple' : score <= 3 ? 'standard' : 'complex';
  return { tier, score, vision, code, maths, long, reasons };
}

export interface ModelProfile {
  /** 1 (tiny) to 5 (strongest models of the day). */
  strength: number;
  vision: boolean;
  coder: boolean;
}

const TOP = /claude-(opus|fable|mythos)|gpt-6|gpt-5|(^|[/-])o[34](-|$)|gemini-[\d.]+-pro|grok-4|deepseek-(r1|reasoner|v4)|qwen4|qwen[\d.]*-max|kimi-k|glm-5/;
const UPPER = /claude-sonnet|gpt-4\.1|gpt-4o|gemini-[\d.]+-flash|gemini-4|llama-4|deepseek-v3|deepseek-chat|command-a|mistral-(large|medium)|nemotron.*(super|ultra)|qwq|qwen3-coder/;
const MID = /claude-haiku|mistral-small|ministral|gemma|qwen|mixtral|codestral|devstral|nemotron|llama|phi-?4|glm/;
const VISION = /claude|gpt-4o|gpt-4\.1|gpt-5|gpt-6|gemini|grok-4|pixtral|llama-4|vl\b|-vl|vision|omni|gemma-?[34]|(^|[/-])o[34](-|$)/;
const CODER = /coder|codestral|devstral|claude|gpt-5|gpt-6|gpt-4\.1|deepseek|kimi|qwen3\.?[5-9]?-?(coder|max)|glm-5/;

/** Size in billions of parameters from the name ("Qwen3.5-397B-A17B" -> 397). */
export function paramSize(model: string): number | undefined {
  const sizes = [...model.toLowerCase().matchAll(/(?:^|[^a-z\d.])a?(\d+(?:\.\d+)?)b(?![a-z\d])/g)].map((m) => Number(m[1]));
  return sizes.length ? Math.max(...sizes) : undefined;
}

/** A rough strength estimate from the model id. */
export function profile(model: string): ModelProfile {
  const m = model.toLowerCase();
  const size = paramSize(m);
  let strength: number;
  if (TOP.test(m)) strength = 5;
  else if (size != null) strength = size >= 200 ? 5 : size >= 60 ? 4 : size >= 20 ? 3 : size >= 7 ? 2 : 1;
  else if (UPPER.test(m)) strength = 4;
  else if (MID.test(m)) strength = 3;
  else strength = 3;
  if (/nano|tiny/.test(m)) strength -= 2;
  // \b keeps "gemini" from counting as "mini".
  else if (/\bmini\b|\blite\b|haiku/.test(m) && strength >= 4) strength -= 1;
  else if (TOP.test(m) && /flash/.test(m)) strength -= 1;
  return { strength: Math.max(1, Math.min(5, strength)), vision: VISION.test(m), coder: CODER.test(m) };
}

export interface Candidate {
  ref: ModelRef;
  provider: ProviderDef;
  /** Free to use (no-key service, free tier or ":free" model). */
  free: boolean;
  /** Uses the person's own key (their limits, usually higher). */
  ownKey: boolean;
  /** Recent failures of this model (fewer is better). */
  failures?: number;
  /** Compare win rate 0-1 when there are at least 3 votes. */
  winRate?: number;
  /** Picking for Agent: models without native tool calling score lower. */
  forAgent?: boolean;
  /** A free service still waiting for its next free slot (milliseconds). */
  busyMs?: number;
}

export interface Ranked extends Candidate {
  score: number;
  profile: ModelProfile;
}

/** The strength each kind of question needs: simple ones go to small, fast models. */
const TARGET: Record<Tier, number> = { simple: 2, standard: 3.7, complex: 5 };

/** Order candidates for this question, best first. Picture questions keep only models that can see pictures, when there are any. */
export function rankModels(a: Assessment, cands: Candidate[]): Ranked[] {
  let list = cands.map((c) => ({ ...c, profile: profile(c.ref.model), score: 0 }));
  if (a.vision && list.some((c) => c.profile.vision)) list = list.filter((c) => c.profile.vision);
  for (const c of list) {
    const s = c.profile.strength;
    let score = a.tier === 'complex' ? s * 2.2 : -Math.abs(s - TARGET[a.tier]) * 2 + (a.tier === 'standard' ? s * 0.3 : 0);
    if (c.free) score += a.tier === 'simple' ? 1.2 : a.tier === 'standard' ? 0.8 : 0.3;
    if (c.ownKey) score += 0.5;
    const gap = c.provider.minGapMs ?? 0;
    if (gap >= 20_000) score -= a.tier === 'simple' ? 2 : 1;
    if (a.code && c.profile.coder) score += 1.5;
    if (a.long && s < 3) score -= 1.5;
    if (c.forAgent && c.provider.nativeTools === false) score -= 1.5;
    if (c.failures) score -= Math.min(9, c.failures * 3);
    if ((c.busyMs ?? 0) > 15_000) score -= 3;
    if (c.winRate != null) score += (c.winRate - 0.5) * 2;
    c.score = Math.round(score * 100) / 100;
  }
  return list.map((c, i) => ({ c, i })).sort((x, y) => y.c.score - x.c.score || x.i - y.i).map((x) => x.c);
}

/**
 * The model to use first, then alternatives in case it fails: the next best
 * from other services first (one service being down or busy often affects
 * all its models), then the rest.
 */
export function chainFrom(ranked: Ranked[], max = 5): Ranked[] {
  if (!ranked.length) return [];
  const out = [ranked[0]];
  const used = new Set([ranked[0].provider.id]);
  for (const c of ranked.slice(1)) if (out.length < max && !used.has(c.provider.id)) (out.push(c), used.add(c.provider.id));
  for (const c of ranked.slice(1)) if (out.length < max && !out.includes(c)) out.push(c);
  return out;
}

const TIER_WORDS: Record<Tier, string> = { simple: 'a simple question', standard: 'a normal question', complex: 'a demanding question' };

/** One plain sentence on why Auto chose this model. */
export function autoReason(a: Assessment, first: Ranked | undefined): string {
  const why = a.reasons.filter((r) => r !== 'short chat').slice(0, 3).join(', ');
  const kind = a.tier === 'complex' ? 'the strongest model available' : a.tier === 'simple' ? 'a fast, free model' : 'a capable model';
  return `Auto: ${TIER_WORDS[a.tier]}${why ? ` (${why})` : ''}, so it chose ${kind}${first && !first.free ? ' (uses your key)' : ''}.`;
}
