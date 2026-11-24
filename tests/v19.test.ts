import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anthropicEffort, openaiEffort, thinkingPrompt, THINK_LEVELS, REVIEW_PROMPT } from '../src/lib/thinking.ts';
import { pasteAction, isPicture } from '../src/lib/attach.ts';
import { compactSystem, fitTurns, smallModelMessages } from '../src/lib/small.ts';

test('thinking levels: five levels, guidance grows with the level', () => {
  assert.deepEqual(THINK_LEVELS.map((l) => l.id), ['low', 'medium', 'high', 'xhigh', 'max']);
  const len = THINK_LEVELS.map((l) => thinkingPrompt(l.id).length);
  assert.ok(len[0] < len[2] && len[2] < len[3] && len[3] < len[4], String(len));
  assert.match(thinkingPrompt('high'), /least sure/);
  assert.match(thinkingPrompt('xhigh'), /two other explanations/);
  assert.doesNotMatch(thinkingPrompt('max'), /asked to review/);
  assert.match(thinkingPrompt('max', { selfCheck: true }), /asked to review it/);
  assert.match(REVIEW_PROMPT, /complete improved answer only/);
});

test('Claude effort: all five on Claude 5 and Opus 4.7/4.8; no xhigh on 4.6; none on Haiku 4.5', () => {
  assert.equal(anthropicEffort('claude-opus-5-5', 'xhigh'), 'xhigh');
  assert.equal(anthropicEffort('claude-sonnet-5-5', 'max'), 'max');
  assert.equal(anthropicEffort('claude-haiku-5-5', 'low'), 'low');
  assert.equal(anthropicEffort('claude-opus-4-8', 'xhigh'), 'xhigh');
  assert.equal(anthropicEffort('claude-sonnet-4-6', 'xhigh'), 'high');
  assert.equal(anthropicEffort('claude-opus-4-5', 'max'), 'high');
  assert.equal(anthropicEffort('claude-haiku-4-5', 'high'), undefined);
});

test('OpenAI reasoning_effort only for OpenAI reasoning models', () => {
  assert.equal(openaiEffort('openai', 'gpt-5.1', 'max'), 'high');
  assert.equal(openaiEffort('openai', 'o4-mini', 'low'), 'low');
  assert.equal(openaiEffort('openai', 'gpt-4o', 'high'), undefined);
  assert.equal(openaiEffort('groq', 'gpt-5', 'high'), undefined);
});

test('paste: text copied from Office or a web page stays text; screenshots and files attach', () => {
  const png = { name: 'image.png', type: 'image/png' };
  assert.equal(pasteAction('Slide title and bullet points', [png]), 'text');
  assert.equal(pasteAction('', [png]), 'files');
  assert.equal(pasteAction('photo.jpg', [{ name: 'photo.jpg', type: 'image/jpeg' }]), 'files');
  assert.equal(pasteAction('answer.pptx', [{ name: 'answer.pptx', type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }]), 'files');
  assert.equal(pasteAction('plain text', []), 'text');
  assert.ok(isPicture({ name: 'a.webp', type: 'image/webp' }) && !isPicture({ name: 'a.pdf', type: 'application/pdf' }));
});

test('small in-browser models get a short system text with the date and web results', () => {
  const big = `# JeeA! answer standard\n${'rule '.repeat(5000)}\nToday is Monday, 24 November 2026, 10:00 (UTC).\nWeb search results for "x", fetched just now (2):\n\n[1] A\n\n[2] B`;
  const s = compactSystem(big, 2000);
  assert.ok(s.length <= 2100);
  assert.match(s, /Today is Monday/);
  assert.match(s, /\[1\] A/);
  assert.doesNotMatch(s, /rule rule/);
  const turns = fitTurns([{ role: 'user', content: 'a'.repeat(500) }, { role: 'assistant', content: 'b'.repeat(500) }, { role: 'user', content: 'last' }], 600);
  assert.deepEqual(turns.map((t) => t.content.slice(0, 4)), ['bbbb', 'last']);
  const msgs = smallModelMessages([{ role: 'system', content: big }, { role: 'user', content: 'hi', images: ['data:image/png;base64,AAA'] }], 4096);
  assert.equal(msgs[0].role, 'system');
  assert.match(msgs[1].content, /cannot see pictures/);
  assert.ok(msgs.reduce((n, m) => n + m.content.length, 0) < 4096 * 3.2);
});
