/**
 * Pure helpers for agent mode (no browser APIs, no imports) so they can be
 * unit-tested in Node. The same text protocol is used by the 24/7 GitHub
 * agents in agents/lib.mjs.
 */

/** Wikipedia tools stay available in the Tools list but are off by default:
 * the site owner's rules do not accept Wikipedia as a source. */
export const DEFAULT_AGENT_TOOLS = [
  'fetch_url',
  'calculate',
  'run_javascript',
  'get_datetime',
  'remember',
  'recall',
  'write_file',
  'read_file',
  'list_files',
  'create_web_app',
  'ask_model',
];

export interface ToolSchema {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required: string[];
  };
}

export interface ParsedToolCall {
  name: string;
  args: Record<string, unknown>;
}

const BLOCK = /```(?:tool|tool_call|json)?\s*\n?(\{[\s\S]*?\})\s*```/;

/**
 * Find a tool request in a model reply that uses the text protocol:
 *   ```tool
 *   {"name": "calculate", "arguments": {"expression": "2+2"}}
 *   ```
 * Returns null when the reply is a final answer.
 */
export function parseToolCall(text: string, known: string[]): ParsedToolCall | null {
  const m = text.match(BLOCK);
  if (!m) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(m[1]);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as { name?: unknown; tool?: unknown; arguments?: unknown; args?: unknown; parameters?: unknown };
  const name = typeof o.name === 'string' ? o.name : typeof o.tool === 'string' ? o.tool : null;
  if (!name || !known.includes(name)) return null;
  const rawArgs = o.arguments ?? o.args ?? o.parameters ?? {};
  let args: Record<string, unknown> = {};
  if (typeof rawArgs === 'string') {
    try {
      args = JSON.parse(rawArgs);
    } catch {
      args = {};
    }
  } else if (rawArgs && typeof rawArgs === 'object') args = rawArgs as Record<string, unknown>;
  return { name, args };
}

/** The reply text without the tool block (shown as the agent's "thought"). */
export function stripToolBlock(text: string): string {
  return text.replace(BLOCK, '').trim();
}

/** Check required arguments and basic types; returns an error message or null. */
export function validateArgs(schema: ToolSchema, args: Record<string, unknown>): string | null {
  for (const key of schema.parameters.required) {
    if (args[key] === undefined || args[key] === null || args[key] === '') return `Missing required argument "${key}".`;
  }
  for (const [key, val] of Object.entries(args)) {
    const spec = schema.parameters.properties[key];
    if (!spec) continue;
    if (spec.type === 'string' && typeof val !== 'string') return `Argument "${key}" must be text.`;
    if (spec.type === 'number' && typeof val !== 'number') return `Argument "${key}" must be a number.`;
  }
  return null;
}

/** Turn an HTML page into readable plain text. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|header|footer)>/gi, '\n')
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

export const clip = (s: string, max = 8000) => (s.length > max ? `${s.slice(0, max)}\n…(cut at ${max} characters)` : s);

/** Instructions for models that do not support native tool calling. */
export function textProtocolPrompt(tools: ToolSchema[]): string {
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

export const AGENT_SYSTEM = `You are JeeA! Agent, a careful assistant that completes tasks step by step with tools.
- Make a short plan, then act. Use tools when they help; do not guess facts you can look up.
- After each tool result, decide the next step. Stop as soon as the task is done.
- Say clearly when a tool failed or when you are unsure. Never invent sources or results.
- The final answer must be complete, well structured Markdown. Cite the URLs you used.`;
