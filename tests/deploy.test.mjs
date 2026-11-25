// The gateway deploy script's pure parts: Wrangler config and site config.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkSecrets, gatewayConfig, pickAccount, setGatewayInConfig, siteOrigin, siteOrigins } from '../agents/deploy-gateway.mjs';

test('secret check names exactly what is missing or wrong', () => {
  const id = '0123456789abcdef0123456789ABCDEF';
  assert.deepEqual(checkSecrets({}), { missing: ['CLOUDFLARE_API_TOKEN'], problems: [] });
  // The Account ID may be left out: it is found from the token.
  assert.deepEqual(checkSecrets({ CLOUDFLARE_API_TOKEN: 't0k', CLOUDFLARE_ACCOUNT_ID: '  ' }), { missing: [], problems: [] });
  assert.deepEqual(checkSecrets({ CLOUDFLARE_API_TOKEN: 't0k', CLOUDFLARE_ACCOUNT_ID: `${id}\n` }), { missing: [], problems: [] });
  const bad = checkSecrets({ CLOUDFLARE_API_TOKEN: 't0k', CLOUDFLARE_ACCOUNT_ID: 'me@example.com' });
  assert.equal(bad.missing.length, 0);
  assert.match(bad.problems[0], /32 letters/);
  assert.match(checkSecrets({ CLOUDFLARE_API_TOKEN: 'Bearer t0k', CLOUDFLARE_ACCOUNT_ID: id }).problems[0], /contains a space/);
});

test('the account is found from the token when there is exactly one', () => {
  const id = '0123456789abcdef0123456789abcdef';
  assert.deepEqual(pickAccount([{ id, name: 'Mine' }]), { id });
  assert.match(pickAccount([]).error, /cannot see any Cloudflare account/);
  assert.match(pickAccount(undefined).error, /cannot see any/);
  assert.match(pickAccount([{ id }, { id: id.replace('0', '1') }]).error, /2 Cloudflare accounts.*CLOUDFLARE_ACCOUNT_ID/);
});

test('Wrangler config: D1 binding, site origin, sign-up settings, optional Workers AI', () => {
  const t = gatewayConfig({ main: '/x/jeea-gateway.js', dbId: 'abc-123', origin: siteOrigin('Jeewan0406'), signup: 'approval', requireAccount: true, dailyLimit: '50' });
  assert.match(t, /name = "jeea-gateway"/);
  assert.match(t, /ALLOWED_ORIGINS = "https:\/\/jeewan0406\.github\.io"/);
  assert.match(t, /SIGNUP_MODE = "approval"/);
  assert.match(t, /REQUIRE_ACCOUNT = "on"/);
  assert.match(t, /DAILY_LIMIT = "50"/);
  assert.match(t, /\[\[d1_databases\]\]\nbinding = "DB"\ndatabase_name = "jeea-accounts"\ndatabase_id = "abc-123"/);
  assert.match(t, /\[ai\]\nbinding = "AI"/);
  assert.doesNotMatch(gatewayConfig({ main: 'm', dbId: 'd', origin: 'o', workersAi: false }), /\[ai\]/);
  assert.throws(() => gatewayConfig({ main: 'm', dbId: 'd', origin: 'o', signup: 'everyone' }));
});

test('site config gets the gateway address once', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
  const p = join(dir, 'jeea.config.json');
  writeFileSync(p, JSON.stringify({ about: 'x', gateway: '', gatewayName: 'JeeA Free+' }));
  assert.equal(setGatewayInConfig(p, 'https://jeea-gateway.me.workers.dev'), true);
  assert.equal(JSON.parse(readFileSync(p, 'utf8')).gateway, 'https://jeea-gateway.me.workers.dev');
  assert.equal(JSON.parse(readFileSync(p, 'utf8')).gatewayName, 'JeeA Free+');
  assert.equal(setGatewayInConfig(p, 'https://jeea-gateway.me.workers.dev'), false);
});

test('a custom domain in public/CNAME is allowed too', () => {
  assert.equal(siteOrigins('Jeewan0406'), 'https://jeewan0406.github.io');
  assert.equal(siteOrigins('Jeewan0406', 'jeeai.app\n'), 'https://jeewan0406.github.io,https://jeeai.app');
});
