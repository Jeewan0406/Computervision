// Custom instructions and projects: prompt text, priority, and picking passages from files. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { customPrompt, chunkFiles, rankChunks, knowledgeBlock, projectPrompt, priorityNote, tokens } from '../src/lib/instructions.ts';

test('custom instructions: one box; empty gives nothing; 50,000 characters kept whole', () => {
  assert.equal(customPrompt('   '), '');
  const p = customPrompt('Plain English. Use SI units.');
  assert.equal(p, "# The user's custom instructions\nThe user wrote these for every conversation. Follow them unless a more specific instruction below says otherwise.\n\nPlain English. Use SI units.");
  const long = 'x'.repeat(50_000);
  assert.ok(customPrompt(long).endsWith(long));
});

test('priority: hard rules first, then the most specific instruction wins', () => {
  assert.equal(priorityNote({ rules: true, custom: false, project: false }), '');
  const withRules = priorityNote({ rules: true, custom: true, project: true });
  assert.match(withRules, /hard rules \(sections 0 to 8\) always apply/);
  assert.match(withRules, /this conversation's own instructions, then the project's instructions, then the user's custom instructions/);
  assert.match(withRules, /never their hard rules/);
  assert.equal(priorityNote({ rules: false, custom: true, project: false }), "# Which instruction wins\nIf instructions conflict, the most specific one wins: this conversation's own instructions, then the user's custom instructions.");
});

const PDF = {
  name: 'thesis.pdf',
  pages: [0, 0, 0],
  text: '',
};
{
  const p1 = 'Chapter 1. Bhutan generates most of its electricity from hydropower plants on fast rivers.\n\n'.repeat(12);
  const p2 = 'Chapter 2. Solar panels on rooftops in Thimphu can add power in the dry winter season when rivers are low.\n\n'.repeat(12);
  const p3 = 'Chapter 3. Grid stability needs storage, such as batteries or pumped hydro, to balance supply.\n\n'.repeat(12);
  PDF.text = p1 + p2 + p3;
  PDF.pages = [0, p1.length, p1.length + p2.length];
}

test('files split into passages with page numbers', () => {
  const chunks = chunkFiles([PDF], 1200);
  assert.ok(chunks.length >= 3);
  assert.ok(chunks.every((c) => c.text.length <= 1200));
  assert.equal(chunks[0].pageFrom, 1);
  assert.equal(chunks[chunks.length - 1].pageTo, 3);
  assert.deepEqual(chunks.map((c) => c.idx), chunks.map((_, i) => i));
  assert.ok(!tokens('The and of solar').includes('the'));
});

test('ranking finds the passage about the question', () => {
  const ranked = rankChunks(chunkFiles([PDF], 1200), 'rooftop solar panels in winter');
  assert.match(ranked[0].chunk.text, /Solar panels on rooftops/);
  assert.equal(ranked[0].chunk.pageFrom, 2);
});

test('knowledge: whole files when they fit, best passages when they do not', () => {
  const small = { name: 'notes.md', text: 'Short notes about the project.' };
  const full = knowledgeBlock([small, PDF], 'anything', 1_000_000);
  assert.equal(full.mode, 'full');
  assert.match(full.text, /=== File: notes\.md ===\nShort notes/);
  assert.match(full.text, /=== File: thesis\.pdf \(3 pages\) ===\n--- thesis\.pdf, page 1 ---\nChapter 1/);
  assert.match(full.text, /--- thesis\.pdf, page 3 ---\nChapter 3/);

  const part = knowledgeBlock([small, PDF], 'grid storage batteries pumped hydro', 2500);
  assert.equal(part.mode, 'passages');
  assert.ok(part.sent <= 2500 && part.passages >= 1, `${part.sent} chars, ${part.passages} passages`);
  assert.match(part.text, /--- Passage from thesis\.pdf, p(p)?\. 3/);
  assert.ok(!part.text.includes('Chapter 1.'), 'unrelated chapter left out');
  assert.equal(knowledgeBlock([], 'x', 100).mode, 'none');
});

test('project prompt: instructions, file note and citation rule', () => {
  const k = knowledgeBlock([PDF], 'grid storage', 2500);
  const p = projectPrompt({ name: 'Thesis', instructions: 'Use my files first.' }, k, 1);
  assert.match(p, /^# Project: Thesis\n/);
  assert.match(p, /## Project instructions\nUse my files first\./);
  assert.match(p, /only the \d+ passages? most related to the question \(\d+% of the text\)/);
  assert.match(p, /Cite them by file name and page or section, for example \(report\.pdf, p\. 3\)/);
  const noFiles = projectPrompt({ name: 'Empty', instructions: '' }, knowledgeBlock([], '', 10), 0);
  assert.ok(!noFiles.includes('Project files'));
});

import { ANSWER_STANDARD } from '../src/lib/standard.ts';
test('answer standard: length by context, trusted latest sources, several per claim, APA 7th, figures', () => {
  for (const phrase of [
    'Length fits the question',
    'one to three sentences',
    'full answer with sections',
    'Never use or cite Wikipedia, personal blogs, forums, social media or unverified sites',
    'established news organisations',
    'leading manufacturers and companies',
    'Prefer the newest results',
    'two, three, four or more independent results',
    'Give numbers with their units, dates, places and groups',
    'APA 7th',
    '"References" list',
    '(unverified)',
  ]) assert.ok(ANSWER_STANDARD.includes(phrase), phrase);
  assert.ok(ANSWER_STANDARD.length < 3000, 'kept short: it goes with every request');
});
