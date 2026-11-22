// Pure helpers for the 24/7 agents (no I/O). Mirrors src/lib/agentText.ts.

export const AGENT_SYSTEM = `You are JeeA! Agent, running unattended on a schedule.
- Make a short plan, then act. Use tools for facts; never guess what you can look up.
- Stop as soon as the task is done. If a tool fails, say so plainly.
- Never invent sources or results. Cite the URLs you used.
- Your final answer is saved as a Markdown report, so make it complete and well structured.`;

const BLOCK = /```(?:tool|tool_call|json)?\s*\n?(\{[\s\S]*?\})\s*```/;

/** Parse a ```tool {"name":..,"arguments":{..}}``` block; null = final answer. */
export function parseToolCall(text, known) {
  const m = String(text ?? '').match(BLOCK);
  if (!m) return null;
  let o;
  try {
    o = JSON.parse(m[1]);
  } catch {
    return null;
  }
  if (!o || typeof o !== 'object') return null;
  const name = typeof o.name === 'string' ? o.name : typeof o.tool === 'string' ? o.tool : null;
  if (!name || !known.includes(name)) return null;
  let args = o.arguments ?? o.args ?? o.parameters ?? {};
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args);
    } catch {
      args = {};
    }
  }
  return { name, args: args && typeof args === 'object' ? args : {} };
}

export const stripToolBlock = (text) => String(text ?? '').replace(BLOCK, '').trim();

export function htmlToText(html) {
  return String(html ?? '')
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|header|footer|item|entry)>/gi, '\n')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export const clip = (s, max = 9000) => (s.length > max ? `${s.slice(0, max)}\n…(cut at ${max} characters)` : s);

/** "30m", "1h", "1d", "7d" -> milliseconds. Unknown values fall back to 1 day. */
export function parseEvery(every) {
  const m = String(every ?? '').trim().match(/^(\d+(?:\.\d+)?)\s*(m|min|h|d|w)$/i);
  if (!m) return 86_400_000;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  const ms = unit === 'w' ? 604_800_000 : unit === 'd' ? 86_400_000 : unit === 'h' ? 3_600_000 : 60_000;
  return Math.max(5 * 60_000, n * ms);
}

/** Due when the interval has passed, with 5 minutes of slack for late runs. */
export function isDue(lastRunIso, every, now = Date.now()) {
  if (!lastRunIso) return true;
  const last = Date.parse(lastRunIso);
  if (!Number.isFinite(last)) return true;
  return now - last >= parseEvery(every) - 5 * 60_000;
}

export function validateArgs(schema, args) {
  for (const key of schema.parameters.required ?? []) {
    if (args[key] === undefined || args[key] === null || args[key] === '') return `Missing required argument "${key}".`;
  }
  return null;
}

export function textProtocolPrompt(tools) {
  const list = tools
    .map((t) => {
      const params = Object.entries(t.parameters.properties)
        .map(([k, v]) => `${k} (${v.type}${t.parameters.required.includes(k) ? ', required' : ''}): ${v.description}`)
        .join('; ');
      return `- ${t.name}: ${t.description}${params ? ` Arguments: ${params}` : ''}`;
    })
    .join('\n');
  return `You can use tools. Available tools:\n${list}\n\nTo use a tool, reply with a short sentence about why, then exactly one block like this and nothing after it:\n\`\`\`tool\n{"name": "tool_name", "arguments": {"key": "value"}}\n\`\`\`\nYou will then receive the tool result. Use one tool at a time. When you have enough information, reply with your final answer in Markdown and no tool block.`;
}

/** File-name-safe UTC timestamp, e.g. 2026-11-22T10-17-03Z. */
export const fileStamp = (d = new Date()) => d.toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, '-');

/** Pick the provider for "auto" from the secrets that exist. */
export function pickAuto(order, env, needsKey) {
  for (const id of order) if (!needsKey(id) || env[id]) return id;
  return null;
}
