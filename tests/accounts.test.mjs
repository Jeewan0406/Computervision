// Accounts in proxy/jeea-gateway.js: register, sign in, owner, limits, admin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../proxy/jeea-gateway.js';
import { makeD1 } from './d1mock.mjs';

const upstream = [];
globalThis.fetch = async (url, init = {}) => {
  upstream.push({ url: String(url), auth: init.headers?.Authorization });
  return new Response('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
};

const SITE = 'https://jeewan0406.github.io';
let ipN = 0;
const freshIp = () => `10.0.${Math.floor(++ipN / 250)}.${ipN % 250}`;
const call = (env, path, { method = 'GET', body, token, ip = freshIp() } = {}) =>
  worker.fetch(new Request(`https://gw.example.workers.dev${path}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { Origin: SITE, 'CF-Connecting-IP': ip, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  }), env);
const j = async (r) => ({ status: r.status, body: await r.json() });
const chat = (env, token) => call(env, '/v1/chat/completions', { method: 'POST', token, body: { model: 'nvidia:meta/llama-3.3-70b-instruct', messages: [{ role: 'user', content: 'hi' }], stream: true } });
const mkEnv = (extra = {}) => ({ NVIDIA_API_KEY: 'nvapi-secret', ALLOWED_ORIGINS: SITE, PER_MINUTE: '100', DB: makeD1(), AUTH_SECRET: 'test-secret-that-is-long-enough', OWNER_KEY: 'owner pass phrase 123', ...extra });
const register = (env, email, password = 'password123', name = 'Test User') => call(env, '/v1/auth/register', { method: 'POST', body: { name, email, password } });
const ownerToken = async (env) => (await j(await call(env, '/v1/auth/owner', { method: 'POST', body: { key: env.OWNER_KEY } }))).body.token;

test('without a database the gateway works as before and says accounts are off', async () => {
  const env = { NVIDIA_API_KEY: 'nvapi-secret', ALLOWED_ORIGINS: SITE };
  assert.deepEqual((await j(await call(env, '/v1/auth/config'))).body, { accounts: false });
  assert.equal((await chat(env)).status, 200);
  assert.equal((await register(env, 'a@b.co')).status, 501);
});

test('open sign-up: register, use the free models, usage is counted, password is hashed', async () => {
  const env = mkEnv();
  const cfg = (await j(await call(env, '/v1/auth/config'))).body;
  assert.deepEqual(cfg, { accounts: true, signup: 'open', requireAccount: false, dailyLimit: 100, owner: true });
  const r = await j(await register(env, 'Pema@Example.com'));
  assert.equal(r.status, 201);
  assert.match(r.body.token, /^jeea1\./);
  assert.equal(r.body.user.email, 'pema@example.com');
  assert.equal(r.body.user.pass, undefined);
  const row = env.DB.raw.prepare('SELECT pass, salt FROM users').get();
  assert.notEqual(row.pass, 'password123');
  assert.ok(row.salt.length >= 20);
  assert.equal((await chat(env, r.body.token)).status, 200);
  assert.equal((await chat(env, r.body.token)).status, 200);
  const me = (await j(await call(env, '/v1/auth/me', { token: r.body.token }))).body;
  assert.deepEqual(me.usage, { today: 2, limit: 100 });
  assert.equal((await chat(env)).status, 200, 'anonymous use still allowed while "registered only" is off');
});

test('sign-in: wrong password refused, right password works; bad input explained', async () => {
  const env = mkEnv();
  await register(env, 'dorji@example.com', 'correct-horse');
  assert.equal((await register(env, 'dorji@example.com')).status, 409);
  assert.equal((await register(env, 'not-an-email')).status, 400);
  assert.equal((await register(env, 'x@example.com', 'short')).status, 400);
  assert.equal((await call(env, '/v1/auth/login', { method: 'POST', body: { email: 'dorji@example.com', password: 'wrong-pass' } })).status, 401);
  const ok = await j(await call(env, '/v1/auth/login', { method: 'POST', body: { email: 'DORJI@example.com', password: 'correct-horse' } }));
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.name, 'Test User');
});

test('owner: wrong key refused; owner has no daily limit and sees users without passwords', async () => {
  const env = mkEnv({ DAILY_LIMIT: '1' });
  assert.equal((await call(env, '/v1/auth/owner', { method: 'POST', body: { key: 'guess' } })).status, 401);
  const owner = await ownerToken(env);
  for (let i = 0; i < 3; i++) assert.equal((await chat(env, owner)).status, 200);
  const u = (await j(await register(env, 'karma@example.com'))).body;
  await chat(env, u.token);
  const list = (await j(await call(env, '/v1/admin/users', { token: owner }))).body;
  assert.equal(list.users.length, 1);
  assert.equal(list.users[0].today, 1);
  assert.equal(list.users[0].pass, undefined);
  assert.equal(list.users[0].salt, undefined);
  assert.equal((await call(env, '/v1/admin/users', { token: u.token })).status, 403, 'a normal user cannot open the admin list');
  const me = (await j(await call(env, '/v1/auth/me', { token: owner }))).body;
  assert.equal(me.user.role, 'owner');
});

test('daily limit per user, and the owner can raise it', async () => {
  const env = mkEnv({ DAILY_LIMIT: '2' });
  const u = (await j(await register(env, 'tashi@example.com'))).body;
  assert.equal((await chat(env, u.token)).status, 200);
  assert.equal((await chat(env, u.token)).status, 200);
  const third = await j(await chat(env, u.token));
  assert.equal(third.status, 429);
  assert.equal(third.body.error.code, 'daily_limit');
  const owner = await ownerToken(env);
  await call(env, `/v1/admin/users/${u.user.id}`, { method: 'POST', token: owner, body: { action: 'limit', dailyLimit: 5 } });
  assert.equal((await chat(env, u.token)).status, 200);
});

test('"registered users only": anonymous refused, signed-in allowed; owner changes it in the app', async () => {
  const env = mkEnv();
  const owner = await ownerToken(env);
  const s = (await j(await call(env, '/v1/admin/settings', { method: 'POST', token: owner, body: { requireAccount: true, dailyLimit: 50 } }))).body.settings;
  assert.equal(s.requireAccount, true);
  assert.equal(s.dailyLimit, 50);
  const anon = await j(await chat(env));
  assert.equal(anon.status, 401);
  assert.equal(anon.body.error.code, 'account_required');
  const u = (await j(await register(env, 'sonam@example.com'))).body;
  assert.equal((await chat(env, u.token)).status, 200);
  assert.equal((await call(env, '/v1/admin/settings', { method: 'POST', token: u.token, body: { requireAccount: false } })).status, 403);
});

test('approval mode: pending until the owner approves', async () => {
  const env = mkEnv({ SIGNUP_MODE: 'approval' });
  const r = await j(await register(env, 'yangchen@example.com'));
  assert.equal(r.status, 202);
  assert.equal(r.body.pending, true);
  assert.equal(r.body.token, undefined);
  const login = () => call(env, '/v1/auth/login', { method: 'POST', body: { email: 'yangchen@example.com', password: 'password123' } });
  assert.equal((await login()).status, 403);
  const owner = await ownerToken(env);
  const id = (await j(await call(env, '/v1/admin/users', { token: owner }))).body.users[0].id;
  await call(env, `/v1/admin/users/${id}`, { method: 'POST', token: owner, body: { action: 'approve' } });
  assert.equal((await login()).status, 200);
});

test('closed sign-up; blocking signs the person out everywhere; delete removes them', async () => {
  const env = mkEnv();
  const u = (await j(await register(env, 'jigme@example.com'))).body;
  const owner = await ownerToken(env);
  await call(env, `/v1/admin/users/${u.user.id}`, { method: 'POST', token: owner, body: { action: 'block' } });
  const refused = await j(await chat(env, u.token));
  assert.equal(refused.status, 403, 'old sign-in no longer works');
  assert.match(refused.body.error.message, /blocked/);
  assert.equal((await call(env, '/v1/auth/login', { method: 'POST', body: { email: 'jigme@example.com', password: 'password123' } })).status, 403);
  await call(env, `/v1/admin/users/${u.user.id}`, { method: 'POST', token: owner, body: { action: 'unblock' } });
  assert.equal((await chat(env, u.token)).status, 401, 'unblocking does not revive old sign-ins');
  assert.equal((await call(env, '/v1/auth/login', { method: 'POST', body: { email: 'jigme@example.com', password: 'password123' } })).status, 200);
  await call(env, '/v1/admin/settings', { method: 'POST', token: owner, body: { signup: 'closed' } });
  assert.equal((await register(env, 'new@example.com')).status, 403);
  await call(env, `/v1/admin/users/${u.user.id}`, { method: 'POST', token: owner, body: { action: 'delete' } });
  assert.equal((await j(await call(env, '/v1/admin/users', { token: owner }))).body.users.length, 0);
});

test('owner resets a password; tampered and old tokens are refused; a new owner key ends old owner sign-ins', async () => {
  const env = mkEnv();
  const u = (await j(await register(env, 'deki@example.com'))).body;
  const owner = await ownerToken(env);
  await call(env, `/v1/admin/users/${u.user.id}`, { method: 'POST', token: owner, body: { action: 'password', password: 'brand-new-pass' } });
  assert.equal((await chat(env, u.token)).status, 401);
  assert.equal((await call(env, '/v1/auth/login', { method: 'POST', body: { email: 'deki@example.com', password: 'brand-new-pass' } })).status, 200);
  const [tag, body, sig] = owner.split('.');
  const forged = `${tag}.${Buffer.from(JSON.stringify({ sub: 'owner', role: 'owner', k: 'x', exp: Date.now() + 1e9 })).toString('base64url')}.${sig}`;
  assert.equal((await call(env, '/v1/admin/users', { token: forged })).status, 401);
  assert.equal((await call(env, '/v1/admin/users', { token: `${tag}.${body}.AAAA` })).status, 401);
  assert.equal((await call(env, '/v1/admin/users', { token: owner }, )).status, 200);
  const env2 = { ...env, OWNER_KEY: 'a different owner key' };
  assert.equal((await call(env2, '/v1/admin/users', { token: owner })).status, 401);
});

test('sign-in attempts are limited per visitor', async () => {
  const env = mkEnv();
  await register(env, 'pem@example.com');
  let last = 0;
  for (let i = 0; i < 11; i++) last = (await call(env, '/v1/auth/login', { method: 'POST', ip: '9.9.9.9', body: { email: 'pem@example.com', password: 'wrong-password' } })).status;
  assert.equal(last, 429);
});
