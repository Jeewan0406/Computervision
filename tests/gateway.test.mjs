// Tests for proxy/jeea-gateway.js with the upstream providers mocked. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../proxy/jeea-gateway.js';

const seen = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  seen.push({ url: u, auth: init.headers?.Authorization, body: init.body ? JSON.parse(init.body) : null });
  if (u === 'https://integrate.api.nvidia.com/v1/models') {
    return new Response(JSON.stringify({ data: [{ id: 'meta/llama-3.3-70b-instruct' }, { id: 'nvidia/nv-embedqa-e5-v5' }, { id: 'deepseek-ai/deepseek-r1' }] }));
  }
  if (u === 'https://openrouter.ai/api/v1/models') {
    return new Response(JSON.stringify({ data: [{ id: 'meta-llama/llama-3.3-70b-instruct:free' }, { id: 'openai/gpt-5' }] }));
  }
  if (u.endsWith('/chat/completions')) {
    return new Response('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  }
  return new Response('not found', { status: 404 });
};

const env = { NVIDIA_API_KEY: 'nvapi-secret', OPENROUTER_API_KEY: 'sk-or-secret', ALLOWED_ORIGINS: 'https://jeewan0406.github.io', PER_MINUTE: '3', MAX_TOKENS: '1000' };
const SITE = 'https://jeewan0406.github.io';
const req = (path, init = {}, origin = SITE, ip = '1.1.1.1') =>
  new Request(`https://gw.example.workers.dev${path}`, { ...init, headers: { Origin: origin, 'CF-Connecting-IP': ip, 'Content-Type': 'application/json', ...(init.headers || {}) } });

test('lists chat models from providers that have a key, hides embeddings and paid OpenRouter models', async () => {
  const r = await worker.fetch(req('/v1/models'), env);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), SITE);
  const ids = (await r.json()).data.map((m) => m.id);
  assert.deepEqual(ids, ['nvidia:meta/llama-3.3-70b-instruct', 'nvidia:deepseek-ai/deepseek-r1', 'openrouter:meta-llama/llama-3.3-70b-instruct:free']);
});

test('forwards chat with the secret key, strips the route, caps tokens, streams back without the key', async () => {
  seen.length = 0;
  const r = await worker.fetch(req('/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'nvidia:meta/llama-3.3-70b-instruct', messages: [{ role: 'user', content: 'hi' }], stream: true, max_tokens: 99999 }) }), env);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('Content-Type'), 'text/event-stream');
  const text = await r.text();
  assert.match(text, /"Hi"/);
  assert.ok(!text.includes('nvapi-secret'));
  const call = seen.find((c) => c.url.endsWith('/chat/completions'));
  assert.equal(call.url, 'https://integrate.api.nvidia.com/v1/chat/completions');
  assert.equal(call.auth, 'Bearer nvapi-secret');
  assert.equal(call.body.model, 'meta/llama-3.3-70b-instruct');
  assert.equal(call.body.max_tokens, 1000);
});

test('refuses other websites, unknown models, missing keys and paid OpenRouter models', async () => {
  assert.equal((await worker.fetch(req('/v1/models', {}, 'https://evil.example'), env)).status, 403);
  const post = (model, ip) => worker.fetch(req('/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model, messages: [] }) }, SITE, ip), env);
  assert.equal((await post('nope', '2.2.2.2')).status, 400);
  assert.equal((await post('groq:llama-3.3-70b-versatile', '2.2.2.3')).status, 400);
  assert.equal((await post('openrouter:openai/gpt-5', '2.2.2.4')).status, 403);
});

test('limits each visitor per minute', async () => {
  const post = () => worker.fetch(req('/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'nvidia:meta/llama-3.3-70b-instruct', messages: [] }) }, SITE, '9.9.9.9'), env);
  for (let i = 0; i < 3; i++) assert.equal((await post()).status, 200);
  const blocked = await post();
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('Retry-After'), '60');
});

test('answers CORS preflight', async () => {
  const r = await worker.fetch(req('/v1/chat/completions', { method: 'OPTIONS' }), env);
  assert.equal(r.status, 204);
  assert.match(r.headers.get('Access-Control-Allow-Headers'), /Content-Type/);
});

// ---- Cloudflare Workers AI binding (no extra key) ----
const fakeAI = {
  calls: [],
  async run(model, params) {
    this.calls.push({ model, params });
    if (!params.stream) return { response: 'Namaste', usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } };
    const text = 'data: {"response":"Kuzu"}\n\ndata: {"response":"zangpo"}\n\ndata: {"response":"","usage":{"prompt_tokens":5,"completion_tokens":2}}\n\ndata: [DONE]\n\n';
    return new Blob([text]).stream();
  },
};
const envAI = { AI: fakeAI, ALLOWED_ORIGINS: 'https://jeewan0406.github.io', PER_MINUTE: '50' };

test('Workers AI models are listed when the AI binding exists', async () => {
  const ids = (await (await worker.fetch(req('/v1/models'), envAI)).json()).data.map((m) => m.id);
  assert.ok(ids.includes('cloudflare:@cf/meta/llama-3.3-70b-instruct-fp8-fast'));
  assert.equal(ids.filter((i) => i.startsWith('cloudflare:')).length, 7);
});

test('Workers AI stream is translated to OpenAI-style chunks', async () => {
  const r = await worker.fetch(req('/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'cloudflare:@cf/meta/llama-3.3-70b-instruct-fp8-fast', messages: [{ role: 'user', content: 'hi' }], stream: true }) }, SITE, '7.7.7.7'), envAI);
  assert.equal(r.status, 200);
  const text = await r.text();
  const deltas = text.split('\n').filter((l) => l.startsWith('data: {')).map((l) => JSON.parse(l.slice(6)));
  assert.equal(deltas.filter((d) => d.choices?.[0]?.delta?.content).map((d) => d.choices[0].delta.content).join(''), 'Kuzuzangpo');
  assert.ok(deltas.some((d) => d.usage?.completion_tokens === 2));
  assert.match(text, /data: \[DONE\]/);
  assert.equal(fakeAI.calls.at(-1).params.max_tokens, 4096);
});

test('Workers AI non-streaming reply and missing binding', async () => {
  const r = await worker.fetch(req('/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'cloudflare:@cf/qwen/qwq-32b', messages: [] }) }, SITE, '7.7.7.8'), envAI);
  const j = await r.json();
  assert.equal(j.choices[0].message.content, 'Namaste');
  const noAI = await worker.fetch(req('/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'cloudflare:@cf/qwen/qwq-32b', messages: [] }) }, SITE, '7.7.7.9'), { ALLOWED_ORIGINS: SITE });
  assert.equal(noAI.status, 400);
  assert.match((await noAI.json()).error.message, /Workers AI binding/);
});
