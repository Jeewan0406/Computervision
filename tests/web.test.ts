// Automatic web search: when to search, what to search and how results are used. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  webDecision, searchQuery, wikipediaSearch, wikipediaNews, webSearch, webPrompt, linkCitations,
  currentEventsTitle, listItems, dateLine, resetGatewaySearch,
} from '../src/lib/web.ts';

test('Auto mode searches only when a message needs fresh facts', () => {
  const yes = [
    'Who is the current prime minister of Bhutan?',
    "What's the latest news today?",
    'What is the price of bitcoin?',
    'Who won the 2026 World Cup?',
    'Is Python 3.14 released yet?',
    'Write a summary of today\'s news',
    'Search the web for cheap flights to Paro',
    'When is the next SpaceX launch?',
  ];
  const no = [
    'hi',
    'Thanks!',
    '2+2*3',
    'Fix this code: ```js\nconst a = 1\n```',
    'Explain how photosynthesis works',
    'Write a poem about mountains',
    'What is a neural network?',
    'How do I sort a list in Python?',
    'Translate "good morning" into French',
  ];
  for (const t of yes) assert.equal(webDecision(t).search, true, t);
  for (const t of no) assert.equal(webDecision(t).search, false, t);
  assert.equal(webDecision("What's the latest news today?").news, true);
  assert.equal(webDecision('Who is the CEO of OpenAI?').news, false);
});

test('On and Off modes override the automatic choice', () => {
  assert.equal(webDecision('hi', 'on').search, true);
  assert.equal(webDecision('latest news', 'off').search, false);
});

test('attached files do not trigger a search', () => {
  assert.equal(webDecision('Please review this\n\n**Attached file: notes.txt**\n```\nlatest news today 2026\n```').search, false);
});

test('search words drop filler and borrow the topic for short follow-ups', () => {
  assert.equal(searchQuery('Who is the current prime minister of Bhutan?'), 'prime minister Bhutan');
  assert.equal(searchQuery('What is the latest version of Python?'), 'version Python');
  assert.equal(searchQuery('and his age?', 'Who is the current prime minister of Bhutan?'), 'prime minister Bhutan age');
  assert.equal(searchQuery("Who won the 2026 FIFA World Cup?"), 'won 2026 FIFA World Cup');
});

const ok = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });

test('Wikipedia search: one CORS-enabled request, results in search order', async () => {
  const urls: string[] = [];
  const fetchFn = async (u: string) => {
    urls.push(u);
    return ok({ query: { pages: [
      { title: 'Second', index: 2, extract: 'B'.repeat(60), fullurl: 'https://en.wikipedia.org/wiki/Second', touched: '2026-11-20T10:00:00Z' },
      { title: 'First', index: 1, extract: 'A'.repeat(60), fullurl: 'https://en.wikipedia.org/wiki/First', touched: '2026-11-21T10:00:00Z' },
      { title: 'Stub', index: 3, extract: 'short' },
    ] } });
  };
  const r = await wikipediaSearch('prime minister Bhutan', fetchFn, new AbortController().signal);
  assert.equal(urls.length, 1);
  assert.match(urls[0], /origin=\*/);
  assert.match(urls[0], /generator=search&gsrlimit=3&gsrsearch=prime%20minister%20Bhutan/);
  assert.match(urls[0], /exintro=1&explaintext=1/);
  assert.deepEqual(r.map((s) => s.title), ['First', 'Second']);
  assert.equal(r[0].date, '2026-11-21');
  assert.equal(r[0].site, 'Wikipedia');
});

test('news: daily Current events page names and list items', async () => {
  assert.equal(currentEventsTitle(new Date('2026-11-22T10:00:00Z')), 'Portal:Current events/2026 November 22');
  const items = listItems('<ul><li><b>Bhutan</b> holds a national election, with turnout of 70&#160;%.</li><li>Ongoing: x</li><li>Short</li></ul>');
  assert.deepEqual(items, ['Bhutan holds a national election, with turnout of 70 %.']);
  const pages: string[] = [];
  const fetchFn = async (u: string) => {
    const page = decodeURIComponent(new URL(u).searchParams.get('page') ?? '');
    pages.push(page);
    return ok({ parse: { text: page === 'Template:In the news' ? '<ul><li>Bhutan opens a new airport in Gelephu Mindfulness City.</li><li>A storm hits the Pacific coast of a far away land.</li></ul>' : '' } });
  };
  const r = await wikipediaNews('Bhutan airport', fetchFn, new AbortController().signal, new Date('2026-11-22T10:00:00Z'));
  assert.deepEqual(pages, ['Template:In the news', 'Portal:Current events/2026 November 22', 'Portal:Current events/2026 November 21']);
  assert.equal(r.length, 1);
  assert.match(r[0].snippet, /Gelephu/);
  assert.ok(!r[0].snippet.includes('storm'));
});

test('webSearch: gateway first, falls back to Wikipedia when the gateway has no search key', async () => {
  resetGatewaySearch();
  const calls: string[] = [];
  const wiki = { query: { pages: [{ title: 'Bhutan', index: 1, extract: 'Bhutan is a country in the Eastern Himalayas. '.repeat(3), fullurl: 'https://en.wikipedia.org/wiki/Bhutan' }] } };
  const noKey = async (u: string) => {
    calls.push(u);
    if (u.startsWith('https://gw.test')) return new Response('{}', { status: 501 });
    return ok(wiki);
  };
  const a = await webSearch({ query: 'Bhutan', news: false, gateway: 'https://gw.test', fetchFn: noKey });
  assert.deepEqual(a.sources.map((s) => [s.n, s.title]), [[1, 'Bhutan']]);
  assert.deepEqual(a.errors, []);
  calls.length = 0;
  await webSearch({ query: 'Bhutan', news: false, gateway: 'https://gw.test', fetchFn: noKey });
  assert.ok(!calls.some((u) => u.startsWith('https://gw.test')), 'a gateway without search is not asked again');

  resetGatewaySearch();
  const withKey = async (u: string, init?: RequestInit) => {
    if (u === 'https://gw.test/v1/search') {
      assert.equal(JSON.parse(String(init?.body)).query, 'Bhutan');
      return ok({ results: [{ title: 'Bhutan today', url: 'https://www.kuenselonline.com/x', content: 'Fresh news text', published_date: '2026-11-21' }] });
    }
    return ok(wiki);
  };
  const b = await webSearch({ query: 'Bhutan', news: false, gateway: 'https://gw.test', fetchFn: withKey });
  assert.deepEqual(b.sources.map((s) => [s.n, s.site]), [[1, 'kuenselonline.com'], [2, 'Wikipedia']]);
  assert.equal(b.sources[0].date, '2026-11-21');
});

test('webSearch: a failing source is reported, not thrown; stopping throws', async () => {
  resetGatewaySearch();
  const down = async () => { throw new TypeError('Failed to fetch'); };
  const r = await webSearch({ query: 'x', news: false, fetchFn: down });
  assert.deepEqual(r.sources, []);
  assert.match(r.errors[0], /Failed to fetch/);
  const ctrl = new AbortController();
  const slow = (_u: string, init?: RequestInit) => new Promise<Response>((_, rej) => init?.signal?.addEventListener('abort', () => rej(new DOMException('Aborted', 'AbortError'))));
  const p = webSearch({ query: 'x', news: false, fetchFn: slow, signal: ctrl.signal });
  ctrl.abort();
  await assert.rejects(p);
});

test('prompt has the date, numbered sources and citation rules; [n] become links', () => {
  const now = new Date('2026-11-22T10:00:00Z');
  const src = [{ n: 1, title: 'Bhutan', url: 'https://en.wikipedia.org/wiki/Bhutan', snippet: 'Text', site: 'Wikipedia', date: '2026-11-21' }];
  const p = webPrompt('Bhutan', src, now, 'Asia/Thimphu');
  assert.match(p, /^Today is Sunday,? 22 November 2026, 16:00 \(Asia\/Thimphu\)\./);
  assert.match(p, /\[1\] Bhutan \(Wikipedia, 2026-11-21\)\nhttps:\/\/en\.wikipedia\.org\/wiki\/Bhutan/);
  assert.match(p, /Cite the results you use/);
  assert.match(webPrompt('x', [], now, 'UTC'), /found nothing useful/);
  assert.match(dateLine(now, 'UTC'), /10:00 \(UTC\)/);
  const md = linkCitations('Thimphu is the capital [1]. Code `[1]` and [7] stay.', src);
  assert.equal(md, 'Thimphu is the capital [\\[1\\]](https://en.wikipedia.org/wiki/Bhutan "Source 1"). Code `[1]` and [7] stay.');
});
