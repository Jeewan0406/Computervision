/**
 * JeeA Gateway — free models for every visitor, without exposing your keys.
 *
 * Your API keys live here as Cloudflare *secrets*. Visitors of your JeeA!
 * site call this gateway; it adds your key on the server side and forwards
 * the request. Keys never reach the browser or your public repository.
 *
 * Set up (Cloudflare dashboard, free plan, no command line needed):
 *  1. Workers & Pages -> Create application -> pick the "Hello World" Worker
 *     template -> name it "jeea-gateway" -> Deploy.
 *  2. Open the Worker -> Edit code -> replace everything with this file -> Deploy.
 *  3. Settings -> Variables and Secrets -> Add (then Deploy):
 *       NVIDIA_API_KEY   (type: Secret)   your key from build.nvidia.com
 *       ALLOWED_ORIGINS  (type: Text)     https://<your-user>.github.io
 *     Optional secrets: GROQ_API_KEY, GEMINI_API_KEY, CEREBRAS_API_KEY,
 *     MISTRAL_API_KEY, OPENROUTER_API_KEY (only ":free" models are offered).
 *     Optional text: PER_MINUTE (requests per visitor per minute, default 12),
 *     MAX_TOKENS (cap per answer, default 4096).
 *  4. Copy the worker URL (https://jeea-gateway.<name>.workers.dev) into
 *     public/jeea.config.json -> "gateway" in your repository.
 *
 * Endpoints (OpenAI-compatible):
 *   GET  /v1/models            -> models from every provider that has a key
 *   POST /v1/chat/completions  -> model id "provider:model", e.g.
 *                                 "nvidia:meta/llama-3.3-70b-instruct"
 */

const UPSTREAMS = {
  nvidia: { base: 'https://integrate.api.nvidia.com/v1', secret: 'NVIDIA_API_KEY' },
  groq: { base: 'https://api.groq.com/openai/v1', secret: 'GROQ_API_KEY' },
  gemini: { base: 'https://generativelanguage.googleapis.com/v1beta/openai', secret: 'GEMINI_API_KEY' },
  cerebras: { base: 'https://api.cerebras.ai/v1', secret: 'CEREBRAS_API_KEY' },
  mistral: { base: 'https://api.mistral.ai/v1', secret: 'MISTRAL_API_KEY' },
  openrouter: { base: 'https://openrouter.ai/api/v1', secret: 'OPENROUTER_API_KEY', freeOnly: true },
};

const NOT_CHAT = /embed|rerank|whisper|tts|transcri|dall-e|image|vision-only|moderation|guard|reward|parse|ocr|clip|nv-embed|bge|e5-|retriever/i;

// Best-effort per-visitor limit (per Worker instance; Cloudflare may run several).
const hits = new Map();
function allowed(ip, perMinute) {
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || now - rec.start > 60_000) {
    hits.set(ip, { start: now, n: 1 });
    if (hits.size > 5000) hits.clear();
    return true;
  }
  rec.n += 1;
  return rec.n <= perMinute;
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const json = (data, status, cors) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...cors } });

async function listUpstream(name, up, key) {
  const url = `${up.base}/models`;
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const cacheKey = new Request(`https://jeea-gateway.cache/${name}/models`);
  let data;
  const hit = cache && (await cache.match(cacheKey));
  if (hit) data = await hit.json();
  else {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
    if (!r.ok) return [];
    data = await r.json();
    if (cache) await cache.put(cacheKey, new Response(JSON.stringify(data), { headers: { 'Cache-Control': 'max-age=3600' } }));
  }
  const arr = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
  return arr
    .map((m) => (typeof m === 'string' ? m : m?.id ?? m?.name))
    .filter((id) => typeof id === 'string' && id && !NOT_CHAT.test(id))
    .map((id) => id.replace(/^models\//, ''))
    .filter((id) => !up.freeOnly || id.endsWith(':free'));
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowList = String(env.ALLOWED_ORIGINS || '')
      .split(',')
      .map((s) => s.trim().replace(/\/+$/, ''))
      .filter(Boolean);
    if (allowList.length && origin && !allowList.includes(origin)) {
      return json({ error: { message: 'This gateway only serves its own JeeA! site.' } }, 403, {});
    }
    const cors = corsHeaders(allowList.length ? origin : '*');
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');

    if (request.method === 'GET' && (path === '' || path === '/' || path === '/v1')) {
      const ready = Object.keys(UPSTREAMS).filter((n) => env[UPSTREAMS[n].secret]);
      return json({ name: 'JeeA Gateway', providers: ready, endpoints: ['/v1/models', '/v1/chat/completions'] }, 200, cors);
    }

    if (request.method === 'GET' && path === '/v1/models') {
      const out = [];
      for (const [name, up] of Object.entries(UPSTREAMS)) {
        const key = env[up.secret];
        if (!key) continue;
        try {
          for (const id of await listUpstream(name, up, key)) out.push({ id: `${name}:${id}`, object: 'model', owned_by: name });
        } catch {
          /* one provider down should not hide the others */
        }
      }
      return json({ object: 'list', data: out }, 200, cors);
    }

    if (request.method === 'POST' && path === '/v1/chat/completions') {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const perMinute = Number(env.PER_MINUTE || 12);
      if (!allowed(ip, perMinute)) {
        return new Response(JSON.stringify({ error: { message: `Free limit reached: ${perMinute} requests per minute. Please wait a minute.` } }), {
          status: 429,
          headers: { 'Content-Type': 'application/json', 'Retry-After': '60', ...cors },
        });
      }
      const text = await request.text();
      if (text.length > 400_000) return json({ error: { message: 'Request too large.' } }, 413, cors);
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        return json({ error: { message: 'Body must be JSON.' } }, 400, cors);
      }
      const full = String(body.model || '');
      const i = full.indexOf(':');
      const name = i > 0 ? full.slice(0, i) : '';
      const model = i > 0 ? full.slice(i + 1) : '';
      const up = UPSTREAMS[name];
      if (!up || !model) return json({ error: { message: `Unknown model "${full}". Use "provider:model" from /v1/models.` } }, 400, cors);
      const key = env[up.secret];
      if (!key) return json({ error: { message: `This gateway has no key for ${name}.` } }, 400, cors);
      if (up.freeOnly && !model.endsWith(':free')) return json({ error: { message: 'Only free (":free") models are offered for this provider.' } }, 403, cors);

      const cap = Number(env.MAX_TOKENS || 4096);
      const fwd = { ...body, model };
      for (const f of ['max_tokens', 'max_completion_tokens']) if (typeof fwd[f] === 'number') fwd[f] = Math.min(fwd[f], cap);
      if (fwd.max_tokens === undefined && fwd.max_completion_tokens === undefined) fwd.max_tokens = cap;
      if (name === 'gemini') delete fwd.stream_options;

      const upstream = await fetch(`${up.base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify(fwd),
      });
      const headers = new Headers(cors);
      headers.set('Content-Type', upstream.headers.get('Content-Type') || 'application/json');
      const ra = upstream.headers.get('Retry-After');
      if (ra) headers.set('Retry-After', ra);
      return new Response(upstream.body, { status: upstream.status, headers }); // streams Server-Sent Events through
    }

    return json({ error: { message: 'Not found. Use /v1/models or /v1/chat/completions.' } }, 404, cors);
  },
};
