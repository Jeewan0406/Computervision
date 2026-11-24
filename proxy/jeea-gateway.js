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
 *     MISTRAL_API_KEY, OPENROUTER_API_KEY (only ":free" models are offered),
 *     SAMBANOVA_API_KEY, HF_TOKEN, COHERE_API_KEY, OLLAMA_API_KEY,
 *     ZAI_API_KEY, SILICONFLOW_API_KEY, OVH_AI_KEY.
 *  3b. Free models with NO extra key: in the Worker's Settings, add a Workers AI
 *     binding named "AI" (Wrangler config: "ai": { "binding": "AI" }). This adds Cloudflare Workers AI models (Llama 3.3
 *     70B, Llama 4 Scout, Mistral Small 3.1, QwQ 32B, DeepSeek R1 Distill,
 *     Qwen 2.5 Coder, GPT-OSS 120B) on Cloudflare's free daily allowance.
 *     Optional text: PER_MINUTE (requests per visitor per minute, default 12),
 *     MAX_TOKENS (cap per answer, default 4096).
 *  3c. Optional full web search for JeeA!'s automatic "Web: Auto" mode:
 *     add the secret TAVILY_API_KEY (from tavily.com). Without it the app
 *     still searches Wikipedia on its own. Optional text: SEARCH_PER_MINUTE
 *     (searches per visitor per minute, default 6). Results are cached for
 *     10 minutes to save your search credits. Only trusted sites are searched
 *     (TRUSTED_DOMAINS below: intergovernmental bodies, governments,
 *     universities, journals, established news organisations).
 *  3d. With the Workers AI binding, visitors can also make images (FLUX.1
 *     [schnell]); optional text IMAGE_PER_MINUTE (default 3).
 *  4. Copy the worker URL (https://jeea-gateway.<name>.workers.dev) into
 *     public/jeea.config.json -> "gateway" in your repository.
 *
 * Endpoints (OpenAI-compatible):
 *   GET  /v1/models            -> models from every provider that has a key
 *   POST /v1/chat/completions  -> model id "provider:model", e.g.
 *                                 "nvidia:meta/llama-3.3-70b-instruct"
 *   POST /v1/search            -> {query, max_results?, topic?: "general"|"news"}
 *                                 -> {results: [{title, url, content, published_date}]}
 *                                 trusted sites only (501 when TAVILY_API_KEY is not set)
 *   POST /v1/images/generations -> {prompt, steps?} -> {data: [{b64_json}]}
 *                                 FLUX.1 [schnell] on Workers AI (501 without the AI binding)
 */

const UPSTREAMS = {
  nvidia: { base: 'https://integrate.api.nvidia.com/v1', secret: 'NVIDIA_API_KEY' },
  groq: { base: 'https://api.groq.com/openai/v1', secret: 'GROQ_API_KEY' },
  gemini: { base: 'https://generativelanguage.googleapis.com/v1beta/openai', secret: 'GEMINI_API_KEY' },
  cerebras: { base: 'https://api.cerebras.ai/v1', secret: 'CEREBRAS_API_KEY' },
  mistral: { base: 'https://api.mistral.ai/v1', secret: 'MISTRAL_API_KEY' },
  openrouter: { base: 'https://openrouter.ai/api/v1', secret: 'OPENROUTER_API_KEY', freeOnly: true },
  sambanova: { base: 'https://api.sambanova.ai/v1', secret: 'SAMBANOVA_API_KEY' },
  huggingface: { base: 'https://router.huggingface.co/v1', secret: 'HF_TOKEN' },
  cohere: { base: 'https://api.cohere.ai/compatibility/v1', secret: 'COHERE_API_KEY' },
  ollama: { base: 'https://ollama.com/v1', secret: 'OLLAMA_API_KEY' },
  zai: { base: 'https://api.z.ai/api/paas/v4', secret: 'ZAI_API_KEY' },
  siliconflow: { base: 'https://api.siliconflow.com/v1', secret: 'SILICONFLOW_API_KEY' },
  ovh: { base: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1', secret: 'OVH_AI_KEY' },
  // Kilo AI Gateway: its ":free" models answer without any key (checked 2026-11-24),
  // but browsers cannot call it directly (no CORS), so the gateway passes them on.
  // On by default; set KILO_FREE to "off" to hide them. KILO_API_KEY is optional.
  kilo: { base: 'https://api.kilo.ai/api/gateway', secret: 'KILO_API_KEY', keyless: true, freeOnly: true },
};

/** The key for an upstream: its secret, '' for a keyless upstream that is switched on, else undefined. */
function keyFor(env, up) {
  if (env[up.secret]) return env[up.secret];
  if (up.keyless && String(env.KILO_FREE || '').toLowerCase() !== 'off') return '';
  return undefined;
}
const authHeader = (key) => (key ? { Authorization: `Bearer ${key}` } : {});

// Cloudflare Workers AI chat models (ids from Cloudflare's model catalog).
const CF_MODELS = [
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  '@cf/meta/llama-4-scout-17b-16e-instruct',
  '@cf/mistralai/mistral-small-3.1-24b-instruct',
  '@cf/qwen/qwq-32b',
  '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',
  '@cf/qwen/qwen2.5-coder-32b-instruct',
  '@cf/openai/gpt-oss-120b',
];

/** Workers AI streams {"response": "..."} events; JeeA! reads OpenAI-style chunks. */
function toOpenAIStream(stream) {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  let buf = '';
  const emit = (ctrl, obj) => ctrl.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
  const line = (ctrl, l) => {
    if (!l.startsWith('data:')) return;
    const data = l.slice(5).trim();
    if (!data) return;
    if (data === '[DONE]') return ctrl.enqueue(enc.encode('data: [DONE]\n\n'));
    let j;
    try {
      j = JSON.parse(data);
    } catch {
      return;
    }
    if (Array.isArray(j.choices)) return emit(ctrl, j);
    if (typeof j.response === 'string' && j.response) emit(ctrl, { choices: [{ index: 0, delta: { content: j.response } }] });
    if (j.usage) emit(ctrl, { choices: [], usage: j.usage });
  };
  return stream.pipeThrough(
    new TransformStream({
      transform(chunk, ctrl) {
        buf += dec.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          line(ctrl, buf.slice(0, i).replace(/\r$/, ''));
          buf = buf.slice(i + 1);
        }
      },
      flush(ctrl) {
        if (buf) line(ctrl, buf);
      },
    }),
  );
}

async function workersAI(env, model, body, cap, cors) {
  if (!env.AI) return json({ error: { message: 'Add a Workers AI binding named "AI" to this Worker to use Cloudflare models.' } }, 400, cors);
  if (!CF_MODELS.includes(model)) return json({ error: { message: `Unknown Cloudflare model "${model}".` } }, 400, cors);
  const params = { messages: body.messages, stream: !!body.stream, max_tokens: Math.min(Number(body.max_tokens || body.max_completion_tokens || cap), cap) };
  if (typeof body.temperature === 'number') params.temperature = body.temperature;
  const out = await env.AI.run(model, params);
  if (body.stream && out && typeof out.pipeThrough === 'function') {
    return new Response(toOpenAIStream(out), { headers: { 'Content-Type': 'text/event-stream', ...cors } });
  }
  const text = typeof out?.response === 'string' ? out.response : String(out?.response ?? '');
  return json({ object: 'chat.completion', model: `cloudflare:${model}`, choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: out?.usage }, 200, cors);
}

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
    const r = await fetch(url, { headers: authHeader(key) });
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

/** Sites JeeA! treats as trusted: intergovernmental bodies, governments,
 * universities, journals and publishers, and established news organisations.
 * Edit to suit your site. */
const TRUSTED_DOMAINS = [
  'un.org', 'who.int', 'worldbank.org', 'imf.org', 'oecd.org', 'unicef.org', 'unhcr.org', 'unep.org', 'wmo.int', 'fao.org', 'wfp.org', 'iaea.org',
  'reliefweb.int', 'adb.org', 'europa.eu', 'esa.int', 'nasa.gov', 'noaa.gov', 'cdc.gov', 'nih.gov', 'gov.uk', 'gov.bt',
  'nature.com', 'science.org', 'thelancet.com', 'nejm.org', 'bmj.com', 'pnas.org', 'cell.com', 'plos.org', 'springer.com', 'sciencedirect.com',
  'wiley.com', 'tandfonline.com', 'sagepub.com', 'oup.com', 'cambridge.org', 'ieee.org', 'acm.org', 'arxiv.org', 'doi.org',
  'bbc.co.uk', 'bbc.com', 'npr.org', 'dw.com', 'aljazeera.com', 'france24.com', 'theguardian.com', 'cbc.ca', 'apnews.com', 'reuters.com', 'bbs.bt', 'kuenselonline.com',
  // Standards bodies and leading manufacturers (their own products, specifications and data).
  'iso.org', 'iec.ch', 'siemens.com', 'siemens-energy.com', 'abb.com', 'se.com', 'gevernova.com', 'hitachienergy.com', 'sma.de', 'huawei.com', 'bosch.com',
  'tesla.com', 'toyota-global.com', 'global.toyota', 'samsung.com', 'apple.com', 'microsoft.com', 'blog.google', 'nvidia.com', 'intel.com', 'amd.com', 'ibm.com', 'cisco.com', 'openai.com', 'anthropic.com',
];
/** Government, university and intergovernmental addresses are trusted too. */
const TRUSTED_SUFFIX = /(\.gov|\.gov\.[a-z]{2}|\.edu|\.edu\.[a-z]{2}|\.ac\.[a-z]{2}|\.int|\.mil)$/i;
export function trustedUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return TRUSTED_SUFFIX.test(host) || TRUSTED_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

/** Web search through Tavily with the owner's key, limited to trusted sites, cached for 10 minutes. */
async function webSearch(env, body, cors) {
  const query = String(body?.query ?? '').trim().slice(0, 400);
  if (!query) return json({ error: { message: 'Missing "query".' } }, 400, cors);
  const max = Math.max(1, Math.min(8, Number(body?.max_results) || 5));
  const topic = body?.topic === 'news' ? 'news' : 'general';
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const cacheKey = new Request(`https://jeea-gateway.cache/search?t=${topic}&n=${max}&q=${encodeURIComponent(query.toLowerCase())}`);
  const hit = cache && (await cache.match(cacheKey));
  if (hit) return json(await hit.json(), 200, cors);
  const r = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.TAVILY_API_KEY}` },
    body: JSON.stringify({ query, max_results: max, topic, search_depth: 'basic', include_answer: false, include_domains: TRUSTED_DOMAINS }),
  });
  if (!r.ok) return json({ error: { message: `Search provider error (HTTP ${r.status}).` } }, r.status === 429 ? 429 : 502, cors);
  const data = await r.json();
  const results = (Array.isArray(data?.results) ? data.results : [])
    .filter((x) => x && typeof x.url === 'string' && typeof x.content === 'string' && trustedUrl(x.url))
    .map((x) => ({ title: String(x.title || ''), url: x.url, content: x.content.slice(0, 1500), published_date: x.published_date || undefined }));
  const out = { results };
  if (cache) await cache.put(cacheKey, new Response(JSON.stringify(out), { headers: { 'Cache-Control': 'max-age=600' } }));
  return json(out, 200, cors);
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
      const ready = Object.keys(UPSTREAMS).filter((n) => keyFor(env, UPSTREAMS[n]) !== undefined);
      if (env.AI) ready.unshift('cloudflare');
      return json({ name: 'JeeA Gateway', providers: ready, search: !!env.TAVILY_API_KEY, images: !!env.AI, endpoints: ['/v1/models', '/v1/chat/completions', '/v1/search', '/v1/images/generations'] }, 200, cors);
    }

    if (request.method === 'GET' && path === '/v1/models') {
      const out = [];
      if (env.AI) for (const id of CF_MODELS) out.push({ id: `cloudflare:${id}`, object: 'model', owned_by: 'cloudflare' });
      for (const [name, up] of Object.entries(UPSTREAMS)) {
        const key = keyFor(env, up);
        if (key === undefined) continue;
        try {
          for (const id of await listUpstream(name, up, key)) out.push({ id: `${name}:${id}`, object: 'model', owned_by: name });
        } catch {
          /* one provider down should not hide the others */
        }
      }
      return json({ object: 'list', data: out }, 200, cors);
    }

    if (request.method === 'POST' && path === '/v1/images/generations') {
      if (!env.AI) return json({ error: { message: 'This gateway has no Workers AI binding named "AI", so it cannot make images.' } }, 501, cors);
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const perMinute = Number(env.IMAGE_PER_MINUTE || 3);
      if (!allowed(`image:${ip}`, perMinute)) {
        return new Response(JSON.stringify({ error: { message: `Image limit reached: ${perMinute} per minute.` } }), {
          status: 429,
          headers: { 'Content-Type': 'application/json', 'Retry-After': '60', ...cors },
        });
      }
      let body;
      try {
        body = JSON.parse(await request.text());
      } catch {
        return json({ error: { message: 'Body must be JSON.' } }, 400, cors);
      }
      const prompt = String(body?.prompt ?? '').trim().slice(0, 2048);
      if (!prompt) return json({ error: { message: 'Missing "prompt".' } }, 400, cors);
      const steps = Math.max(1, Math.min(8, Number(body?.steps) || 4));
      const out = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', { prompt, steps });
      if (!out?.image) return json({ error: { message: 'Workers AI returned no image.' } }, 502, cors);
      return json({ created: Math.floor(Date.now() / 1000), data: [{ b64_json: out.image }] }, 200, cors);
    }

    if (request.method === 'POST' && path === '/v1/search') {
      if (!env.TAVILY_API_KEY) return json({ error: { message: 'This gateway has no search key (TAVILY_API_KEY).' } }, 501, cors);
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const perMinute = Number(env.SEARCH_PER_MINUTE || 6);
      if (!allowed(`search:${ip}`, perMinute)) {
        return new Response(JSON.stringify({ error: { message: `Search limit reached: ${perMinute} per minute.` } }), {
          status: 429,
          headers: { 'Content-Type': 'application/json', 'Retry-After': '60', ...cors },
        });
      }
      const text = await request.text();
      if (text.length > 4000) return json({ error: { message: 'Request too large.' } }, 413, cors);
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        return json({ error: { message: 'Body must be JSON.' } }, 400, cors);
      }
      return webSearch(env, body, cors);
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
      const cap = Number(env.MAX_TOKENS || 4096);
      if (name === 'cloudflare') return workersAI(env, model, body, cap, cors);
      const up = UPSTREAMS[name];
      if (!up || !model) return json({ error: { message: `Unknown model "${full}". Use "provider:model" from /v1/models.` } }, 400, cors);
      const key = keyFor(env, up);
      if (key === undefined) return json({ error: { message: `This gateway has no key for ${name}.` } }, 400, cors);
      if (up.freeOnly && !model.endsWith(':free')) return json({ error: { message: 'Only free (":free") models are offered for this provider.' } }, 403, cors);

      const fwd = { ...body, model };
      for (const f of ['max_tokens', 'max_completion_tokens']) if (typeof fwd[f] === 'number') fwd[f] = Math.min(fwd[f], cap);
      if (fwd.max_tokens === undefined && fwd.max_completion_tokens === undefined) fwd.max_tokens = cap;
      if (name === 'gemini') delete fwd.stream_options;

      const upstream = await fetch(`${up.base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(key) },
        body: JSON.stringify(fwd),
      });
      const headers = new Headers(cors);
      headers.set('Content-Type', upstream.headers.get('Content-Type') || 'application/json');
      const ra = upstream.headers.get('Retry-After');
      if (ra) headers.set('Retry-After', ra);
      return new Response(upstream.body, { status: upstream.status, headers }); // streams Server-Sent Events through
    }

    return json({ error: { message: 'Not found. Use /v1/models, /v1/chat/completions, /v1/search or /v1/images/generations.' } }, 404, cors);
  },
};
