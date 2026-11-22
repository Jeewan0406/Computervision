// Friendly model names and Free detection. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prettyModel, isFreeModel } from '../src/lib/models.ts';

test('friendly model names', () => {
  const cases: [string, string][] = [
    ['meta/llama-3.3-70b-instruct', 'Llama 3.3 70B'],
    ['gemini-2.5-flash', 'Gemini 2.5 Flash'],
    ['claude-opus-5-5', 'Claude Opus 5.5'],
    ['openai/gpt-oss-120b', 'GPT-OSS 120B'],
    ['gpt-5-mini', 'GPT-5 Mini'],
    ['nvidia:deepseek-ai/deepseek-r1', 'DeepSeek R1'],
    ['meta-llama/llama-3.3-70b-instruct:free', 'Llama 3.3 70B'],
    ['Qwen/Qwen2.5-Coder-32B-Instruct', 'Qwen 2.5 Coder 32B'],
    ['command-a-03-2025', 'Command A'],
    ['llama3.2', 'Llama 3.2'],
    ['o4-mini', 'o4 Mini'],
    ['google/gemma-3-27b-it', 'Gemma 3 27B'],
    ['mistral-small-latest', 'Mistral Small'],
  ];
  for (const [id, want] of cases) assert.equal(prettyModel(id), want, id);
});

test('free detection', () => {
  assert.equal(isFreeModel({ access: 'free-tier' }, 'gemini-2.5-flash'), true);
  assert.equal(isFreeModel({ access: 'keyless' }, 'openai'), true);
  assert.equal(isFreeModel({ access: 'paid' }, 'gpt-5'), false);
  assert.equal(isFreeModel({ access: 'free-tier', freeSuffixOnly: true }, 'openai/gpt-5'), false);
  assert.equal(isFreeModel({ access: 'free-tier', freeSuffixOnly: true }, 'meta-llama/llama-3.3-70b-instruct:free'), true);
});
