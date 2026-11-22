/**
 * Optional CORS proxy for JeeA! (Cloudflare Workers, free plan is enough).
 *
 * Why: a few AI APIs refuse calls made directly from a web page (CORS).
 * This worker forwards the request and adds the CORS headers browsers need.
 *
 * Deploy:  npx wrangler deploy proxy/cloudflare-worker.js --name jeea-proxy
 * Use:     in JeeA! -> API Slots -> Routing, set the prefix to
 *          https://jeea-proxy.<your-subdomain>.workers.dev/
 *          then tick "Use CORS proxy" on the key that needs it.
 *
 * The worker sees your API key while forwarding, so run your own copy.
 * Only the hosts listed below can be reached, so it is not an open proxy.
 */
const ALLOWED_HOSTS = new Set([
  'integrate.api.nvidia.com',
  'api.groq.com',
  'api.mistral.ai',
  'api.cerebras.ai',
  'api.sambanova.ai',
  'api.together.xyz',
  'api.deepseek.com',
  'api.x.ai',
  'api.cohere.ai',
  'router.huggingface.co',
  'models.github.ai',
  'openrouter.ai',
  'api.openai.com',
  'api.anthropic.com',
  'generativelanguage.googleapis.com',
]);

// Optional: lock the proxy to your site, e.g. ['https://<user>.github.io'].
const ALLOWED_ORIGINS = [];

const STRIP = ['host', 'origin', 'referer', 'cookie', 'cf-connecting-ip', 'x-forwarded-for', 'x-real-ip', 'x-forwarded-proto'];

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '*';
    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': request.headers.get('Access-Control-Request-Headers') || '*',
      'Access-Control-Expose-Headers': '*',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    if (ALLOWED_ORIGINS.length && !ALLOWED_ORIGINS.includes(origin)) {
      return new Response('Origin not allowed', { status: 403, headers: cors });
    }
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    const raw = (url.pathname.slice(1) + url.search).replace(/^(https?):\/(?!\/)/, '$1://');
    let target;
    try {
      target = new URL(raw);
    } catch {
      return new Response('Usage: <proxy>/https://api.example.com/v1/...', { status: 400, headers: cors });
    }
    if (target.protocol !== 'https:' || !ALLOWED_HOSTS.has(target.hostname)) {
      return new Response(`Host not allowed: ${target.hostname}`, { status: 403, headers: cors });
    }

    const headers = new Headers(request.headers);
    for (const h of STRIP) headers.delete(h);
    const upstream = await fetch(target.toString(), {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
      redirect: 'follow',
    });
    const res = new Response(upstream.body, upstream); // streams Server-Sent Events through
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    return res;
  },
};
