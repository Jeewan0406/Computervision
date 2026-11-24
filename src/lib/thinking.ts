// Thinking levels: how hard the model should think before it answers.
// Each level does two things:
//  1. Models that have a real "effort" setting get it (Claude: output_config
//     effort; OpenAI reasoning models: reasoning_effort). Other models ignore it.
//  2. Every model gets written critical-thinking steps that grow with the level,
//     so free models also think more carefully at High and above.
// Max also makes Chat check its own first answer and rewrite it (a second pass).

export type ThinkLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export const THINK_LEVELS: { id: ThinkLevel; label: string; hint: string }[] = [
  { id: 'low', label: 'Low', hint: 'Fast, short answers for simple questions.' },
  { id: 'medium', label: 'Medium', hint: 'Normal thinking. Good for most questions.' },
  { id: 'high', label: 'High', hint: 'Careful critical thinking: parts, assumptions, numbers checked.' },
  { id: 'xhigh', label: 'Extra high', hint: 'Adds other explanations, source checks and option comparison.' },
  { id: 'max', label: 'Max', hint: 'Deepest thinking. In Chat the model also checks and rewrites its first answer.' },
];

export const isThinkLevel = (x: unknown): x is ThinkLevel => THINK_LEVELS.some((l) => l.id === x);
export const thinkLabel = (l: ThinkLevel) => THINK_LEVELS.find((x) => x.id === l)?.label ?? 'Medium';

const STEPS_HIGH = [
  'Find the real question and what a complete answer must cover. If a better question exists, say so briefly.',
  'Split the problem into parts (causes, options, steps) and note how they depend on each other.',
  'Reason each part from basic facts, laws or mechanisms. Check each result against a known case or a rough estimate.',
  'Question every assumption, including the user’s. In the answer, name the step you are least sure about.',
  'Check every number, unit and calculation twice. Show the working for any calculation that matters.',
  'Before the conclusion, give the strongest counter-argument, exception or limit.',
];
const STEPS_XHIGH = [
  'Consider at least two other explanations or options, and say why you prefer one.',
  'Check each key claim against the numbered web results or provided files. Mark anything they do not support as (unverified).',
  'Where good sources disagree, explain the disagreement instead of quietly picking a side.',
  'For a decision, compare the options on cost, risk, assumptions and how easy each is to undo, then recommend one and name the fact that would change your advice.',
];

/**
 * Written thinking guidance for a level. `selfCheck` is true when the app
 * will run a second review pass (Chat at Max).
 */
export function thinkingPrompt(level: ThinkLevel, opts: { selfCheck?: boolean } = {}): string {
  if (level === 'low') return '# Thinking level: Low\nAnswer quickly and directly. Keep the reasoning short and the answer as short as the question allows. All other rules still apply.';
  if (level === 'medium') return '# Thinking level: Medium\nThink the question through before you answer, and check the key facts and numbers.';
  const steps = level === 'high' ? STEPS_HIGH : [...STEPS_HIGH, ...STEPS_XHIGH];
  const title = level === 'high' ? 'High (careful critical thinking)' : level === 'xhigh' ? 'Extra high (deep critical thinking)' : 'Max (deepest critical thinking)';
  const lines = [
    `# Thinking level: ${title}`,
    'Before you write, work through these steps in your own reasoning. Show the results in the answer, not the list of steps.',
    ...steps.map((s, i) => `${i + 1}. ${s}`),
  ];
  if (level === 'max') {
    lines.push('Correctness matters more than speed: take the time you need, and prefer saying "I could not verify this" over guessing.');
    if (opts.selfCheck) lines.push('After this answer you will be asked to review it as a strict expert and rewrite it, so make it complete.');
  }
  return lines.join('\n');
}

/** The second-pass request used by Chat at Max. */
export const REVIEW_PROMPT = [
  'Review your answer above as a strict expert reviewer, then write the improved final answer.',
  'Check:',
  '1. Does it answer exactly what was asked, with the direct answer first?',
  '2. Is every fact supported by the numbered web results, the provided files or common knowledge, with correct citations? Remove anything unsupported or mark it (unverified).',
  '3. Recalculate every number and check every unit.',
  '4. Are there errors in logic, missing steps, missing counter-arguments or missing limits?',
  '5. Is it clear, in plain words, and the right length for the question?',
  'Reply with the complete improved answer only, in the same language and format. Do not mention this review and do not list your changes.',
].join('\n');

/**
 * Claude's effort setting for a model, or undefined when the model has none.
 * Levels per model follow Anthropic's model documentation: all five on the
 * Claude 5 family and Opus 4.7/4.8; no "xhigh" on 4.6; Opus 4.5 low-high only.
 */
export function anthropicEffort(model: string, level: ThinkLevel): ThinkLevel | undefined {
  const m = model.toLowerCase();
  if (/claude-(opus|sonnet|haiku|fable|mythos)-5|claude-opus-4-[78]|claude-mythos/.test(m)) return level;
  if (/claude-(opus|sonnet)-4-6/.test(m)) return level === 'xhigh' ? 'high' : level;
  if (/claude-opus-4-5/.test(m)) return level === 'xhigh' || level === 'max' ? 'high' : level;
  return undefined;
}

/**
 * OpenAI reasoning_effort for OpenAI's own reasoning models (o-series and
 * GPT-5 family), or undefined. Only low/medium/high are sent, the values
 * these models have long accepted.
 */
export function openaiEffort(providerId: string, model: string, level: ThinkLevel): 'low' | 'medium' | 'high' | undefined {
  if (providerId !== 'openai') return undefined;
  if (!/^(o\d|gpt-5)/i.test(model)) return undefined;
  return level === 'low' ? 'low' : level === 'medium' ? 'medium' : 'high';
}

