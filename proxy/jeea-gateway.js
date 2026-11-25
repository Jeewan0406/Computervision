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
 *  3e. Optional accounts (people register to use this gateway; you, the
 *     owner, have no limits and an admin panel inside the app):
 *       - Storage & Databases -> D1 -> Create database (any name), then in
 *         the Worker's Settings -> Bindings add a D1 database binding named
 *         "DB". The tables are created by the Worker on first use.
 *       - Add the secret AUTH_SECRET: a long random text (signs sign-ins).
 *       - Add the secret OWNER_KEY: your own long passphrase. Enter it in the
 *         app (Account -> Owner) to sign in as the owner.
 *     Optional text: SIGNUP_MODE ("open", "approval" or "closed"; default
 *     open), REQUIRE_ACCOUNT ("on" = only signed-in people may use this
 *     gateway), DAILY_LIMIT (requests per user per day, default 100). The
 *     owner can change all three later in the app without redeploying.
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
 *   Accounts (with the DB binding and AUTH_SECRET):
 *   GET  /v1/auth/config       -> {accounts, signup, requireAccount, dailyLimit, owner}
 *   POST /v1/auth/register     -> {name, email, password} -> {token, user} or {pending}
 *   POST /v1/auth/login        -> {email, password} -> {token, user}
 *   POST /v1/auth/owner        -> {key} -> {token, user} (the owner: no limits)
 *   GET  /v1/auth/me           -> {user, usage}
 *   GET  /v1/admin/users       -> owner only: {users, settings}
 *   POST /v1/admin/users/:id   -> owner only: {action: approve|block|unblock|delete|limit|password}
 *   POST /v1/admin/settings    -> owner only: {signup?, requireAccount?, dailyLimit?}
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

// ------------------------------------------------------------------ accounts
// Optional sign-up and sign-in, so the public can register and the owner
// decides who may use this gateway (the owner's keys and free allowances).
// On when the Worker has a D1 binding named DB and the secret AUTH_SECRET.
// Passwords are stored only as salted PBKDF2-SHA-256 hashes; sign-ins are
// HMAC-signed tokens that expire after 30 days.

const enc = new TextEncoder();
const TOKEN_DAYS = 30;
const SIGNUP_MODES = ['open', 'approval', 'closed'];
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const sha = async (text) => b64u(await crypto.subtle.digest('SHA-256', enc.encode(text)));

/** Compare two texts in constant time (no early exit that leaks how much matched). */
function sameText(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  // 100,000 rounds: the most Cloudflare Workers allow for PBKDF2.
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromB64u(salt), iterations: 100_000 }, key, 256);
  return b64u(bits);
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

async function makeToken(env, payload) {
  const body = b64u(enc.encode(JSON.stringify({ ...payload, exp: Date.now() + TOKEN_DAYS * 86_400_000 })));
  return `jeea1.${body}.${await hmac(env.AUTH_SECRET, body)}`;
}

async function readToken(env, token) {
  const [tag, body, sig] = String(token).split('.');
  if (tag !== 'jeea1' || !body || !sig) return null;
  if (!sameText(sig, await hmac(env.AUTH_SECRET, body))) return null;
  let p;
  try {
    p = JSON.parse(new TextDecoder().decode(fromB64u(body)));
  } catch {
    return null;
  }
  return p && typeof p.exp === 'number' && p.exp > Date.now() ? p : null;
}

const accountsOn = (env) => !!(env.DB && env.AUTH_SECRET);
const ownerTag = async (env) => (await sha(`owner:${env.OWNER_KEY}`)).slice(0, 16);

const schemaDone = new WeakSet();
async function db(env) {
  if (!schemaDone.has(env.DB)) {
    await env.DB.batch([
      env.DB.prepare('CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, pass TEXT NOT NULL, salt TEXT NOT NULL, status TEXT NOT NULL, daily_limit INTEGER, token_version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, last_seen INTEGER)'),
      env.DB.prepare('CREATE TABLE IF NOT EXISTS usage (user_id TEXT NOT NULL, day TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, day))'),
      env.DB.prepare('CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT NOT NULL)'),
    ]);
    schemaDone.add(env.DB);
  }
  return env.DB;
}

async function getSettings(env) {
  const s = {
    signup: SIGNUP_MODES.includes(env.SIGNUP_MODE) ? env.SIGNUP_MODE : 'open',
    requireAccount: String(env.REQUIRE_ACCOUNT || '').toLowerCase() === 'on',
    dailyLimit: Number(env.DAILY_LIMIT) > 0 ? Math.floor(Number(env.DAILY_LIMIT)) : 100,
  };
  const rows = (await (await db(env)).prepare('SELECT k, v FROM settings').all()).results ?? [];
  for (const r of rows) {
    if (r.k === 'signup' && SIGNUP_MODES.includes(r.v)) s.signup = r.v;
    if (r.k === 'requireAccount') s.requireAccount = r.v === 'on';
    if (r.k === 'dailyLimit' && Number(r.v) > 0) s.dailyLimit = Math.floor(Number(r.v));
  }
  return s;
}

const today = () => new Date().toISOString().slice(0, 10);
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, status: u.status, role: 'user', dailyLimit: u.daily_limit ?? null, createdAt: u.created_at, lastSeen: u.last_seen ?? null });
const OWNER_USER = { id: 'owner', name: 'Owner', email: '', status: 'active', role: 'owner', dailyLimit: null };

/** Who is calling: the owner, a signed-in user, nobody, or a bad/expired sign-in. */
async function identify(request, env) {
  const m = /^Bearer\s+(jeea1\.\S+)$/.exec(request.headers.get('Authorization') || '');
  if (!m || !accountsOn(env)) return { kind: 'anon' };
  const p = await readToken(env, m[1]);
  if (!p) return { kind: 'invalid', status: 401, reason: 'Your sign-in has expired. Please sign in again.' };
  if (p.role === 'owner') {
    if (!env.OWNER_KEY || p.k !== (await ownerTag(env))) return { kind: 'invalid', status: 401, reason: 'The owner sign-in is no longer valid. Sign in again with the owner key.' };
    return { kind: 'owner' };
  }
  const user = await (await db(env)).prepare('SELECT * FROM users WHERE id = ?').bind(p.sub).first();
  if (!user) return { kind: 'invalid', status: 401, reason: 'This account no longer exists. Please register again.' };
  if (user.status === 'blocked') return { kind: 'invalid', status: 403, reason: 'This account has been blocked by the site owner.' };
  if (user.status === 'pending') return { kind: 'invalid', status: 403, reason: "Your account is waiting for the site owner's approval." };
  if (user.token_version !== p.v) return { kind: 'invalid', status: 401, reason: 'Please sign in again.' };
  return { kind: 'user', user };
}

/**
 * Checks before a model, search or image request. Returns {res} to send back
 * at once, or {key} for the per-minute limit (null = the owner: no limits).
 * Chat and image requests of signed-in users count against their daily limit.
 */
async function guard(request, env, cors, kind) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!accountsOn(env)) return { key: ip };
  const who = await identify(request, env);
  if (who.kind === 'invalid') return { res: json({ error: { message: who.reason, code: 'auth' } }, who.status, cors) };
  if (who.kind === 'owner') return { key: null };
  const s = await getSettings(env);
  if (who.kind === 'anon') {
    if (s.requireAccount) {
      return { res: json({ error: { message: 'Please sign in to use the free models shared by this site: open Account, then Register or Sign in.', code: 'account_required' } }, 401, cors) };
    }
    return { key: ip };
  }
  if (kind !== 'search') {
    const limit = who.user.daily_limit ?? s.dailyLimit;
    const d = await db(env);
    const day = today();
    const row = await d.prepare('SELECT n FROM usage WHERE user_id = ? AND day = ?').bind(who.user.id, day).first();
    if ((row?.n ?? 0) >= limit) {
      return { res: json({ error: { message: `Your daily limit of ${limit} requests on this site's free models is used up. It resets at midnight UTC.`, code: 'daily_limit' } }, 429, cors) };
    }
    await d.batch([
      d.prepare('INSERT INTO usage (user_id, day, n) VALUES (?, ?, 1) ON CONFLICT(user_id, day) DO UPDATE SET n = n + 1').bind(who.user.id, day),
      d.prepare('UPDATE users SET last_seen = ? WHERE id = ?').bind(Date.now(), who.user.id),
    ]);
  }
  return { key: `u:${who.user.id}` };
}

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const tooMany = (cors, what) => new Response(JSON.stringify({ error: { message: `Too many ${what} attempts. Please wait a minute.` } }), { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '60', ...cors } });

async function readJson(request) {
  const text = await request.text();
  if (text.length > 10_000) return null;
  try {
    const body = JSON.parse(text);
    return body && typeof body === 'object' ? body : null;
  } catch {
    return null;
  }
}

async function accountRoutes(request, env, cors, path) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (request.method === 'GET' && path === '/v1/auth/config') {
    if (!accountsOn(env)) return json({ accounts: false }, 200, cors);
    const s = await getSettings(env);
    return json({ accounts: true, ...s, owner: !!env.OWNER_KEY }, 200, cors);
  }
  if (!accountsOn(env)) return json({ error: { message: 'Accounts are not set up on this gateway (it needs a D1 binding named DB and the secret AUTH_SECRET).' } }, 501, cors);

  if (request.method === 'POST' && path === '/v1/auth/register') {
    if (!allowed(`register:${ip}`, 3)) return tooMany(cors, 'sign-up');
    const s = await getSettings(env);
    if (s.signup === 'closed') return json({ error: { message: 'Registration is closed by the site owner.' } }, 403, cors);
    const body = await readJson(request);
    const name = String(body?.name ?? '').trim().slice(0, 60);
    const email = String(body?.email ?? '').trim().toLowerCase();
    const password = String(body?.password ?? '');
    if (!name) return json({ error: { message: 'Please enter your name.' } }, 400, cors);
    if (!EMAIL.test(email)) return json({ error: { message: 'Please enter a valid email address.' } }, 400, cors);
    if (password.length < 8 || password.length > 200) return json({ error: { message: 'The password needs at least 8 characters.' } }, 400, cors);
    const d = await db(env);
    if (await d.prepare('SELECT id FROM users WHERE email = ?').bind(email).first()) {
      return json({ error: { message: 'An account with this email already exists. Please sign in.' } }, 409, cors);
    }
    const salt = b64u(crypto.getRandomValues(new Uint8Array(16)));
    const user = { id: crypto.randomUUID(), email, name, pass: await hashPassword(password, salt), salt, status: s.signup === 'open' ? 'active' : 'pending', created_at: Date.now() };
    await d.prepare('INSERT INTO users (id, email, name, pass, salt, status, token_version, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)').bind(user.id, user.email, user.name, user.pass, user.salt, user.status, user.created_at).run();
    if (user.status === 'pending') return json({ pending: true, message: "Thank you! The site owner will review your request. You can sign in once it is approved." }, 202, cors);
    const token = await makeToken(env, { sub: user.id, role: 'user', v: 1 });
    return json({ token, user: publicUser(user) }, 201, cors);
  }

  if (request.method === 'POST' && path === '/v1/auth/login') {
    if (!allowed(`login:${ip}`, 10)) return tooMany(cors, 'sign-in');
    const body = await readJson(request);
    const email = String(body?.email ?? '').trim().toLowerCase();
    const password = String(body?.password ?? '');
    const user = email ? await (await db(env)).prepare('SELECT * FROM users WHERE email = ?').bind(email).first() : null;
    const ok = user && sameText(await hashPassword(password, user.salt), user.pass);
    if (!ok) return json({ error: { message: 'Wrong email or password.' } }, 401, cors);
    if (user.status === 'pending') return json({ error: { message: "Your account is waiting for the site owner's approval." } }, 403, cors);
    if (user.status === 'blocked') return json({ error: { message: 'This account has been blocked by the site owner.' } }, 403, cors);
    await (await db(env)).prepare('UPDATE users SET last_seen = ? WHERE id = ?').bind(Date.now(), user.id).run();
    return json({ token: await makeToken(env, { sub: user.id, role: 'user', v: user.token_version }), user: publicUser(user) }, 200, cors);
  }

  if (request.method === 'POST' && path === '/v1/auth/owner') {
    if (!allowed(`owner:${ip}`, 5)) return tooMany(cors, 'owner sign-in');
    if (!env.OWNER_KEY) return json({ error: { message: 'No owner key is set on this gateway (secret OWNER_KEY).' } }, 501, cors);
    const body = await readJson(request);
    if (!sameText(await sha(String(body?.key ?? '')), await sha(String(env.OWNER_KEY)))) return json({ error: { message: 'Wrong owner key.' } }, 401, cors);
    return json({ token: await makeToken(env, { sub: 'owner', role: 'owner', k: await ownerTag(env) }), user: OWNER_USER }, 200, cors);
  }

  const who = await identify(request, env);
  if (who.kind === 'invalid') return json({ error: { message: who.reason, code: 'auth' } }, who.status, cors);

  if (request.method === 'GET' && path === '/v1/auth/me') {
    if (who.kind === 'anon') return json({ error: { message: 'Not signed in.' } }, 401, cors);
    if (who.kind === 'owner') return json({ user: OWNER_USER, usage: null }, 200, cors);
    const s = await getSettings(env);
    const row = await (await db(env)).prepare('SELECT n FROM usage WHERE user_id = ? AND day = ?').bind(who.user.id, today()).first();
    return json({ user: publicUser(who.user), usage: { today: row?.n ?? 0, limit: who.user.daily_limit ?? s.dailyLimit } }, 200, cors);
  }

  // ---- owner only
  if (!path.startsWith('/v1/admin/')) return json({ error: { message: 'Not found.' } }, 404, cors);
  if (who.kind !== 'owner') return json({ error: { message: 'Only the site owner can do this.' } }, 403, cors);
  const d = await db(env);

  if (request.method === 'GET' && path === '/v1/admin/users') {
    const users = (await d.prepare('SELECT u.*, COALESCE(g.n, 0) AS today FROM users u LEFT JOIN usage g ON g.user_id = u.id AND g.day = ? ORDER BY u.created_at DESC LIMIT 1000').bind(today()).all()).results ?? [];
    return json({ users: users.map((u) => ({ ...publicUser(u), today: u.today })), settings: await getSettings(env) }, 200, cors);
  }

  if (request.method === 'POST' && path === '/v1/admin/settings') {
    const body = (await readJson(request)) ?? {};
    const puts = [];
    if (SIGNUP_MODES.includes(body.signup)) puts.push(['signup', body.signup]);
    if (typeof body.requireAccount === 'boolean') puts.push(['requireAccount', body.requireAccount ? 'on' : 'off']);
    if (Number(body.dailyLimit) > 0) puts.push(['dailyLimit', String(Math.min(100_000, Math.floor(Number(body.dailyLimit))))]);
    if (puts.length) await d.batch(puts.map(([k, v]) => d.prepare('INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').bind(k, v)));
    return json({ settings: await getSettings(env) }, 200, cors);
  }

  const m = /^\/v1\/admin\/users\/([\w-]{1,64})$/.exec(path);
  if (request.method === 'POST' && m) {
    const user = await d.prepare('SELECT * FROM users WHERE id = ?').bind(m[1]).first();
    if (!user) return json({ error: { message: 'No such user.' } }, 404, cors);
    const body = (await readJson(request)) ?? {};
    const action = String(body.action ?? '');
    if (action === 'delete') {
      await d.batch([d.prepare('DELETE FROM usage WHERE user_id = ?').bind(user.id), d.prepare('DELETE FROM users WHERE id = ?').bind(user.id)]);
      return json({ deleted: true }, 200, cors);
    }
    if (action === 'approve' || action === 'unblock') {
      await d.prepare("UPDATE users SET status = 'active' WHERE id = ?").bind(user.id).run();
    } else if (action === 'block') {
      // A new token version signs the person out everywhere at once.
      await d.prepare("UPDATE users SET status = 'blocked', token_version = token_version + 1 WHERE id = ?").bind(user.id).run();
    } else if (action === 'limit') {
      const n = body.dailyLimit == null || body.dailyLimit === '' ? null : Math.max(0, Math.min(100_000, Math.floor(Number(body.dailyLimit))));
      if (n != null && !Number.isFinite(n)) return json({ error: { message: 'The limit must be a number.' } }, 400, cors);
      await d.prepare('UPDATE users SET daily_limit = ? WHERE id = ?').bind(n, user.id).run();
    } else if (action === 'password') {
      const password = String(body.password ?? '');
      if (password.length < 8 || password.length > 200) return json({ error: { message: 'The new password needs at least 8 characters.' } }, 400, cors);
      const salt = b64u(crypto.getRandomValues(new Uint8Array(16)));
      await d.prepare('UPDATE users SET pass = ?, salt = ?, token_version = token_version + 1 WHERE id = ?').bind(await hashPassword(password, salt), salt, user.id).run();
    } else {
      return json({ error: { message: 'Unknown action.' } }, 400, cors);
    }
    const fresh = await d.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first();
    return json({ user: publicUser(fresh) }, 200, cors);
  }

  return json({ error: { message: 'Not found.' } }, 404, cors);
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

    if (path.startsWith('/v1/auth/') || path.startsWith('/v1/admin/')) return accountRoutes(request, env, cors, path);

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
      const g = await guard(request, env, cors, 'image');
      if (g.res) return g.res;
      const perMinute = Number(env.IMAGE_PER_MINUTE || 3);
      if (g.key && !allowed(`image:${g.key}`, perMinute)) {
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
      const g = await guard(request, env, cors, 'search');
      if (g.res) return g.res;
      const perMinute = Number(env.SEARCH_PER_MINUTE || 6);
      if (g.key && !allowed(`search:${g.key}`, perMinute)) {
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
      const g = await guard(request, env, cors, 'chat');
      if (g.res) return g.res;
      const perMinute = Number(env.PER_MINUTE || 12);
      if (g.key && !allowed(g.key, perMinute)) {
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
