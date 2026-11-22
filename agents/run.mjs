#!/usr/bin/env node
/**
 * JeeA! 24/7 agents — runs on GitHub Actions (.github/workflows/agents.yml).
 *
 * Reads agents/tasks.json, runs every task that is due, and writes Markdown
 * reports plus index.json into AGENT_OUT (the "agent-results" branch), which
 * the JeeA! website reads. API keys come from repository secrets; with no
 * secret, tasks use the shared free model.
 *
 * Local test:  AGENT_OUT=/tmp/out AGENT_FORCE=true node agents/run.mjs
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { AGENT_SYSTEM, clip, fileStamp, htmlToText, isDue, parseToolCall, pickAuto, stripToolBlock, textProtocolPrompt, validateArgs } from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(process.env.AGENT_OUT || 'agent-results');
const ONLY = (process.env.AGENT_TASK || '').trim();
const FORCE = process.env.AGENT_FORCE === 'true';
const BUDGET_MS = Number(process.env.AGENT_BUDGET_MS || 15 * 60_000);
const REPO = process.env.GITHUB_REPOSITORY || 'local';
const UA = `JeeA-agents/1.1 (+https://github.com/${REPO})`;
// Optional base-URL override for every provider (used by the test suite).
const BASE_OVERRIDE = process.env.AGENT_BASE_URL || '';
const TASKS_FILE = process.env.AGENT_TASKS_FILE || path.join(HERE, 'tasks.json');

const P = (base, env, model, extra = {}) => ({ base, env, model, kind: 'openai', ...extra });
const PROVIDERS = {
  'jeea-free': P('https://text.pollinations.ai', null, 'openai', { path: '/openai', native: false, gapMs: Number(process.env.AGENT_FREE_GAP_MS ?? 46_000) }),
  gemini: P('https://generativelanguage.googleapis.com/v1beta/openai', 'GEMINI_API_KEY', 'gemini-2.5-flash'),
  groq: P('https://api.groq.com/openai/v1', 'GROQ_API_KEY', 'llama-3.3-70b-versatile'),
  openrouter: P('https://openrouter.ai/api/v1', 'OPENROUTER_API_KEY', 'meta-llama/llama-3.3-70b-instruct:free'),
  mistral: P('https://api.mistral.ai/v1', 'MISTRAL_API_KEY', 'mistral-small-latest'),
  cerebras: P('https://api.cerebras.ai/v1', 'CEREBRAS_API_KEY', 'llama-3.3-70b'),
  openai: P('https://api.openai.com/v1', 'OPENAI_API_KEY', 'gpt-5-mini', { maxField: 'max_completion_tokens' }),
  deepseek: P('https://api.deepseek.com', 'DEEPSEEK_API_KEY', 'deepseek-chat'),
  together: P('https://api.together.xyz/v1', 'TOGETHER_API_KEY', 'meta-llama/Llama-3.3-70B-Instruct-Turbo'),
  xai: P('https://api.x.ai/v1', 'XAI_API_KEY', 'grok-4'),
  sambanova: P('https://api.sambanova.ai/v1', 'SAMBANOVA_API_KEY', 'Meta-Llama-3.3-70B-Instruct'),
  huggingface: P('https://router.huggingface.co/v1', 'HF_TOKEN', 'meta-llama/Llama-3.3-70B-Instruct'),
  cohere: P('https://api.cohere.ai/compatibility/v1', 'COHERE_API_KEY', 'command-a-03-2025'),
  nvidia: P('https://integrate.api.nvidia.com/v1', 'NVIDIA_API_KEY', 'meta/llama-3.3-70b-instruct'),
  anthropic: { base: 'https://api.anthropic.com', env: 'ANTHROPIC_API_KEY', model: 'claude-opus-5-5', kind: 'anthropic' },
};
const AUTO_ORDER = ['gemini', 'groq', 'openrouter', 'cerebras', 'mistral', 'openai', 'anthropic', 'deepseek', 'together', 'xai', 'sambanova', 'huggingface', 'cohere', 'nvidia', 'jeea-free'];
const keyOf = (id) => (PROVIDERS[id]?.env ? process.env[PROVIDERS[id].env] || '' : '');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ------------------------------------------------------------------- tools
const WIKI = (lang) => `https://${/^[a-z-]{2,12}$/.test(lang || '') ? lang : 'en'}.wikipedia.org/w/api.php`;
async function getJSON(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${new URL(url).hostname}`);
  return r.json();
}

function makeTools(task, state) {
  const all = {
    search_wikipedia: {
      description: 'Search Wikipedia articles. Returns titles, snippets and links.',
      parameters: { type: 'object', properties: { query: { type: 'string', description: 'What to search for.' }, language: { type: 'string', description: 'Language code, default "en".' } }, required: ['query'] },
      run: async ({ query, language }) => {
        const lang = language || 'en';
        const j = await getJSON(`${WIKI(lang)}?action=query&list=search&srlimit=6&format=json&srsearch=${encodeURIComponent(query)}`);
        const hits = j?.query?.search ?? [];
        return hits.length ? hits.map((h, i) => `${i + 1}. ${h.title} — ${htmlToText(h.snippet)}\n   https://${lang}.wikipedia.org/wiki/${encodeURIComponent(h.title.replace(/ /g, '_'))}`).join('\n') : 'No results.';
      },
    },
    read_wikipedia: {
      description: 'Read the plain text of one Wikipedia article by exact title.',
      parameters: { type: 'object', properties: { title: { type: 'string', description: 'Exact article title.' }, language: { type: 'string', description: 'Language code, default "en".' } }, required: ['title'] },
      run: async ({ title, language }) => {
        const lang = language || 'en';
        const j = await getJSON(`${WIKI(lang)}?action=query&prop=extracts&explaintext=1&redirects=1&format=json&titles=${encodeURIComponent(title)}`);
        const p = Object.values(j?.query?.pages ?? {})[0];
        if (!p || p.missing !== undefined || !p.extract) return `No article named "${title}".`;
        return clip(`${p.title}\nhttps://${lang}.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}\n\n${p.extract}`);
      },
    },
    fetch_url: {
      description: 'Download any public web page, RSS feed or JSON API and return its readable text.',
      parameters: { type: 'object', properties: { url: { type: 'string', description: 'Full https:// URL.' } }, required: ['url'] },
      run: async ({ url }) => {
        if (!/^https?:\/\//i.test(url)) return 'The URL must start with http:// or https://';
        const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/xml,application/json,text/plain,*/*' }, signal: AbortSignal.timeout(25_000) });
        if (!r.ok) return `Could not read ${url}: HTTP ${r.status}.`;
        const type = r.headers.get('content-type') || '';
        const body = await r.text();
        return clip(/html|xml/.test(type) ? htmlToText(body) : body);
      },
    },
    calculate: {
      description: 'Evaluate a math expression exactly, e.g. "1200*(1+0.05)^10". Use it for all arithmetic.',
      parameters: { type: 'object', properties: { expression: { type: 'string', description: 'Math expression with numbers, operators and Math functions.' } }, required: ['expression'] },
      run: async ({ expression }) => {
        const expr = String(expression).replace(/\^/g, '**');
        if (!/^[\d\s+\-*/%().,eE_a-zA-Z]*$/.test(expr)) return 'Only numbers, operators and Math functions are allowed.';
        const allowed = new Set([...Object.getOwnPropertyNames(Math), 'e', 'E']);
        const bad = (expr.match(/[a-zA-Z_]+/g) ?? []).filter((n) => !allowed.has(n));
        if (bad.length) return `Unknown name(s): ${[...new Set(bad)].join(', ')}.`;
        const value = vm.runInNewContext(`with (Math) { (${expr}) }`, { Math }, { timeout: 1000 });
        return `${expression} = ${value}`;
      },
    },
    get_datetime: {
      description: 'Get the current date and time (UTC).',
      parameters: { type: 'object', properties: {}, required: [] },
      run: async () => `${new Date().toUTCString()} (ISO ${new Date().toISOString()})`,
    },
    previous_result: {
      description: "Read this task's previous report, to spot what is new or changed.",
      parameters: { type: 'object', properties: {}, required: [] },
      run: async () => {
        try {
          return clip(await readFile(path.join(OUT, 'results', task.id, 'latest.md'), 'utf8'), 7000);
        } catch {
          return 'There is no previous report yet (this is the first run).';
        }
      },
    },
  };
  const names = Array.isArray(task.tools) && task.tools.length ? task.tools : Object.keys(all);
  return names.filter((n) => all[n]).map((name) => ({ name, ...all[name], state }));
}

// --------------------------------------------------------------- model calls
let lastFreeCall = 0;

async function callOpenAI(prov, key, model, messages, tools) {
  const base = BASE_OVERRIDE || prov.base;
  const url = `${base}${prov.path ?? '/chat/completions'}`;
  const body = { model, messages };
  if (tools?.length) {
    body.tools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
    body.tool_choice = 'auto';
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    if (prov.gapMs) {
      const wait = lastFreeCall + prov.gapMs - Date.now();
      if (wait > 0) await sleep(wait);
      lastFreeCall = Date.now();
    }
    const headers = { 'Content-Type': 'application/json', 'User-Agent': UA };
    if (key) headers.Authorization = `Bearer ${key}`;
    if (prov === PROVIDERS.openrouter) headers['X-Title'] = 'JeeA! 24/7 agents';
    let r;
    try {
      r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(180_000) });
    } catch (e) {
      if (attempt < 3) { await sleep(2000 * 2 ** attempt); continue; }
      throw new Error(`Network error: ${e.message}`);
    }
    if (r.ok) {
      const j = await r.json();
      const msg = j?.choices?.[0]?.message ?? {};
      return {
        content: msg.content ?? '',
        toolCalls: (msg.tool_calls ?? []).map((c) => ({ id: c.id, name: c.function?.name, argsText: typeof c.function?.arguments === 'string' ? c.function.arguments : JSON.stringify(c.function?.arguments ?? {}) })),
        tokensIn: j?.usage?.prompt_tokens ?? 0,
        tokensOut: j?.usage?.completion_tokens ?? 0,
      };
    }
    const text = await r.text().catch(() => '');
    const ra = Number(r.headers.get('retry-after'));
    if ((r.status === 429 || r.status === 402 || r.status >= 500) && attempt < 3) {
      const wait = Math.min(120_000, Number.isFinite(ra) && ra > 0 ? ra * 1000 : 3000 * 2 ** attempt);
      log(`  ${r.status} from provider, retrying in ${Math.round(wait / 1000)} s`);
      await sleep(wait);
      continue;
    }
    const err = new Error(`HTTP ${r.status}: ${text.slice(0, 300)}`);
    err.status = r.status;
    throw err;
  }
  throw new Error('Provider kept failing after retries.');
}

async function callAnthropic(key, model, system, messages, tools) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: key, maxRetries: 3 });
  const res = await client.messages.create({
    model,
    max_tokens: 16000,
    system,
    messages,
    tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })),
    ...(/claude-(opus|sonnet|haiku|fable|mythos)-(5|4-[6-9])/.test(model) ? { thinking: { type: 'adaptive' } } : {}),
  });
  return res;
}

// ------------------------------------------------------------------ agent
async function runTask(task, providerId, model) {
  const prov = PROVIDERS[providerId];
  const key = keyOf(providerId);
  const tools = makeTools(task, {});
  const names = tools.map((t) => t.name);
  const system = `${AGENT_SYSTEM}\nToday is ${new Date().toUTCString()}.`;
  const maxSteps = Math.max(1, Math.min(15, task.maxSteps || 8));
  const steps = [];
  let tokensIn = 0;
  let tokensOut = 0;
  let mode = prov.kind === 'anthropic' ? 'anthropic' : prov.native === false ? 'text' : 'openai';

  const oai = [{ role: 'system', content: system }, { role: 'user', content: task.prompt }];
  const txt = [{ role: 'system', content: `${system}\n\n${textProtocolPrompt(tools)}` }, { role: 'user', content: task.prompt }];
  const anth = [{ role: 'user', content: task.prompt }];

  const exec = async (name, args) => {
    const tool = tools.find((t) => t.name === name);
    const t0 = Date.now();
    let text;
    let ok = true;
    if (!tool) [text, ok] = [`Tool "${name}" is not available. Available: ${names.join(', ')}.`, false];
    else {
      const bad = validateArgs(tool, args);
      if (bad) [text, ok] = [bad, false];
      else {
        try {
          text = await tool.run(args);
        } catch (e) {
          [text, ok] = [`Error: ${e.message}`, false];
        }
      }
    }
    steps.push({ name, args, ok, ms: Date.now() - t0 });
    log(`  tool ${name} ${ok ? 'ok' : 'failed'} (${Date.now() - t0} ms)`);
    return { text: String(text), ok };
  };

  for (let turn = 0; turn <= maxSteps; turn++) {
    const last = turn === maxSteps;
    const nudge = { role: 'user', content: 'Step limit reached. Do not call tools. Give your final answer now.' };
    if (mode === 'anthropic') {
      const res = await callAnthropic(key, model, system, last ? [...anth, nudge] : anth, tools);
      tokensIn += res.usage?.input_tokens ?? 0;
      tokensOut += res.usage?.output_tokens ?? 0;
      const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      const uses = res.content.filter((b) => b.type === 'tool_use');
      if (res.stop_reason === 'refusal') return { answer: `${text}\n\n> The model declined this request.`, steps, tokensIn, tokensOut };
      if (last || !uses.length || res.stop_reason !== 'tool_use') return { answer: text, steps, tokensIn, tokensOut };
      anth.push({ role: 'assistant', content: res.content });
      const results = [];
      for (const u of uses) {
        const r = await exec(u.name, u.input ?? {});
        results.push({ type: 'tool_result', tool_use_id: u.id, content: r.text, ...(r.ok ? {} : { is_error: true }) });
      }
      anth.push({ role: 'user', content: results });
      continue;
    }

    let res;
    try {
      res = await callOpenAI(prov, key, model, mode === 'openai' ? (last ? [...oai, nudge] : oai) : last ? [...txt, nudge] : txt, mode === 'openai' && !last ? tools : undefined);
    } catch (e) {
      if (mode === 'openai' && e.status >= 400 && e.status < 500 && /tool|function/i.test(e.message)) {
        log('  native tools rejected; switching to the text tool protocol');
        mode = 'text';
        turn--;
        continue;
      }
      throw e;
    }
    tokensIn += res.tokensIn;
    tokensOut += res.tokensOut;

    if (mode === 'openai') {
      const calls = (res.toolCalls ?? []).filter((c) => c.name);
      if (last || !calls.length) return { answer: res.content, steps, tokensIn, tokensOut };
      const ids = calls.map((c, i) => c.id || `call_${turn}_${i}`);
      const parsed = calls.map((c) => {
        try {
          return c.argsText?.trim() ? JSON.parse(c.argsText) : {};
        } catch {
          return null;
        }
      });
      oai.push({ role: 'assistant', content: res.content || null, tool_calls: calls.map((c, i) => ({ id: ids[i], type: 'function', function: { name: c.name, arguments: JSON.stringify(parsed[i] ?? {}) } })) });
      for (let i = 0; i < calls.length; i++) {
        const r = parsed[i] === null ? { text: 'The tool arguments were not valid JSON.' } : await exec(calls[i].name, parsed[i]);
        oai.push({ role: 'tool', tool_call_id: ids[i], content: r.text, ...(providerId === 'mistral' ? { name: calls[i].name } : {}) });
      }
      continue;
    }

    // text protocol
    const call = last ? null : parseToolCall(res.content, names);
    if (!call) return { answer: stripToolBlock(res.content), steps, tokensIn, tokensOut };
    const r = await exec(call.name, call.args);
    txt.push({ role: 'assistant', content: res.content });
    txt.push({ role: 'user', content: `Result of ${call.name}:\n${r.text}\n\nContinue the task. Use another tool if needed, or give the final answer.` });
  }
  return { answer: '', steps, tokensIn, tokensOut };
}

function resolveModel(spec) {
  const s = String(spec || 'auto').trim();
  if (s === 'auto') {
    const id = pickAuto(AUTO_ORDER, Object.fromEntries(AUTO_ORDER.map((p) => [p, keyOf(p)])), (p) => !!PROVIDERS[p].env);
    return { providerId: id, model: PROVIDERS[id].model };
  }
  const i = s.indexOf(':');
  const providerId = i > 0 ? s.slice(0, i) : s;
  if (!PROVIDERS[providerId]) throw new Error(`Unknown provider "${providerId}". Use one of: ${Object.keys(PROVIDERS).join(', ')}.`);
  if (PROVIDERS[providerId].env && !keyOf(providerId)) throw new Error(`The secret ${PROVIDERS[providerId].env} is not set in this repository.`);
  return { providerId, model: (i > 0 && s.slice(i + 1)) || PROVIDERS[providerId].model };
}

// ------------------------------------------------------------------- main
async function main() {
  const started = Date.now();
  const cfg = JSON.parse(await readFile(TASKS_FILE, 'utf8'));
  const tasks = (cfg.tasks ?? []).filter((t) => t && t.id && t.prompt);
  await mkdir(path.join(OUT, 'results'), { recursive: true });
  let index = { updatedAt: new Date().toISOString(), tasks: {}, runs: [] };
  try {
    index = JSON.parse(await readFile(path.join(OUT, 'index.json'), 'utf8'));
  } catch {
    /* first run */
  }

  let ran = 0;
  for (const task of tasks) {
    const prev = index.tasks[task.id];
    const selected = ONLY ? task.id === ONLY : task.enabled !== false;
    if (!selected) continue;
    if (!FORCE && !ONLY && !isDue(prev?.lastRun, task.every)) {
      log(`skip ${task.id}: not due yet (every ${task.every || '1d'})`);
      continue;
    }
    if (Date.now() - started > BUDGET_MS) {
      log(`stop: time budget used, ${task.id} waits for the next run`);
      break;
    }
    ran++;
    const at = new Date();
    const t0 = Date.now();
    let record;
    let report;
    try {
      const { providerId, model } = resolveModel(task.model);
      const label = `${providerId}:${model}`;
      log(`run ${task.id} with ${label}`);
      const r = await runTask(task, providerId, model);
      const ms = Date.now() - t0;
      const answer = (r.answer || '').trim() || '(The agent finished without a written answer.)';
      const stepsMd = r.steps.map((s, i) => `${i + 1}. \`${s.name}\` ${JSON.stringify(s.args).slice(0, 160)} — ${s.ok ? 'ok' : 'failed'} (${s.ms} ms)`).join('\n');
      report = `# ${task.name}\n\n- **When:** ${at.toUTCString()}\n- **Model:** ${label}\n- **Tool steps:** ${r.steps.length}\n- **Time:** ${(ms / 1000).toFixed(1)} s\n\n---\n\n${answer}\n${stepsMd ? `\n---\n\n**Steps**\n\n${stepsMd}\n` : ''}`;
      record = { task: task.id, name: task.name, at: at.toISOString(), status: 'ok', model: label, steps: r.steps.length, ms, tokensIn: r.tokensIn, tokensOut: r.tokensOut, summary: answer.replace(/[#*_>`|-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240) };
      log(`done ${task.id} in ${(ms / 1000).toFixed(1)} s`);
    } catch (e) {
      const ms = Date.now() - t0;
      report = `# ${task.name}\n\n- **When:** ${at.toUTCString()}\n- **Status:** failed\n\n${e.message}\n`;
      record = { task: task.id, name: task.name, at: at.toISOString(), status: 'error', ms, error: String(e.message).slice(0, 300) };
      log(`fail ${task.id}: ${e.message}`);
    }
    const dir = path.join(OUT, 'results', task.id);
    await mkdir(dir, { recursive: true });
    const file = `${fileStamp(at)}.md`;
    await writeFile(path.join(dir, file), report);
    if (record.status === 'ok') await writeFile(path.join(dir, 'latest.md'), report);
    record.path = `results/${task.id}/${file}`;
    index.runs = [record, ...(index.runs ?? [])].slice(0, 200);
    index.tasks[task.id] = { name: task.name, lastRun: record.at, lastStatus: record.status, every: task.every || '1d', model: task.model || 'auto' };
  }

  index.updatedAt = new Date().toISOString();
  await writeFile(path.join(OUT, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  log(`finished: ${ran} task(s) run`);
}

main().catch((e) => {
  console.error('Agent runner crashed:', e);
  process.exit(1);
});
