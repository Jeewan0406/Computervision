// Automatic web search: when to search, what to search and how results are used. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  webDecision, searchQuery, webSearch, webPrompt, linkCitations,
  dateLine, resetGatewaySearch, abstractFromIndex, openAlexSearch, describeSource, isTrustedUrl,
} from '../src/lib/web.ts';
import { apaName, apaAuthors, apaInText, apaReference, apaSuffixes, withApa } from '../src/lib/apa.ts';
import { dateHint, topicWords, searchNews, type NewsIndex } from '../src/lib/news.ts';
import { readFileSync } from 'node:fs';

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

test('On searches every question (not bare greetings); Off never searches', () => {
  for (const t of ['What is a neural network?', 'Explain how photosynthesis works', 'Write a poem about mountains', 'How do I sort a list in Python?']) {
    assert.equal(webDecision(t, 'on').search, true, t);
  }
  assert.equal(webDecision('hi', 'on').search, false);
  assert.equal(webDecision('Thanks!', 'on').search, false);
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

test('webSearch: trusted sources only; gateway asked once; Wikipedia and blogs dropped', async () => {
  resetGatewaySearch();
  const calls: string[] = [];
  const oa = { results: [{ id: 'https://openalex.org/W9', doi: 'https://doi.org/10.1/abc', display_name: 'Hydropower in the Himalaya', publication_date: '2025-05-01', type: 'article',
    primary_location: { version: 'publishedVersion', source: { display_name: 'Energy Policy' } }, authorships: [{ author: { display_name: 'Karma Dorji' } }],
    abstract_inverted_index: Object.fromEntries('Hydropower is the main source of electricity in Bhutan and most of it is exported to India today.'.split(' ').map((w, i) => [w + (i ? '' : ''), [i]])) }] };
  const noKey = async (u: string) => {
    calls.push(u);
    if (u.startsWith('https://gw.test')) return new Response('{}', { status: 501 });
    return ok(oa);
  };
  const trusted = async () => [
    { n: 0, title: 'Hydropower deal signed', url: 'https://news.un.org/en/story/1', snippet: 'A deal.', site: 'UN News', date: '2026-11-24T08:00:00Z', kind: 'official' as const, org: 'United Nations' },
    { n: 0, title: 'Hydropower (encyclopedia)', url: 'https://en.wikipedia.org/wiki/Hydropower', snippet: 'x', site: 'Wikipedia', kind: 'web' as const },
    { n: 0, title: 'My blog on dams', url: 'https://someone.medium.com/dams', snippet: 'x', site: 'Medium', kind: 'web' as const },
  ];
  const a = await webSearch({ query: 'hydropower Bhutan', news: true, gateway: 'https://gw.test', fetchFn: noKey, trusted });
  assert.deepEqual(a.sources.map((s) => [s.n, s.kind, s.site]), [[1, 'official', 'UN News'], [2, 'scholarly', 'Energy Policy']]);
  assert.ok(!calls.some((u) => /wikipedia/.test(u)), 'Wikipedia is never called');
  calls.length = 0;
  await webSearch({ query: 'hydropower Bhutan', news: false, gateway: 'https://gw.test', fetchFn: noKey, trusted });
  assert.ok(!calls.some((u) => u.startsWith('https://gw.test')), 'a gateway without search is not asked again');

  resetGatewaySearch();
  const withKey = async (u: string) => {
    if (u === 'https://gw.test/v1/search') return ok({ results: [
      { title: 'Energy report', url: 'https://www.adb.org/x', content: 'Report text', published_date: '2026-11-20' },
      { title: 'Wiki copy', url: 'https://en.wikipedia.org/wiki/x', content: 'x' },
    ] });
    return ok({ results: [] });
  };
  const b = await webSearch({ query: 'hydropower Bhutan', news: false, gateway: 'https://gw.test', fetchFn: withKey });
  assert.deepEqual(b.sources.map((s) => [s.kind, s.site]), [['web', 'adb.org']]);
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

test('prompt has the date, labelled numbered sources and citation rules; [n] become links', () => {
  const now = new Date('2026-11-22T10:00:00Z');
  const src = withApa([{ n: 1, title: 'Bhutan joins climate pact', url: 'https://news.un.org/en/story/1', snippet: 'Text', site: 'UN News', org: 'United Nations', date: '2026-11-21T09:00:00Z', kind: 'official' as const, part: "Summary from the organisation's feed" }]);
  const p = webPrompt('Bhutan', src, now, 'Asia/Thimphu');
  assert.match(p, /^Today is Sunday,? 22 November 2026, 16:00 \(Asia\/Thimphu\)\./);
  assert.match(p, /\[1\] Bhutan joins climate pact\nType: official publication \(government or intergovernmental body\)\nAuthor \(organisation\): United Nations\nPublished: 2026-11-21 · UN News\nURL: https:\/\/news\.un\.org\/en\/story\/1/);
  assert.match(p, /APA 7th in-text: \(United Nations, 2026\)\nAPA 7th reference: United Nations\. \(2026, November 21\)\. \*Bhutan joins climate pact\*\. UN News\. https:\/\/news\.un\.org\/en\/story\/1/);
  assert.match(p, /copy its "APA 7th in-text" citation exactly/);
  assert.match(p, /Never cite a bare number/);
  assert.match(p, /never invent times of day/);
  const withRules = webPrompt('Bhutan', src, now, 'UTC', { rules: true });
  assert.match(withRules, /format the answer rules require/);
  assert.match(webPrompt('x', [], now, 'UTC'), /found nothing useful/);
  assert.match(dateLine(now, 'UTC'), /10:00 \(UTC\)/);
  const md = linkCitations('Thimphu is the capital [1]. Code `[1]` and [7] stay.', src);
  assert.equal(md, 'Thimphu is the capital [\\[1\\]](https://news.un.org/en/story/1 "Source 1"). Code `[1]` and [7] stay.');
});

test('OpenAlex: abstract rebuilt from the inverted index', () => {
  assert.equal(abstractFromIndex({ Solar: [0], power: [1, 4], grows: [2], fast: [3] }), 'Solar power grows fast power');
  assert.equal(abstractFromIndex(null), '');
});

test('OpenAlex: last 2 years first, widened to 5, peer-reviewed metadata kept', async () => {
  const urls: string[] = [];
  const abs = { Hydropower: [0], supplies: [1], most: [2], of: [3], 'Bhutan\'s': [4], electricity: [5], and: [6], exports: [7], the: [8], rest: [9], 'to': [10], 'India,': [11], 'study': [12], 'finds.': [13] };
  const work = (i: number, version = 'publishedVersion') => ({
    id: `https://openalex.org/W${i}`, doi: `https://doi.org/10.1000/x${i}`, display_name: `Paper ${i}`, publication_date: '2025-06-01', type: 'article',
    primary_location: { landing_page_url: 'https://journal.example/x', version, source: { display_name: 'Energy Policy' } },
    authorships: [{ author: { display_name: 'Karma Dorji' } }, { author: { display_name: 'Pema Wangmo' } }],
    abstract_inverted_index: abs,
  });
  const fetchFn = async (u: string) => {
    urls.push(u);
    const from = new URL(u).searchParams.get('filter') ?? '';
    return ok({ results: from.includes('from_publication_date:2024-11-22') ? [work(1)] : [work(1), work(2, 'submittedVersion')] });
  };
  const r = await openAlexSearch('hydropower Bhutan', fetchFn, new AbortController().signal, new Date('2026-11-22T10:00:00Z'));
  assert.equal(urls.length, 2, 'only one result in 2 years, so it widened to 5');
  const p0 = new URL(urls[0]).searchParams;
  assert.equal(p0.get('search'), 'hydropower Bhutan');
  assert.equal(p0.get('filter'), 'from_publication_date:2024-11-22,has_abstract:true,is_retracted:false');
  assert.equal(p0.get('per-page'), '5');
  assert.match(p0.get('select') ?? '', /abstract_inverted_index/);
  assert.match(new URL(urls[1]).searchParams.get('filter') ?? '', /from_publication_date:2021-11-22/);
  assert.equal(r.length, 2);
  assert.deepEqual([r[0].kind, r[0].part, r[0].doi, r[0].venue, r[0].workType], ['scholarly', 'Abstract', '10.1000/x1', 'Energy Policy', 'article']);
  assert.equal(r[1].workType, 'preprint');
  assert.deepEqual(r[0].authors, ['Karma Dorji', 'Pema Wangmo']);
  assert.match(r[0].snippet, /^Hydropower supplies most of Bhutan's electricity/);
  const d = describeSource({ ...r[0], n: 3 });
  assert.match(d, /^\[3\] Paper 1\nType: scholarly work \(article\)\nAuthors: Karma Dorji; Pema Wangmo\nPublished: 2025-06-01 · Energy Policy\nDOI: 10\.1000\/x1\nURL: https:\/\/doi\.org\/10\.1000\/x1\nText shown \(Abstract, the only part you have seen\)/);
});

test('answer rules files: owner text kept whole, app notes cover the conflicts', () => {
  const rules = readFileSync(new URL('../src/rules/answer-rules.md', import.meta.url), 'utf8');
  for (let i = 0; i <= 13; i++) assert.match(rules, new RegExp(`^## ${i}\\. `, 'm'), `section ${i}`);
  assert.match(rules, /starting with #2CA02C, #1F77B4 and #D62728/);
  assert.match(rules, /never broken except in sentences saying "prefer"/);
  const ctx = readFileSync(new URL('../src/rules/jeea-context.md', import.meta.url), 'utf8');
  assert.match(ctx, /cannot open web pages yourself/);
  assert.match(ctx, /No Wikipedia, blogs, forums or social media are given/);
  assert.match(ctx, /APA 7th/);
  assert.match(ctx, /Never invent times of day/);
  assert.match(ctx, /no widget tool/);
});

test('APA 7th: names, author lists, in-text forms and references', () => {
  assert.equal(apaName('Karma Dorji'), 'Dorji, K.');
  assert.equal(apaName('Dorji, Karma'), 'Dorji, K.');
  assert.equal(apaName('J. R. R. Tolkien'), 'Tolkien, J. R. R.');
  assert.equal(apaName('Ludwig van Beethoven'), 'van Beethoven, L.');
  assert.equal(apaName('Jean-Paul Sartre'), 'Sartre, J.-P.');
  assert.equal(apaAuthors(['Karma Dorji', 'Pema Wangmo']), 'Dorji, K., & Wangmo, P.');
  const many = Array.from({ length: 22 }, (_, i) => `Author${i + 1} Name`);
  const list = apaAuthors(many.map((m, i) => `A${i} ${m.split(' ')[0]}`));
  assert.match(list, /, \. \. \. Author22, A\.$/);
  assert.equal(list.split('., ').length, 20, '19 names, then the dots and the last');
  const one = { title: 'A study', url: 'https://doi.org/10.1/x', date: '2025-03-01', authors: ['Karma Dorji'], venue: 'Energy Policy', doi: '10.1/x', style: 'scholarly' as const };
  assert.equal(apaInText(one), '(Dorji, 2025)');
  assert.equal(apaInText({ ...one, authors: ['Karma Dorji', 'Pema Wangmo'] }), '(Dorji & Wangmo, 2025)');
  assert.equal(apaInText({ ...one, authors: ['Karma Dorji', 'Pema Wangmo', 'Sonam Choden'] }), '(Dorji et al., 2025)');
  assert.equal(apaReference(one), 'Dorji, K. (2025). A study. *Energy Policy*. https://doi.org/10.1/x');
  const org = { title: 'Aid reaches Gaza', url: 'https://news.un.org/1', date: '2026-11-24T08:00:00Z', org: 'United Nations', venue: 'UN News', style: 'dated' as const };
  assert.equal(apaInText(org), '(United Nations, 2026)');
  assert.equal(apaReference(org), 'United Nations. (2026, November 24). *Aid reaches Gaza*. UN News. https://news.un.org/1');
  const bbc = { ...org, org: 'BBC News', venue: 'BBC News', title: 'Summit opens.' };
  assert.equal(apaReference(bbc), 'BBC News. (2026, November 24). *Summit opens*. https://news.un.org/1', 'site name left out when it is the author');
  // Same author and year: letters by title order.
  const s = apaSuffixes([{ ...org, title: 'Zebra' }, { ...org, title: 'Apple' }, one]);
  assert.deepEqual(s, ['b', 'a', '']);
  assert.equal(apaInText({ ...org, title: 'Zebra' }, 'b'), '(United Nations, 2026b)');
  assert.equal(apaReference({ ...org, title: 'Zebra' }, 'b'), 'United Nations. (2026b, November 24). *Zebra*. UN News. https://news.un.org/1');
});

const INDEX: NewsIndex = {
  version: 1,
  generatedAt: '2026-11-24T12:00:00Z',
  sources: [],
  items: [
    { t: 'Leaders agree climate finance deal', u: 'https://news.un.org/1', d: '2026-11-24T08:00:00Z', s: 'A climate finance deal was agreed.', o: 'United Nations', n: 'UN News', k: 'intergovernmental', f: 'un-news' },
    { t: 'Climate finance talks end', u: 'https://www.bbc.co.uk/news/2', d: '2026-11-24T09:00:00Z', s: 'Talks ended with a deal.', o: 'BBC News', k: 'news', f: 'bbc-world' },
    { t: 'Second BBC climate story', u: 'https://www.bbc.co.uk/news/3', d: '2026-11-24T10:00:00Z', s: 'Climate finance again.', o: 'BBC News', k: 'news', f: 'bbc-world' },
    { t: 'Third BBC climate story', u: 'https://www.bbc.co.uk/news/4', d: '2026-11-24T11:00:00Z', s: 'Climate finance once more.', o: 'BBC News', k: 'news', f: 'bbc-world' },
    { t: 'Mars rover finds clay', u: 'https://www.nasa.gov/5', d: '2026-11-22T05:00:00Z', s: 'Rover news.', o: 'NASA', k: 'government', f: 'nasa' },
    { t: 'Gene therapy trial results', u: 'https://www.nejm.org/6', d: '2026-11-20T12:00:00Z', s: 'A randomised trial.', o: 'New England Journal of Medicine', k: 'scholarly', f: 'nejm', a: ['Ann Lee', 'Raj Patel'] },
  ],
};

test('news index: dates in questions, topic words, diversity and filters', () => {
  const now = new Date('2026-11-24T12:00:00Z');
  assert.equal(dateHint('Global news on 24 Nov 2026', now), '2026-11-24');
  assert.equal(dateHint('What happened on November 22, 2026?', now), '2026-11-22');
  assert.equal(dateHint('news today', now), '2026-11-24');
  assert.equal(dateHint('news yesterday', now), '2026-11-23');
  assert.equal(dateHint('2026-11-20 events', now), '2026-11-20');
  assert.equal(dateHint('climate finance', now), null);
  assert.deepEqual(topicWords('Global news 24 Nov 2026'), []);
  assert.deepEqual(topicWords('climate finance deal news'), ['climate', 'finance', 'deal']);

  const day = searchNews(INDEX, 'Global news 24 Nov 2026', { text: 'Global news on 24 Nov 2026', now });
  assert.deepEqual(day.map((s) => s.url), ['https://news.un.org/1', 'https://www.bbc.co.uk/news/4', 'https://www.bbc.co.uk/news/3'], 'that day only, official first, then newest, at most 2 per organisation');
  const topic = searchNews(INDEX, 'climate finance deal', { now });
  assert.equal(topic[0].url, 'https://news.un.org/1', 'official source ranks first');
  assert.equal(topic.filter((s) => s.org === 'BBC News').length, 2);
  assert.equal(searchNews(INDEX, 'climate finance deal', { now, allowNews: false }).every((s) => s.kind !== 'news'), true);
  const med = searchNews(INDEX, 'gene therapy trial', { now });
  assert.deepEqual([med[0].kind, med[0].venue, med[0].authors], ['scholarly', 'New England Journal of Medicine', ['Ann Lee', 'Raj Patel']]);
  assert.equal(withApa(med)[0].apaInText, '(Lee & Patel, 2026)');
  assert.deepEqual(searchNews(null, 'x'), []);
  assert.equal(isTrustedUrl('https://en.wikipedia.org/wiki/X'), false);
  assert.equal(isTrustedUrl('https://www.who.int/news'), true);
});
