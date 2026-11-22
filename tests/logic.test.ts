// Unit tests for JeeA!'s pure logic. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSSEParser, parseRetryAfter } from '../src/lib/sse.ts';
import { codeBlocks, extractRunnable, liveHtml, splitThink, stripCode } from '../src/lib/text.ts';

test('SSE parser joins lines split across network chunks', () => {
  const got: string[] = [];
  const p = createSSEParser((d) => got.push(d));
  p.push('data: {"a":');
  p.push('1}\r\n\r\ndata: [DO');
  p.push('NE]\n\n: comment\nevent: x\n');
  p.flush();
  assert.deepEqual(got, ['{"a":1}', '[DONE]']);
});

test('SSE parser flushes a final line with no newline', () => {
  const got: string[] = [];
  const p = createSSEParser((d) => got.push(d));
  p.push('data: tail');
  p.flush();
  assert.deepEqual(got, ['tail']);
});

test('Retry-After accepts seconds and HTTP dates', () => {
  assert.equal(parseRetryAfter('20'), 20_000);
  assert.equal(parseRetryAfter('0.5'), 500);
  const now = Date.parse('2026-11-22T10:00:00Z');
  assert.equal(parseRetryAfter('Sun, 22 Nov 2026 10:00:30 GMT', now), 30_000);
  assert.equal(parseRetryAfter(null), undefined);
  assert.equal(parseRetryAfter('soon'), undefined);
});

test('splitThink separates <think> reasoning from the answer', () => {
  assert.deepEqual(splitThink('<think>plan it</think>\n\nHello'), { reasoning: 'plan it', answer: 'Hello' });
  assert.deepEqual(splitThink('<think>still thinking'), { reasoning: 'still thinking', answer: '' });
  assert.deepEqual(splitThink('No tags'), { reasoning: '', answer: 'No tags' });
});

test('codeBlocks finds closed blocks and a final unclosed one', () => {
  const md = 'a\n```js\nconst x = 1;\n```\nb\n```html\n<div>';
  const blocks = codeBlocks(md);
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks[0], { lang: 'js', code: 'const x = 1;', closed: true });
  assert.equal(blocks[1].closed, false);
  assert.equal(liveHtml(md), '<div>');
});

test('extractRunnable prefers the last full HTML document', () => {
  const doc = '<!DOCTYPE html><html><head></head><body>v2</body></html>';
  const md = '```html\n<!DOCTYPE html><html><body>v1</body></html>\n```\n```html\n' + doc + '\n```';
  assert.equal(extractRunnable(md), doc);
});

test('extractRunnable stitches separate HTML, CSS and JS blocks', () => {
  const md = '```html\n<button id="b">Hi</button>\n```\n```css\nbutton{color:red}\n```\n```js\nconsole.log(1)\n```';
  const out = extractRunnable(md)!;
  assert.match(out, /<button id="b">Hi<\/button>/);
  assert.match(out, /button\{color:red\}/);
  assert.match(out, /console\.log\(1\)/);
  assert.match(out, /<!DOCTYPE html>/);
});

test('extractRunnable returns null when there is nothing to run', () => {
  assert.equal(extractRunnable('```python\nprint(1)\n```'), null);
  assert.equal(extractRunnable('plain text'), null);
});

test('stripCode hides long blocks but keeps short ones', () => {
  const long = '```html\n' + Array.from({ length: 10 }, (_, i) => `<p>${i}</p>`).join('\n') + '\n```';
  assert.match(stripCode(`Done.\n${long}`), /Code sent to the editor/);
  assert.equal(stripCode('```js\nx()\n```'), '```js\nx()\n```');
});
