#!/usr/bin/env node
// Trusted-news collector for JeeA!. Reads the feeds in agents/feeds.json,
// keeps the last 4 days of dated items and writes <out>/latest.json, which the
// website searches before answering. Run by .github/workflows/news.yml.
//
//   node agents/news.mjs [outDir]
//
// Sends a generic User-Agent (no personal or repository details).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex, parseFeed } from './newslib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2] || process.env.NEWS_OUT || 'news-out';
const UA = 'JeeA-news-collector/1.0 (+RSS reader)';
const TIMEOUT_MS = 20_000;

async function fetchText(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (!/<(rss|feed|rdf:RDF)\b/i.test(text.slice(0, 4000))) throw new Error('not an RSS or Atom feed');
    return text;
  } finally {
    clearTimeout(t);
  }
}

async function readSource(source) {
  const errors = [];
  for (const url of source.urls) {
    try {
      const items = parseFeed(await fetchText(url));
      if (!items.length) throw new Error('feed has no items');
      return { source, url, ok: true, items };
    } catch (e) {
      errors.push(`${url}: ${e.name === 'AbortError' ? 'timeout' : e.message}`);
    }
  }
  return { source, ok: false, error: errors.join(' | ') };
}

async function pool(list, n, fn) {
  const out = new Array(list.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => {
    while (i < list.length) {
      const k = i++;
      out[k] = await fn(list[k]);
    }
  }));
  return out;
}

const { sources } = JSON.parse(await readFile(join(here, 'feeds.json'), 'utf8'));
const results = await pool(sources, 8, readSource);
const index = buildIndex(results, new Date());
await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, 'latest.json'), JSON.stringify(index));
await writeFile(join(OUT, 'README.md'), '# JeeA! trusted news\n\nWritten every hour by the News workflow from the feeds in `agents/feeds.json`. Do not edit by hand.\n');

const ok = index.sources.filter((s) => s.ok);
console.log(`Trusted news: ${index.items.length} items from ${ok.length} of ${index.sources.length} sources.`);
for (const s of index.sources) console.log(`${s.ok ? 'OK  ' : 'FAIL'} ${s.id.padEnd(14)} ${s.ok ? `${String(s.items).padStart(3)} recent items  ${s.url}` : s.error}`);
if (!ok.length) process.exit(1);
