// The gateway deploy script's pure parts: Wrangler config and site config.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gatewayConfig, setGatewayInConfig, siteOrigin, siteOrigins } from '../agents/deploy-gateway.mjs';

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
