// Small models (in-browser ones) see only about 4,000 tokens at a time, so
// they get a short system text (a brief, the date and the web results) and
// only the newest turns that fit.
import type { ChatMsg } from './llm';

const BRIEF = [
  'You are JeeA!, a helpful assistant running on the user’s own device.',
  'Answer in plain, simple English. Give the direct answer first.',
  'Use the web results below when they are given, and cite them with the APA in-text citation shown for each one. Never invent sources, numbers or links.',
  'If you are not sure, say so.',
].join('\n');

/**
 * A short system text for small models: a brief, the date and the web
 * results (cut to fit). The long answer rules and instructions are left out
 * because they would not fit in the model's memory.
 */
export function compactSystem(system: string, maxChars: number): string {
  const date = /^Today is .*$/m.exec(system)?.[0] ?? '';
  const at = system.indexOf('Web search results');
  let web = at >= 0 ? system.slice(at) : '';
  const room = Math.max(0, maxChars - BRIEF.length - date.length - 10);
  if (web.length > room) web = `${web.slice(0, room).replace(/\n[^\n]*$/, '')}\n…(more results left out to fit this small model)`;
  return [BRIEF, date, web].filter(Boolean).join('\n\n');
}

/** Keep the newest turns that fit in `maxChars` (always the last user message). */
export function fitTurns(turns: ChatMsg[], maxChars: number): ChatMsg[] {
  const out: ChatMsg[] = [];
  let used = 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    let content = turns[i].content;
    if (i === turns.length - 1 && content.length > maxChars) content = `${content.slice(0, maxChars)}\n…(cut to fit this small model)`;
    if (out.length && used + content.length > maxChars) break;
    used += content.length;
    out.unshift({ role: turns[i].role, content });
  }
  return out;
}

/** Messages for a small model: short system + newest turns, about `ctxTokens` in all. */
export function smallModelMessages(messages: ChatMsg[], ctxTokens = 4096): ChatMsg[] {
  const budget = Math.max(2000, (ctxTokens - 1100) * 3.2); // characters for input; ~1,100 tokens left for the answer
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const sys = compactSystem(system, Math.floor(budget * 0.55));
  const turns = fitTurns(
    messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: m.images?.length ? `${m.content}\n\n[A picture was attached, but this model cannot see pictures.]` : m.content })),
    Math.floor(budget - sys.length),
  );
  return [{ role: 'system', content: sys }, ...turns];
}

