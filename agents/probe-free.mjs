// Checks which free, no-key model services answer from a browser page.
// Run by .github/workflows/probe.yml (by hand). For each service it reads
// the model list, sends one tiny chat request without any key, and records
// whether the reply allows a web page to read it (CORS). Prints a report.
// No personal data is sent: the prompt is a fixed test sentence.

const ORIGIN = 'https://jeewan0406.github.io';
const UA = 'JeeA-free-model-check/1.0';
const PROMPT = [{ role: 'user', content: 'Reply with the single word: ready' }];

const CANDIDATES = [
  { id: 'pollinations-legacy', models: 'https://text.pollinations.ai/models', chat: 'https://text.pollinations.ai/openai', model: 'openai' },
  { id: 'pollinations-gen', models: 'https://gen.pollinations.ai/v1/models', chat: 'https://gen.pollinations.ai/v1/chat/completions', model: 'openai' },
  { id: 'ovhcloud', models: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/models', chat: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions', pick: (ids) => ids.find((m) => /llama|mistral|qwen/i.test(m)) ?? ids[0] },
  { id: 'kilo-ai-gateway', models: 'https://ai-gateway.kilo.ai/api/v1/models', chat: 'https://ai-gateway.kilo.ai/api/v1/chat/completions', pick: (ids) => ids.find((m) => m.endsWith(':free')) },
  { id: 'kilo-api-gateway', models: 'https://api.kilo.ai/api/gateway/models', chat: 'https://api.kilo.ai/api/gateway/chat/completions', pick: (ids) => ids.find((m) => m.endsWith(':free')) },
  { id: 'aihorde-oai', models: 'https://oai.aihorde.net/v1/models', chat: 'https://oai.aihorde.net/v1/chat/completions', key: '0000000000', pick: (ids) => ids[0], timeout: 90000 },
  { id: 'llm7', models: 'https://api.llm7.io/v1/models', chat: 'https://api.llm7.io/v1/chat/completions', pick: (ids) => ids.find((m) => /gpt|mistral|llama|qwen/i.test(m)) ?? ids[0] },
  { id: 'openrouter-nokey', models: 'https://openrouter.ai/api/v1/models', chat: 'https://openrouter.ai/api/v1/chat/completions', model: 'openrouter/free' },
  { id: 'mlvoca', chat: 'https://mlvoca.com/api/generate', ollama: true, model: 'tinyllama' },
  { id: 'apifreellm', chat: 'https://apifreellm.com/api/chat', simple: true },
];

const cut = (s, n = 220) => String(s).replace(/\s+/g, ' ').slice(0, n);
const corsOf = (h) => ({ acao: h.get('access-control-allow-origin'), acah: h.get('access-control-allow-headers'), acam: h.get('access-control-allow-methods') });

async function go(url, init = {}, ms = 30000) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { ...init, headers: { 'user-agent': UA, origin: ORIGIN, ...(init.headers || {}) }, signal: AbortSignal.timeout(ms) });
    const text = await res.text();
    return { status: res.status, ms: Date.now() - t0, cors: corsOf(res.headers), type: res.headers.get('content-type'), text };
  } catch (e) {
    return { status: 0, ms: Date.now() - t0, error: cut(e.cause?.message || e.message) };
  }
}

function modelIds(text) {
  try {
    const j = JSON.parse(text);
    const arr = Array.isArray(j) ? j : j.data || j.models || [];
    return arr.map((m) => (typeof m === 'string' ? m : m.id || m.name)).filter(Boolean);
  } catch {
    return [];
  }
}

async function probe(c) {
  const out = { id: c.id };
  let ids = [];
  if (c.models) {
    const r = await go(c.models, { headers: c.key ? { authorization: `Bearer ${c.key}` } : {} });
    ids = r.status === 200 ? modelIds(r.text) : [];
    out.models = { status: r.status, ms: r.ms, cors: r.cors, error: r.error, count: ids.length, sample: ids.slice(0, 40), free: ids.filter((m) => m.endsWith(':free')).slice(0, 40), body: r.status === 200 ? undefined : cut(r.text) };
  }
  const model = c.model ?? (c.pick ? c.pick(ids) : undefined);
  out.model = model;
  // Browser preflight for a JSON POST.
  const pre = await go(c.chat, { method: 'OPTIONS', headers: { 'access-control-request-method': 'POST', 'access-control-request-headers': c.key ? 'authorization,content-type' : 'content-type' } }, 15000);
  out.preflight = { status: pre.status, cors: pre.cors, error: pre.error };
  if (c.simple) {
    const r = await go(c.chat, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'Reply with the single word: ready' }) });
    out.chat = { status: r.status, ms: r.ms, cors: r.cors, error: r.error, body: cut(r.text) };
    return out;
  }
  if (c.ollama) {
    const r = await go(c.chat, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, prompt: 'Reply with the single word: ready', stream: false }) }, 60000);
    out.chat = { status: r.status, ms: r.ms, cors: r.cors, error: r.error, body: cut(r.text) };
    return out;
  }
  if (!model) {
    out.chat = { skipped: 'no model to try' };
    return out;
  }
  const headers = { 'content-type': 'application/json', ...(c.key ? { authorization: `Bearer ${c.key}` } : {}) };
  const r = await go(c.chat, { method: 'POST', headers, body: JSON.stringify({ model, messages: PROMPT, max_tokens: 30 }) }, c.timeout ?? 45000);
  let reply;
  try { reply = JSON.parse(r.text).choices?.[0]?.message?.content; } catch { /* not JSON */ }
  out.chat = { status: r.status, ms: r.ms, cors: r.cors, error: r.error, reply: reply ? cut(reply, 80) : undefined, body: reply ? undefined : cut(r.text) };
  // Streaming check (the app streams).
  const s = await go(c.chat, { method: 'POST', headers, body: JSON.stringify({ model, messages: PROMPT, max_tokens: 30, stream: true }) }, c.timeout ?? 45000);
  out.stream = { status: s.status, type: s.type, sse: /^data:/m.test(s.text || ''), ms: s.ms, error: s.error, head: s.status === 200 ? undefined : cut(s.text) };
  return out;
}

const only = process.argv.slice(2);
for (const c of CANDIDATES.filter((x) => !only.length || only.includes(x.id))) {
  const r = await probe(c);
  console.log(`\n=== ${c.id} ===\n${JSON.stringify(r, null, 1)}`);
}
