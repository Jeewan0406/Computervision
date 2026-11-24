import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assess, profile, paramSize, rankModels, chainFrom, autoReason, type Candidate } from '../src/lib/router.ts';
import type { ProviderDef } from '../src/lib/types.ts';

const prov = (id: string, extra: Partial<ProviderDef> = {}) => ({ id, name: id, kind: 'openai', baseUrl: '', access: 'keyless', color: '', tagline: '', suggestedModels: [], defaultModel: '', ...extra }) as ProviderDef;
const cand = (p: ProviderDef, model: string, extra: Partial<Candidate> = {}): Candidate => ({ ref: { providerId: p.id, model }, provider: p, free: true, ownKey: false, ...extra });

test('assess: small talk is simple, analysis is complex, code and maths are noticed', () => {
  assert.equal(assess('hi').tier, 'simple');
  assert.equal(assess('What is the capital of France?').tier, 'simple');
  const code = assess('Write a Python function to parse dates and add unit tests');
  assert.equal(code.tier, 'standard');
  assert.ok(code.code);
  const hard = assess('Critically evaluate the evidence for and against carbon taxes, compare three countries and recommend a strategy');
  assert.equal(hard.tier, 'complex');
  assert.ok(hard.reasons.includes('reasoning'));
  assert.ok(assess('Prove that the square root of 2 is irrational').maths);
  assert.ok(assess('What is in this picture?', { images: 1 }).vision);
});

test('assess: thinking level moves the result, files count, long files flagged', () => {
  assert.equal(assess('Explain photosynthesis', { thinking: 'max' }).tier, 'standard');
  assert.equal(assess('Compare two phones and recommend one', { thinking: 'low' }).tier, 'simple');
  const f = assess(`Summarise\n\n**Attached file: a.pdf**\n\`\`\`\n${'x'.repeat(50_000)}\n\`\`\``);
  assert.ok(f.long && f.reasons.includes('long files'));
});

test('profile: strength from family and size; "gemini" is not "mini"', () => {
  assert.equal(profile('gemini-2.5-pro').strength, 5);
  assert.equal(profile('gemini-2.5-flash').strength, 4);
  assert.equal(profile('gemini-2.5-flash-lite').strength, 3);
  assert.equal(profile('gpt-5-mini').strength, 4);
  assert.equal(profile('claude-opus-5-5').strength, 5);
  assert.equal(profile('Meta-Llama-3_3-70B-Instruct').strength, 4);
  assert.equal(profile('Qwen3.5-397B-A17B').strength, 5);
  assert.equal(profile('llama-3.1-8b-instant').strength, 2);
  assert.equal(paramSize('Qwen3.5-397B-A17B'), 397);
  assert.ok(profile('qwen3-vl-30b-a3b').vision && !profile('gpt-oss-120b').vision);
});

test('rank: simple -> small free model; complex -> strongest; pictures -> vision models only', () => {
  const gw = prov('gw');
  const cands = [cand(gw, 'llama-3.1-8b-instant'), cand(gw, 'meta/llama-3.3-70b-instruct'), cand(gw, 'qwen/qwen3.5-397b-a17b'), cand(gw, 'qwen3-vl-30b-a3b')];
  assert.equal(rankModels(assess('hi'), cands)[0].ref.model, 'llama-3.1-8b-instant');
  assert.equal(rankModels(assess('Critically evaluate, compare and recommend a strategy with evidence'), cands)[0].ref.model, 'qwen/qwen3.5-397b-a17b');
  const pics = rankModels(assess('What is this?', { images: 1 }), cands);
  assert.deepEqual(pics.map((c) => c.ref.model), ['qwen3-vl-30b-a3b']);
});

test('rank: recent failures, slow free models and paid models are handled', () => {
  const a = prov('a');
  const slow = prov('slow', { minGapMs: 45_000 });
  const ranked = rankModels(assess('hi'), [cand(slow, 'model-8b'), cand(a, 'other-8b')]);
  assert.equal(ranked[0].provider.id, 'a');
  const failed = rankModels(assess('Explain the causes of inflation and compare two theories'), [cand(a, 'big-70b', { failures: 2 }), cand(a, 'mid-70b')]);
  assert.equal(failed[0].ref.model, 'mid-70b');
  const busy = rankModels(assess('hi'), [cand(a, 'one-8b', { busyMs: 40_000 }), cand(prov('c'), 'two-8b')]);
  assert.equal(busy[0].ref.model, 'two-8b');
  const paid = prov('paid', { access: 'paid' });
  const simple = rankModels(assess('thanks'), [cand(paid, 'claude-opus-5-5', { free: false, ownKey: true }), cand(a, 'small-8b')]);
  assert.equal(simple[0].ref.model, 'small-8b');
});

test('chain: alternatives come from other services first', () => {
  const a = prov('a');
  const b = prov('b');
  const ranked = rankModels(assess('hi'), [cand(a, 'x-8b'), cand(a, 'y-8b'), cand(b, 'z-70b')]);
  const chain = chainFrom(ranked, 3);
  assert.equal(chain[0].provider.id, 'a');
  assert.equal(chain[1].provider.id, 'b');
  assert.equal(chain.length, 3);
  assert.match(autoReason(assess('hi'), chain[0]), /^Auto: a simple question, so it chose a fast, free model\.$/);
});
