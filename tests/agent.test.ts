// Unit tests for agent helpers (browser copy and 24/7 runner copy). Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseToolCall, stripToolBlock, validateArgs, htmlToText, textProtocolPrompt, type ToolSchema } from '../src/lib/agentText.ts';
// @ts-expect-error plain JS module without types
import * as runner from '../agents/lib.mjs';

const names = ['calculate', 'search_wikipedia'];

for (const [label, parse, strip] of [
  ['browser', parseToolCall, stripToolBlock],
  ['24/7 runner', runner.parseToolCall, runner.stripToolBlock],
] as const) {
  test(`${label}: parses a tool block and keeps the thought`, () => {
    const text = 'Let me work it out.\n```tool\n{"name": "calculate", "arguments": {"expression": "2+2"}}\n```';
    assert.deepEqual(parse(text, names), { name: 'calculate', args: { expression: '2+2' } });
    assert.equal(strip(text), 'Let me work it out.');
  });
  test(`${label}: accepts json fences, "args" and string arguments`, () => {
    assert.deepEqual(parse('```json\n{"name":"search_wikipedia","args":{"query":"Nepal"}}\n```', names), { name: 'search_wikipedia', args: { query: 'Nepal' } });
    assert.deepEqual(parse('```tool\n{"name":"calculate","arguments":"{\\"expression\\":\\"1+1\\"}"}\n```', names), { name: 'calculate', args: { expression: '1+1' } });
  });
  test(`${label}: final answers and unknown tools are not tool calls`, () => {
    assert.equal(parse('The answer is 4.', names), null);
    assert.equal(parse('```tool\n{"name":"delete_everything","arguments":{}}\n```', names), null);
    assert.equal(parse('```tool\n{not json}\n```', names), null);
    assert.equal(parse('```python\nprint(1)\n```', names), null);
  });
}

test('validateArgs reports missing and wrongly typed arguments', () => {
  const schema: ToolSchema = { name: 'x', description: '', parameters: { type: 'object', properties: { q: { type: 'string', description: '' }, n: { type: 'number', description: '' } }, required: ['q'] } };
  assert.equal(validateArgs(schema, { q: 'hi' }), null);
  assert.match(validateArgs(schema, {})!, /Missing required argument "q"/);
  assert.match(validateArgs(schema, { q: 'hi', n: 'five' })!, /must be a number/);
});

test('htmlToText removes scripts and tags and keeps line breaks', () => {
  const t = htmlToText('<html><head><title>x</title></head><body><script>alert(1)</script><h1>Hello</h1><p>A &amp; B</p></body></html>');
  assert.equal(t, 'Hello\nA & B');
  assert.equal(runner.htmlToText('<item><title><![CDATA[Rust 2.0]]></title></item>'), 'Rust 2.0');
});

test('text protocol prompt lists tools and marks required arguments', () => {
  const p = textProtocolPrompt([{ name: 'calculate', description: 'Do maths.', parameters: { type: 'object', properties: { expression: { type: 'string', description: 'The sum.' } }, required: ['expression'] } }]);
  assert.match(p, /- calculate: Do maths\. Arguments: expression \(string, required\): The sum\./);
  assert.match(p, /```tool/);
});

test('24/7 schedule: parseEvery and isDue', () => {
  assert.equal(runner.parseEvery('30m'), 30 * 60_000);
  assert.equal(runner.parseEvery('6h'), 6 * 3_600_000);
  assert.equal(runner.parseEvery('1d'), 86_400_000);
  assert.equal(runner.parseEvery('1m'), 5 * 60_000, 'GitHub cannot run more often than every 5 minutes');
  assert.equal(runner.parseEvery('weird'), 86_400_000);
  const now = Date.parse('2026-11-22T12:00:00Z');
  assert.equal(runner.isDue(undefined, '1d', now), true);
  assert.equal(runner.isDue('2026-11-22T06:00:00Z', '1d', now), false);
  assert.equal(runner.isDue('2026-11-21T12:10:00Z', '1d', now), false, '1430 minutes is not yet a day');
  assert.equal(runner.isDue('2026-11-21T12:04:00Z', '1d', now), true, '1436 minutes is due (5 minutes of slack for a late previous run)');
});

test('24/7 auto model: first provider with a secret, else the free model', () => {
  const needsKey = (id: string) => id !== 'jeea-free';
  assert.equal(runner.pickAuto(['gemini', 'groq', 'jeea-free'], { gemini: '', groq: 'k' }, needsKey), 'groq');
  assert.equal(runner.pickAuto(['gemini', 'groq', 'jeea-free'], {}, needsKey), 'jeea-free');
});
