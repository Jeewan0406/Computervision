import { get as idbGet, set as idbSet } from 'idb-keyval';
import type { AgentSession, ModelRef } from './types';
import { clip, htmlToText, type ToolSchema } from './agentText';
import { useData } from './data';
import { useSettings, usableModelRefs, getProvider } from './settings';
import { runChat } from './runner';
import { uid, titleFrom } from './utils';
import { wrapDoc } from './text';

/**
 * Tools the browser agent can use. Each tool runs inside this browser:
 * nothing goes to a JeeA! server (there is none). Network tools only reach
 * the public site named in the call.
 */

export interface ToolResult {
  text: string;
  /** Optional link the UI can show next to the step (e.g. open a CodeFrame project). */
  link?: { view: 'code'; sessionId: string; label: string };
}

export interface ToolContext {
  sessionId: string;
  signal: AbortSignal;
}

export interface AgentTool extends ToolSchema {
  label: string;
  emoji: string;
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<string | ToolResult>;
}

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));

// ---------------------------------------------------------------- sandbox
/**
 * Runs code in a hidden iframe WITHOUT allow-same-origin, inside a Web
 * Worker. The code cannot read JeeA!'s storage (keys, chats), and an endless
 * loop cannot freeze the page: the frame is removed after the time limit.
 */
const WORKER = `self.onmessage=async(e)=>{const logs=[];const f=a=>{try{return typeof a==='string'?a:JSON.stringify(a)}catch(_){return String(a)}};const c=(...a)=>logs.push(a.map(f).join(' '));self.console={log:c,info:c,warn:c,error:c,debug:c};try{const AF=Object.getPrototypeOf(async function(){}).constructor;const r=await new AF(e.data.code)();postMessage({ok:true,logs,result:r===undefined?undefined:f(r)})}catch(err){postMessage({ok:false,logs,error:String((err&&err.message)||err)})}};`;
const FRAME = `<!doctype html><script>addEventListener('message',e=>{const d=e.data||{};if(!d.code)return;let w;try{w=new Worker(URL.createObjectURL(new Blob([${JSON.stringify(WORKER)}],{type:'text/javascript'})))}catch(err){parent.postMessage({__jeeaRun:d.id,ok:false,logs:[],error:'Could not start the sandbox: '+err.message},'*');return}w.onmessage=m=>{parent.postMessage(Object.assign({__jeeaRun:d.id},m.data),'*');w.terminate()};w.onerror=err=>{parent.postMessage({__jeeaRun:d.id,ok:false,logs:[],error:err.message||'Script error'},'*')};w.postMessage({code:d.code})});parent.postMessage({__jeeaReady:1},'*');<\/script>`;

export function runSandboxed(code: string, timeoutMs = 8000, signal?: AbortSignal): Promise<{ ok: boolean; logs: string[]; result?: string; error?: string }> {
  return new Promise((resolve) => {
    const id = uid();
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.style.display = 'none';
    frame.srcdoc = FRAME;
    let done = false;
    const finish = (r: { ok: boolean; logs: string[]; result?: string; error?: string }) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      window.removeEventListener('message', onMsg);
      signal?.removeEventListener('abort', onAbort);
      frame.remove();
      resolve(r);
    };
    const onMsg = (e: MessageEvent) => {
      if (e.source !== frame.contentWindow) return;
      if (e.data?.__jeeaReady) frame.contentWindow?.postMessage({ id, code }, '*');
      else if (e.data?.__jeeaRun === id) finish({ ok: !!e.data.ok, logs: e.data.logs ?? [], result: e.data.result, error: e.data.error });
    };
    const onAbort = () => finish({ ok: false, logs: [], error: 'Stopped.' });
    const timer = setTimeout(() => finish({ ok: false, logs: [], error: `Time limit of ${timeoutMs / 1000} s reached (the code may loop forever).` }), timeoutMs);
    window.addEventListener('message', onMsg);
    signal?.addEventListener('abort', onAbort, { once: true });
    document.body.appendChild(frame);
  });
}

// ---------------------------------------------------------------- helpers
async function getJSON(url: string, signal: AbortSignal) {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${new URL(url).hostname}`);
  return r.json();
}

const WIKI = (lang: string) => `https://${/^[a-z-]{2,12}$/.test(lang) ? lang : 'en'}.wikipedia.org/w/api.php`;

const MEMORY_KEY = 'jeea.memory.v1';
interface Memory { id: string; text: string; at: number }
async function loadMemory(): Promise<Memory[]> {
  try {
    return ((await idbGet(MEMORY_KEY)) as Memory[] | undefined) ?? [];
  } catch {
    return [];
  }
}
export async function memoryCount() {
  return (await loadMemory()).length;
}
export async function clearMemory() {
  await idbSet(MEMORY_KEY, []);
}

const agentSession = (id: string) => useData.getState().sessions[id] as AgentSession | undefined;

/** "provider:model" ids of models the agent may delegate to. */
export function delegateIds(): string[] {
  return usableModelRefs(8).map((r) => `${r.providerId}:${r.model}`);
}

// ---------------------------------------------------------------- tools
export const AGENT_TOOLS: AgentTool[] = [
  {
    name: 'search_wikipedia',
    label: 'Search Wikipedia',
    emoji: '🔎',
    description: 'Search Wikipedia articles. Returns titles, short snippets and links. Use it to find facts before answering.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to search for.' },
        language: { type: 'string', description: 'Wikipedia language code, e.g. "en", "ne", "hi". Default "en".' },
      },
      required: ['query'],
    },
    run: async (a, ctx) => {
      const lang = str(a.language) || 'en';
      const u = `${WIKI(lang)}?action=query&list=search&srlimit=6&format=json&origin=*&srsearch=${encodeURIComponent(str(a.query))}`;
      const j = await getJSON(u, ctx.signal);
      const hits = (j?.query?.search ?? []) as { title: string; snippet: string }[];
      if (!hits.length) return 'No results.';
      return hits
        .map((h, i) => `${i + 1}. ${h.title} — ${htmlToText(h.snippet)}\n   https://${lang}.wikipedia.org/wiki/${encodeURIComponent(h.title.replace(/ /g, '_'))}`)
        .join('\n');
    },
  },
  {
    name: 'read_wikipedia',
    label: 'Read Wikipedia',
    emoji: '📖',
    description: 'Read the plain text of one Wikipedia article by its exact title.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Exact article title, e.g. "Mount Everest".' },
        language: { type: 'string', description: 'Language code. Default "en".' },
      },
      required: ['title'],
    },
    run: async (a, ctx) => {
      const lang = str(a.language) || 'en';
      const u = `${WIKI(lang)}?action=query&prop=extracts&explaintext=1&redirects=1&format=json&origin=*&titles=${encodeURIComponent(str(a.title))}`;
      const j = await getJSON(u, ctx.signal);
      const pages = Object.values(j?.query?.pages ?? {}) as { title?: string; extract?: string; missing?: string }[];
      const p = pages[0];
      if (!p || p.missing !== undefined || !p.extract) return `No article named "${str(a.title)}". Try search_wikipedia first.`;
      return clip(`${p.title}\nhttps://${lang}.wikipedia.org/wiki/${encodeURIComponent((p.title ?? '').replace(/ /g, '_'))}\n\n${p.extract}`, 9000);
    },
  },
  {
    name: 'fetch_url',
    label: 'Read a web page',
    emoji: '🌐',
    description: 'Download a public web page or API (http/https) and return its readable text. Some sites block this from browsers.',
    parameters: { type: 'object', properties: { url: { type: 'string', description: 'Full URL starting with https://' } }, required: ['url'] },
    run: async (a, ctx) => {
      const url = str(a.url).trim();
      if (!/^https?:\/\//i.test(url)) return 'The URL must start with http:// or https://';
      const proxy = useSettings.getState().corsProxy;
      let res: Response | null = null;
      let firstErr = '';
      try {
        res = await fetch(url, { signal: ctx.signal });
      } catch (e) {
        if ((e as Error).name === 'AbortError') throw e;
        firstErr = 'the site does not allow reading from other web pages (CORS)';
      }
      if (!res && proxy) res = await fetch(`${proxy}${url}`, { signal: ctx.signal });
      if (!res) return `Could not read ${url}: ${firstErr}. Set up the CORS proxy (API Slots → Routing), or rely on the trusted web results JeeA! gave you.`;
      if (!res.ok) return `Could not read ${url}: HTTP ${res.status}.`;
      const type = res.headers.get('content-type') ?? '';
      const body = await res.text();
      return clip(type.includes('html') ? htmlToText(body) : body, 9000);
    },
  },
  {
    name: 'calculate',
    label: 'Calculate',
    emoji: '🧮',
    description: 'Evaluate a math expression exactly, e.g. "1200 * (1 + 0.05)^10" or "sqrt(2) * PI". Use it for any arithmetic.',
    parameters: { type: 'object', properties: { expression: { type: 'string', description: 'Math expression. Supports + - * / % ^ ( ) and Math functions like sqrt, log, sin, PI.' } }, required: ['expression'] },
    run: async (a, ctx) => {
      const expr = str(a.expression).replace(/\^/g, '**').replace(/×/g, '*').replace(/÷/g, '/');
      if (!/^[\d\s+\-*/%().,eE_a-zA-Z]*$/.test(expr)) return 'Only numbers, operators and Math functions are allowed.';
      const names = expr.match(/[a-zA-Z_]+/g) ?? [];
      const allowed = new Set(Object.getOwnPropertyNames(Math).concat(['e', 'E']));
      const bad = names.filter((n) => !allowed.has(n));
      if (bad.length) return `Unknown name(s): ${[...new Set(bad)].join(', ')}.`;
      const r = await runSandboxed(`with (Math) { return (${expr}); }`, 3000, ctx.signal);
      return r.ok ? `${str(a.expression)} = ${r.result}` : `Error: ${r.error}`;
    },
  },
  {
    name: 'run_javascript',
    label: 'Run JavaScript',
    emoji: '⚙️',
    description: 'Run JavaScript in a locked sandbox (no page access, 8 second limit). Use console.log for output and "return" for a result. Good for data processing and checks.',
    parameters: { type: 'object', properties: { code: { type: 'string', description: 'JavaScript code (an async function body).' } }, required: ['code'] },
    run: async (a, ctx) => {
      const r = await runSandboxed(str(a.code), 8000, ctx.signal);
      const out = [r.logs.length ? `Console:\n${r.logs.join('\n')}` : '', r.ok ? `Result: ${r.result ?? '(no return value)'}` : `Error: ${r.error}`].filter(Boolean).join('\n');
      return clip(out, 6000);
    },
  },
  {
    name: 'get_datetime',
    label: 'Date and time',
    emoji: '🕒',
    description: 'Get the current date, time and time zone of the user.',
    parameters: { type: 'object', properties: {}, required: [] },
    run: async () => {
      const d = new Date();
      return `${d.toString()}\nISO (UTC): ${d.toISOString()}\nTime zone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`;
    },
  },
  {
    name: 'remember',
    label: 'Remember',
    emoji: '🧠',
    description: 'Save a short fact or preference to long-term memory so future agent tasks can use it.',
    parameters: { type: 'object', properties: { fact: { type: 'string', description: 'The fact to remember, in one sentence.' } }, required: ['fact'] },
    run: async (a) => {
      const mem = await loadMemory();
      mem.unshift({ id: uid(), text: str(a.fact).slice(0, 500), at: Date.now() });
      await idbSet(MEMORY_KEY, mem.slice(0, 200));
      return `Saved to memory (${Math.min(mem.length, 200)} items).`;
    },
  },
  {
    name: 'recall',
    label: 'Recall',
    emoji: '💭',
    description: 'Search long-term memory. Leave the query empty to list the latest memories.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'Words to look for (optional).' } }, required: [] },
    run: async (a) => {
      const mem = await loadMemory();
      const words = str(a.query).toLowerCase().split(/\W+/).filter((w) => w.length > 2);
      const hits = words.length ? mem.filter((m) => words.some((w) => m.text.toLowerCase().includes(w))) : mem;
      if (!hits.length) return 'Nothing found in memory.';
      return hits.slice(0, 20).map((m) => `- ${m.text} (${new Date(m.at).toLocaleDateString()})`).join('\n');
    },
  },
  {
    name: 'write_file',
    label: 'Write file',
    emoji: '📝',
    description: 'Create or replace a text file in this task\'s workspace (the user can download it).',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'File name, e.g. "report.md".' }, content: { type: 'string', description: 'Full file content.' } },
      required: ['path', 'content'],
    },
    run: async (a, ctx) => {
      const path = str(a.path).replace(/^\/+/, '').slice(0, 120) || 'file.txt';
      const content = str(a.content);
      useData.getState().update(ctx.sessionId, (s) => {
        (s as AgentSession).files[path] = content;
      }, false);
      return `Saved ${path} (${content.length} characters).`;
    },
  },
  {
    name: 'read_file',
    label: 'Read file',
    emoji: '📄',
    description: 'Read a file from this task\'s workspace.',
    parameters: { type: 'object', properties: { path: { type: 'string', description: 'File name.' } }, required: ['path'] },
    run: async (a, ctx) => {
      const f = agentSession(ctx.sessionId)?.files[str(a.path).replace(/^\/+/, '')];
      return f == null ? `No file named ${str(a.path)}.` : clip(f, 9000);
    },
  },
  {
    name: 'list_files',
    label: 'List files',
    emoji: '🗂️',
    description: 'List the files in this task\'s workspace.',
    parameters: { type: 'object', properties: {}, required: [] },
    run: async (_a, ctx) => {
      const files = Object.entries(agentSession(ctx.sessionId)?.files ?? {});
      return files.length ? files.map(([p, c]) => `- ${p} (${c.length} characters)`).join('\n') : 'The workspace is empty.';
    },
  },
  {
    name: 'create_web_app',
    label: 'Create web app',
    emoji: '🧩',
    description: 'Create a runnable web app (one complete HTML file with inline CSS and JS) and open it as a CodeFrame project.',
    parameters: {
      type: 'object',
      properties: { title: { type: 'string', description: 'Short app name.' }, html: { type: 'string', description: 'Complete HTML document.' } },
      required: ['title', 'html'],
    },
    run: async (a) => {
      let html = str(a.html);
      if (!/<html[\s>]|<!doctype/i.test(html)) html = wrapDoc(html, '', '');
      const title = titleFrom(str(a.title) || 'Agent app');
      const id = useData.getState().create('code', { title, code: html, versions: [{ id: uid(), at: Date.now(), code: html, note: 'Created by the agent' }] });
      return { text: `Created the CodeFrame project "${title}" (${html.length} characters). The user can open and run it.`, link: { view: 'code', sessionId: id, label: `Open “${title}” in CodeFrame` } };
    },
  },
  {
    name: 'ask_model',
    label: 'Ask another model',
    emoji: '🤝',
    description: 'Ask a different AI model a question and get its answer. Use it for a second opinion or a sub-task.',
    parameters: {
      type: 'object',
      properties: {
        model: { type: 'string', description: 'Model id as "provider:model". Use one of the ids listed in the system message.' },
        question: { type: 'string', description: 'The full question or sub-task, with any context it needs.' },
      },
      required: ['model', 'question'],
    },
    run: async (a, ctx) => {
      const raw = str(a.model);
      const i = raw.indexOf(':');
      const ref: ModelRef = i > 0 ? { providerId: raw.slice(0, i), model: raw.slice(i + 1) } : usableModelRefs(1)[0];
      if (!getProvider(ref.providerId)) return `Unknown provider "${ref.providerId}". Available: ${delegateIds().join(', ')}`;
      let text = '';
      const r = await runChat({
        ref,
        messages: [{ role: 'user', content: str(a.question) }],
        feature: 'agent',
        signal: ctx.signal,
        onText: (d) => (text += d),
      });
      return clip(`Answer from ${ref.providerId}:${ref.model}:\n${r.content || text}`, 8000);
    },
  },
];

export const TOOL_BY_NAME = new Map(AGENT_TOOLS.map((t) => [t.name, t]));
