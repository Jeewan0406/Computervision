import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pptxText, xlsxText, xmlText } from '../src/lib/extract.ts';

const buf = (p: string) => {
  const b = readFileSync(new URL(p, import.meta.url));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

test('PowerPoint: slide text in order, with notes and decoded symbols', async () => {
  const r = await pptxText(buf('./fixtures/sample.pptx'));
  assert.equal(r.kind, 'pptx');
  assert.match(r.text, /^Slide 1\nGrid batteries & solar\nStore energy for evening peaks\nCost fell 20% <in 2025>/);
  assert.match(r.text, /Speaker notes: Say: prices from IEA report/);
  assert.ok(r.text.indexOf('Slide 2\nSecond slide') > r.text.indexOf('Slide 1'));
});

test('Excel: every sheet, shared strings, numbers, booleans and gaps', async () => {
  const r = await xlsxText(buf('./fixtures/sample.xlsx'));
  assert.equal(r.kind, 'xlsx');
  assert.match(r.text, /Sheet: Prices\nItem \| Price \| In stock\nBattery & cable \| 120\.5 \| TRUE\n \|  \|  \|  \| far cell/);
  assert.match(r.text, /Sheet: Notes\nChecked 2026/);
});

test('XML entities are decoded', () => {
  assert.equal(xmlText('a &amp; b &lt;c&gt; &#39;d&#x27; &quot;e&quot;'), 'a & b <c> \'d\' "e"');
});
