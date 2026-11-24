// Trusted-news collector: feed parsing and the index. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, buildIndex, textOf, toIso } from '../agents/newslib.mjs';
import { readFileSync } from 'node:fs';

const RSS = `<?xml version="1.0"?><rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>UN News</title>
<item><title><![CDATA[Gaza: aid convoys reach the north]]></title><link>https://news.un.org/en/story/2026/11/1</link>
<pubDate>Tue, 24 Nov 2026 08:15:00 GMT</pubDate><description>&lt;p&gt;Convoys carrying food &amp;amp; water arrived.&lt;/p&gt;</description><dc:creator>Jane Roe</dc:creator></item>
<item><title>Old story</title><link>https://news.un.org/en/story/2026/10/9</link><pubDate>Mon, 12 Oct 2026 08:00:00 GMT</pubDate></item>
<item><title>No date</title><link>https://news.un.org/en/story/x</link></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>GOV.UK</title>
<entry><title>New flood guidance</title><link rel="alternate" type="text/html" href="https://www.gov.uk/government/news/flood?a=1&amp;b=2"/>
<updated>2026-11-23T10:00:00Z</updated><summary type="html">Guidance &lt;b&gt;updated&lt;/b&gt; today.</summary><author><name>Environment Agency</name></author></entry>
</feed>`;

const RDF = `<?xml version="1.0"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<item rdf:about="https://www.dw.com/en/a-1"><title>Summit opens</title><link>https://www.dw.com/en/a-1</link><dc:date>2026-11-24T06:00:00Z</dc:date><description>Leaders meet.</description></item></rdf:RDF>`;

test('parses RSS 2.0, Atom and RSS 1.0 (RDF)', () => {
  const r = parseFeed(RSS);
  assert.equal(r.length, 3);
  assert.deepEqual([r[0].title, r[0].link, r[0].date, r[0].summary, r[0].authors], ['Gaza: aid convoys reach the north', 'https://news.un.org/en/story/2026/11/1', '2026-11-24T08:15:00.000Z', 'Convoys carrying food & water arrived.', ['Jane Roe']]);
  assert.equal(r[2].date, null);
  const a = parseFeed(ATOM);
  assert.deepEqual([a[0].title, a[0].link, a[0].date, a[0].summary, a[0].authors], ['New flood guidance', 'https://www.gov.uk/government/news/flood?a=1&b=2', '2026-11-23T10:00:00.000Z', 'Guidance updated today.', ['Environment Agency']]);
  const d = parseFeed(RDF);
  assert.deepEqual([d[0].link, d[0].date], ['https://www.dw.com/en/a-1', '2026-11-24T06:00:00.000Z']);
});

test('text helpers decode entities and strip tags', () => {
  assert.equal(textOf('<![CDATA[<p>Hi &amp; bye</p>]]>'), 'Hi & bye');
  assert.equal(textOf('Caf&#233; &#x2014; ok'), 'Café — ok');
  assert.equal(toIso('not a date'), null);
});

test('index keeps recent dated items, records failures and stays compact', () => {
  const now = new Date('2026-11-24T12:00:00Z');
  const un = { id: 'un-news', org: 'United Nations', site: 'UN News', type: 'intergovernmental' };
  const gov = { id: 'govuk', org: 'GOV.UK', type: 'government' };
  const bad = { id: 'x', org: 'X', type: 'news' };
  const idx = buildIndex([
    { source: un, url: 'https://news.un.org/feed', ok: true, items: parseFeed(RSS) },
    { source: gov, url: 'https://www.gov.uk/x.atom', ok: true, items: parseFeed(ATOM) },
    { source: bad, ok: false, error: 'HTTP 404' },
  ], now);
  assert.equal(idx.items.length, 2, 'old and undated items dropped');
  assert.deepEqual(idx.items.map((i) => i.f), ['un-news', 'govuk'], 'newest first');
  assert.deepEqual(Object.keys(idx.items[0]).sort(), ['a', 'd', 'f', 'k', 'n', 'o', 's', 't', 'u']);
  assert.equal(idx.items[0].o, 'United Nations');
  assert.deepEqual(idx.sources.map((s) => [s.id, s.ok, s.items, s.parsed, s.dated]), [['un-news', true, 1, 3, 2], ['govuk', true, 1, 1, 1], ['x', false, 0, 0, 0]]);
  assert.equal(idx.sources[2].error, 'HTTP 404');
});

test('feed list: only trusted source types, no Wikipedia or blogs', () => {
  const { sources } = JSON.parse(readFileSync(new URL('../agents/feeds.json', import.meta.url), 'utf8'));
  assert.ok(sources.length >= 25);
  for (const s of sources) {
    assert.ok(['intergovernmental', 'government', 'scholarly', 'news', 'maker'].includes(s.type), s.id);
    assert.ok(s.urls.length >= 1 && s.urls.every((u) => u.startsWith('https://')), s.id);
    assert.ok(!s.urls.some((u) => /wikipedia|medium\.com|blogspot|wordpress\.com|substack/i.test(u)), s.id);
  }
  assert.equal(new Set(sources.map((s) => s.id)).size, sources.length, 'ids are unique');
});
