// Deploys the JeeA Gateway (proxy/jeea-gateway.js) to the owner's Cloudflare
// account and connects the site to it, so anyone can register and use the
// site's shared free models. Run by .github/workflows/gateway.yml.
//
// Needs the GitHub secret CLOUDFLARE_API_TOKEN (and JEEA_OWNER_KEY for the
// owner's sign-in). CLOUDFLARE_ACCOUNT_ID is optional: when it is not set, the
// account is found from the token, as Wrangler does. Steps:
//  1. find or create the D1 database "jeea-accounts" (accounts are stored there);
//  2. write a Wrangler config (D1 binding DB, optional Workers AI binding AI,
//     the site's address in ALLOWED_ORIGINS, the sign-up settings);
//  3. deploy the Worker;
//  4. set secrets: AUTH_SECRET (made once, then kept), OWNER_KEY and any
//     provider keys present as GitHub secrets (values are never printed);
//  5. write the Worker's address into public/jeea.config.json.
// `node agents/deploy-gateway.mjs --plan` only prints the config it would use.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

export const WRANGLER = 'wrangler@4.160.0';
export const WORKER_NAME = 'jeea-gateway';
export const DB_NAME = 'jeea-accounts';
/** Provider keys copied from GitHub secrets to the Worker when present. */
export const PROVIDER_SECRETS = ['NVIDIA_API_KEY', 'GROQ_API_KEY', 'GEMINI_API_KEY', 'CEREBRAS_API_KEY', 'MISTRAL_API_KEY', 'OPENROUTER_API_KEY', 'SAMBANOVA_API_KEY', 'HF_TOKEN', 'COHERE_API_KEY', 'OLLAMA_API_KEY', 'ZAI_API_KEY', 'SILICONFLOW_API_KEY', 'OVH_AI_KEY', 'KILO_API_KEY', 'TAVILY_API_KEY'];

const SIGNUP = ['open', 'approval', 'closed'];
const tomlString = (s) => JSON.stringify(String(s));

/** The site's address for ALLOWED_ORIGINS, e.g. https://jeewan0406.github.io */
export const siteOrigin = (owner) => `https://${String(owner).toLowerCase()}.github.io`;

/** All addresses the site is served from: GitHub Pages, plus a custom domain from public/CNAME. */
export function siteOrigins(owner, cname = '') {
  const domain = String(cname).trim().split(/\s+/)[0];
  return [siteOrigin(owner), ...(domain ? [`https://${domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '')}`] : [])].join(',');
}

/** Wrangler configuration (TOML) for the gateway. Pure, so it can be tested. */
export function gatewayConfig({ main, dbId, origin, signup = 'open', requireAccount = true, dailyLimit = 100, workersAi = true }) {
  if (!SIGNUP.includes(signup)) throw new Error(`signup must be one of ${SIGNUP.join(', ')}`);
  const limit = Math.max(1, Math.min(100_000, Math.floor(Number(dailyLimit) || 100)));
  return [
    `name = ${tomlString(WORKER_NAME)}`,
    `main = ${tomlString(main)}`,
    'compatibility_date = "2026-11-01"',
    'workers_dev = true',
    '',
    '[vars]',
    `ALLOWED_ORIGINS = ${tomlString(origin)}`,
    `SIGNUP_MODE = ${tomlString(signup)}`,
    `REQUIRE_ACCOUNT = ${tomlString(requireAccount ? 'on' : 'off')}`,
    `DAILY_LIMIT = ${tomlString(limit)}`,
    '',
    '[[d1_databases]]',
    'binding = "DB"',
    `database_name = ${tomlString(DB_NAME)}`,
    `database_id = ${tomlString(dbId)}`,
    ...(workersAi ? ['', '[ai]', 'binding = "AI"'] : []),
    '',
  ].join('\n');
}

/** The GitHub secret the deploy cannot run without. The Account ID is found from the token when not given. */
export const REQUIRED_SECRETS = ['CLOUDFLARE_API_TOKEN'];

/**
 * Checks the secrets before anything runs. Returns the names that are missing,
 * plus plain-English problems (e.g. an Account ID that is not the 32-character code).
 * Pure: reads only the object it is given.
 */
export function checkSecrets(env) {
  const val = (k) => String(env[k] ?? '').trim();
  const missing = REQUIRED_SECRETS.filter((k) => !val(k));
  const problems = [];
  const id = val('CLOUDFLARE_ACCOUNT_ID');
  if (id && !/^[0-9a-f]{32}$/i.test(id)) {
    problems.push(`CLOUDFLARE_ACCOUNT_ID does not look like an Account ID (it should be a code of 32 letters a–f and numbers, ${id.length} characters were found). Copy it again from the Cloudflare dashboard.`);
  }
  if (val('CLOUDFLARE_API_TOKEN') && /\s/.test(val('CLOUDFLARE_API_TOKEN'))) {
    problems.push('CLOUDFLARE_API_TOKEN contains a space. Paste only the token itself, with nothing before or after it.');
  }
  return { missing, problems };
}

/**
 * Picks the account from Cloudflare's list of accounts the token can reach.
 * Returns { id } when there is exactly one, or { error } in plain English.
 */
export function pickAccount(accounts) {
  const list = (Array.isArray(accounts) ? accounts : []).filter((a) => a && typeof a.id === 'string' && a.id);
  if (list.length === 1) return { id: list[0].id };
  if (!list.length) {
    return { error: 'The API token cannot see any Cloudflare account. Edit the token in Cloudflare (My Profile → API Tokens → your token → Edit) and, under the Account permissions, set "Include" to your account (not empty). Then save the token and run this workflow again.' };
  }
  return { error: `The API token can reach ${list.length} Cloudflare accounts, so the set-up cannot guess which one to use. Add the GitHub secret CLOUDFLARE_ACCOUNT_ID with the ID of the account you want (Settings → Secrets and variables → Actions → Repository secrets), then run this workflow again.` };
}

/** Put the gateway address into the site config; returns true when it changed. */
export function setGatewayInConfig(path, url) {
  const cfg = JSON.parse(readFileSync(path, 'utf8'));
  if (cfg.gateway === url) return false;
  cfg.gateway = url;
  writeFileSync(path, `${JSON.stringify(cfg, null, 2)}\n`);
  return true;
}

// ---------------------------------------------------------------- running

function wrangler(args, opts = {}) {
  return execFileSync('npx', ['--yes', WRANGLER, ...args], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...opts });
}

async function cloudflare(path) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, { headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` } });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.success === false) throw new Error(`Cloudflare API ${path}: ${res.status} ${JSON.stringify(j.errors ?? j).slice(0, 300)}`);
  return j.result;
}

function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

async function main() {
  const root = resolve(new URL('..', import.meta.url).pathname);
  const opt = {
    signup: process.env.SIGNUP_MODE || 'open',
    requireAccount: String(process.env.REQUIRE_ACCOUNT || 'on').toLowerCase() !== 'off',
    dailyLimit: Number(process.env.DAILY_LIMIT || 100),
    workersAi: String(process.env.WORKERS_AI || 'true') !== 'false',
    origin: siteOrigins(process.env.GITHUB_REPOSITORY_OWNER || 'example', existsSync(join(root, 'public/CNAME')) ? readFileSync(join(root, 'public/CNAME'), 'utf8') : ''),
    main: join(root, 'proxy/jeea-gateway.js'),
  };
  if (process.argv.includes('--plan')) {
    console.log(gatewayConfig({ ...opt, dbId: '00000000-0000-0000-0000-000000000000' }));
    return;
  }
  // Trim stray spaces or line breaks from pasted secrets (Wrangler and the API use them as they are).
  for (const k of [...REQUIRED_SECRETS, 'JEEA_OWNER_KEY']) if (process.env[k]) process.env[k] = process.env[k].trim();
  const found = (k) => (process.env[k] ? 'found' : 'MISSING');
  console.log(`Secrets: CLOUDFLARE_API_TOKEN ${found('CLOUDFLARE_API_TOKEN')}, CLOUDFLARE_ACCOUNT_ID ${process.env.CLOUDFLARE_ACCOUNT_ID ? 'found' : 'not set (will be found from the token)'}, JEEA_OWNER_KEY ${process.env.JEEA_OWNER_KEY ? 'found' : 'not set (no owner sign-in)'}`);
  const { missing, problems } = checkSecrets(process.env);
  if (missing.length) {
    fail(`Missing GitHub secret${missing.length > 1 ? 's' : ''}: ${missing.join(' and ')}. Add ${missing.length > 1 ? 'them' : 'it'} under repository Settings → Secrets and variables → Actions → "Repository secrets" → New repository secret, with the name spelled exactly like this. (Not under "Variables", "Environment secrets" or Dependabot.) See README → "Make it a public website".`);
  }
  if (problems.length) fail(problems.join('\n  '));

  // No Account ID given: ask Cloudflare which account the token belongs to (as Wrangler does).
  if (!process.env.CLOUDFLARE_ACCOUNT_ID) {
    let accounts;
    try {
      accounts = await cloudflare('/accounts?per_page=50');
    } catch (e) {
      fail(`Cloudflare did not accept the API token (${e.message}). Check that CLOUDFLARE_API_TOKEN holds the whole token and that the token is active in Cloudflare (My Profile → API Tokens). If the token is fine, add the GitHub secret CLOUDFLARE_ACCOUNT_ID and run this workflow again.`);
    }
    const pick = pickAccount(accounts);
    if (pick.error) fail(pick.error);
    // Hide the ID in the public log, then let Wrangler use it.
    if (process.env.GITHUB_ACTIONS) console.log(`::add-mask::${pick.id}`);
    process.env.CLOUDFLARE_ACCOUNT_ID = pick.id;
    console.log('   Account ID found from the token.');
  }

  // 1. The accounts database.
  console.log('1/5 Accounts database');
  let db = JSON.parse(wrangler(['d1', 'list', '--json'])).find((d) => d.name === DB_NAME);
  if (!db) {
    wrangler(['d1', 'create', DB_NAME]);
    db = JSON.parse(wrangler(['d1', 'list', '--json'])).find((d) => d.name === DB_NAME);
  }
  if (!db?.uuid) fail(`Could not create or find the D1 database "${DB_NAME}".`);
  console.log(`   using D1 database "${DB_NAME}"`);

  // 2. Config, 3. deploy.
  const dir = mkdtempSync(join(tmpdir(), 'jeea-gw-'));
  const configPath = join(dir, 'wrangler.toml');
  writeFileSync(configPath, gatewayConfig({ ...opt, dbId: db.uuid }));
  console.log(`2/5 Config: site ${opt.origin}, registration ${opt.signup}, registered users only ${opt.requireAccount ? 'on' : 'off'}, daily limit ${opt.dailyLimit}, Workers AI ${opt.workersAi ? 'on' : 'off'}`);
  console.log('3/5 Deploying the Worker');
  try {
    process.stdout.write(wrangler(['deploy', '--config', configPath]));
  } catch (e) {
    const out = `${e.stdout ?? ''}\n${e.stderr ?? ''}`;
    if (/register a workers\.dev subdomain/i.test(out)) {
      fail('Your Cloudflare account has no workers.dev subdomain yet. Open the Cloudflare dashboard → Workers & Pages once and choose a subdomain, then run this workflow again.');
    }
    console.error(out);
    fail('The Worker could not be deployed (see the message above). If it mentions permissions, check the API token has "Workers Scripts: Edit" and "D1: Edit" (and Workers AI if that is on).');
  }

  // 4. Secrets (never printed).
  console.log('4/5 Secrets');
  const have = new Set(JSON.parse(wrangler(['secret', 'list', '--config', configPath, '--format', 'json'])).map((s) => s.name));
  const secrets = {};
  if (!have.has('AUTH_SECRET')) secrets.AUTH_SECRET = randomBytes(48).toString('base64url');
  if (process.env.JEEA_OWNER_KEY) secrets.OWNER_KEY = process.env.JEEA_OWNER_KEY;
  for (const k of PROVIDER_SECRETS) if (process.env[k]) secrets[k] = process.env[k];
  if (Object.keys(secrets).length) {
    const file = join(dir, 'secrets.json');
    writeFileSync(file, JSON.stringify(secrets), { mode: 0o600 });
    try {
      wrangler(['secret', 'bulk', file, '--config', configPath]);
    } finally {
      rmSync(file, { force: true });
    }
  }
  console.log(`   set: ${Object.keys(secrets).join(', ') || 'nothing new'}${have.has('AUTH_SECRET') ? ' (AUTH_SECRET kept, so people stay signed in)' : ''}`);
  if (!process.env.JEEA_OWNER_KEY && !have.has('OWNER_KEY')) {
    console.log('   note: no JEEA_OWNER_KEY secret, so there is no owner sign-in yet.');
    // A warning shows on the run's page, so the owner sees it without opening the log.
    if (process.env.JEEA_OWNER_KEY_AS_VARIABLE === 'yes') {
      console.log('::warning::JEEA_OWNER_KEY was saved as a Variable, not a Secret, so it was not used (and Variables are not hidden). Delete it on the Variables tab, add it again on the Secrets tab (Settings → Secrets and variables → Actions → Secrets → New repository secret), then run this workflow again.');
    } else {
      console.log('::warning::No owner sign-in yet: the repository secret JEEA_OWNER_KEY was not found. Add it on Settings → Secrets and variables → Actions → Secrets tab → New repository secret (name exactly JEEA_OWNER_KEY), then run this workflow again.');
    }
  }
  rmSync(dir, { recursive: true, force: true });

  // 5. Connect the site.
  const { subdomain } = await cloudflare(`/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/workers/subdomain`);
  const url = `https://${WORKER_NAME}.${subdomain}.workers.dev`;
  const changed = setGatewayInConfig(join(root, 'public/jeea.config.json'), url);
  console.log(`5/5 Gateway address: ${url} (${changed ? 'written to public/jeea.config.json' : 'already in public/jeea.config.json'})`);
  if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `url=${url}\nchanged=${changed}\n`, { flag: 'a' });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => fail(e.message));
}
