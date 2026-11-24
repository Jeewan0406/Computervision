// Automatic web search for up-to-date answers.
//
// Pure logic plus network calls with an injectable fetch, so it can be unit
// tested in Node. No runtime imports on purpose (Node test runner).
//
// Sources, in the order they are shown:
//  1. Wikipedia "In the news" and "Current events", for news-like questions.
//  2. The site owner's JeeA Gateway `/v1/search` (Tavily web search with the
//     owner's key), when the site has a gateway and the owner set a key.
//  3. OpenAlex: recent scholarly works with abstracts (no key; the API sends
//     Access-Control-Allow-Origin: *), last 2 years, widened to 5 if too few.
//  4. Wikipedia article intros (Action API, `origin=*` = anonymous CORS).

export type WebMode = 'auto' | 'on' | 'off';

/** What a result is, so the model can judge it ("Wikipedia does not count"). */
export type SourceKind = 'scholarly' | 'web' | 'wikipedia' | 'wiki-news';

export interface WebSource {
  n: number;
  title: string;
  url: string;
  snippet: string;
  site: string;
  /** ISO date of publication or last edit, when known. */
  date?: string;
  kind?: SourceKind;
  /** Which part of the source the snippet is, e.g. "Abstract". */
  part?: string;
  authors?: string[];
  /** Journal, repository or publisher. */
  venue?: string;
  doi?: string;
  /** e.g. "article", "review", "preprint", "book-chapter". */
  workType?: string;
}

export interface WebDecision {
  search: boolean;
  /** News-like: also read Wikipedia's "In the news" and "Current events". */
  news: boolean;
  reason: string;
}

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

// ---------------------------------------------------------------------------
// 1. Should this message search the web?
// ---------------------------------------------------------------------------

/** Words that point to facts that change over time. */
const FRESH =
  /\b(latest|newest|recent(ly)?|current(ly)?|today'?s?|tonight|yesterday|tomorrow|this (week|month|year|season)|last (week|month|year|night)|right now|nowadays|these days|so far|as of|up ?to ?date|news|headlines?|breaking|live|updates?|updated|price[sd]?|costs?|stocks?|shares?|market|exchange rate|inflation|weather|forecast|temperature|scores?|standings|fixtures?|won|wins|winners?|champions?|elections?|polls?|results?|released?|releases|launch(ed|es)?|announce[ds]?|versions?|ceo|president|prime minister|king|minister|government|population|ranking|richest|tallest|biggest|record|deadline|schedule|upcoming|happen(ed|ing|s)?|still|anymore|status|20[2-9]\d)\b/i;

/** Strong signals: search even inside a writing request. */
const STRONG = /\b(latest|today'?s?|this week|right now|news|headlines?|breaking|current(ly)?|up ?to ?date|search (the )?(web|internet|online)|look (it )?up|google)\b/i;

/** Explicit request to search. */
const ASKED = /\b(search|look up|browse|check online|find online|on the (web|internet)|from the (web|internet)|internet|online sources?|sources?|cite)\b/i;

const CODE = /```|\b(function|const|let|var|def|class|return|import|export|public|static|void|async|await|lambda)\s+[\w({]|console\.log|#include|<\/?[a-z]+[^>]*>|\bSELECT\b[\s\S]+\bFROM\b|=>|\b(regex|stack ?trace|traceback|compile error|syntax error|npm|pip install|git (commit|push|pull))\b/i;

const CREATIVE = /^(please\s+)?(write|compose|draft|rewrite|rephrase|reword|translate|summari[sz]e|paraphrase|proofread|correct|fix|improve|edit|polish|create|generate|make|design|imagine|brainstorm|tell me a (story|joke)|give me (a|some) (name|idea|joke)s?)\b|\b(poem|haiku|story|song|lyrics|essay|joke|limerick|cover letter|email to)\b/i;

const MATH = /^[\d\s+\-*/^().,=%x×÷√π]+\??$|\b(solve|integral|derivative|differentiate|integrate|simplify|factori[sz]e|equation|prove that|calculate)\b/i;

const CHAT = /^(hi|hello|hey|yo|thanks|thank you|thx|ok(ay)?|cool|nice|great|yes|no|yep|nope|bye|good (morning|afternoon|evening|night)|how are you)\b[\s!.?]*$/i;

const QUESTION = /^(who|whom|whose|what|what's|when|where|which|how (much|many|old|tall|far|big|long|often)|is|are|was|were|did|does|do|has|have|will|can)\b/i;

/** A name, acronym or number in the text (a likely factual lookup). */
function hasEntity(text: string): boolean {
  const words = text.split(/\s+/).slice(1).join(' ');
  return /\b[A-Z][a-z]{2,}/.test(words) || /\b[A-Z]{2,}\b/.test(text) || /\b\d{3,4}\b/.test(text);
}

/** Decide, without asking the user, whether a message needs fresh web facts. */
export function webDecision(raw: string, mode: WebMode = 'auto'): WebDecision {
  const text = mainText(raw);
  const news = /\b(news|headlines?|breaking|what('?s| is) happening|happen(ed|ing) (today|this week|recently)|latest (events|updates))\b/i.test(text);
  if (mode === 'off') return { search: false, news: false, reason: 'web search is off' };
  if (!text.trim()) return { search: false, news: false, reason: 'empty' };
  if (CHAT.test(text.trim())) return { search: false, news: false, reason: 'greeting, not a question' };
  if (mode === 'on') return { search: true, news, reason: 'web search is on for every question' };

  if (ASKED.test(text) && !CODE.test(text)) return { search: true, news, reason: 'you asked for the web' };
  const strong = STRONG.test(text);
  if (CODE.test(raw) && !strong) return { search: false, news: false, reason: 'code question' };
  if (MATH.test(text.trim()) && !strong) return { search: false, news: false, reason: 'maths' };
  if (CREATIVE.test(text.trim()) && !strong) return { search: false, news: false, reason: 'writing task' };
  if (FRESH.test(text)) return { search: true, news, reason: 'facts that change over time' };
  if (QUESTION.test(text.trim()) && hasEntity(text) && text.length <= 300) return { search: true, news, reason: 'factual question' };
  return { search: false, news: false, reason: 'general question' };
}

/** The user's own words, without attached files. */
export function mainText(raw: string): string {
  return raw.split(/\n\n\*\*Attached file:/)[0].trim();
}

// ---------------------------------------------------------------------------
// 2. Search words
// ---------------------------------------------------------------------------

const STOP = new Set(
  ('a an the of in on at to for from by with about and or but is are was were be been being am do does did done has have had ' +
    'what whats who whos whom whose when where which why how much many tell me please can could would should will shall you your ' +
    'i my we our us it its this that these those there here give show find search look up check web internet online google ' +
    'latest newest recent recently current currently today todays now right nowadays news headlines update updates updated ' +
    'know want need some any just really very also info information details explain describe say said ' +
    'he she him his her hers they them their theirs one ones then so than too').split(' '),
);

/** Turn a question into a short keyword query, e.g.
 * "Who is the current prime minister of Bhutan?" -> "prime minister Bhutan". */
export function searchQuery(raw: string, previous?: string): string {
  const text = mainText(raw).slice(0, 400);
  const words = text
    .replace(/[“”"«»]/g, ' ')
    .replace(/[^\p{L}\p{N}\s'.\-+#&]/gu, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^['.\-]+|['.\-]+$/g, ''))
    .filter(Boolean);
  let kept = words.filter((w) => !STOP.has(w.toLowerCase().replace(/'s$/, '').replace(/'/g, '')));
  // Follow-ups like "and his age?" borrow names from the previous question.
  if (kept.length < 2 && previous) {
    const prev = searchQuery(previous);
    kept = [...prev.split(' ').filter(Boolean), ...kept];
  }
  const q = [...new Set(kept)].slice(0, 10).join(' ');
  return q || text.slice(0, 120);
}

// ---------------------------------------------------------------------------
// 3. Fetching
// ---------------------------------------------------------------------------

const WIKI_API = (lang = 'en') => `https://${/^[a-z-]{2,12}$/.test(lang) ? lang : 'en'}.wikipedia.org/w/api.php`;
const WIKI_PAGE = (title: string, lang = 'en') => `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;

/** Plain text from a small HTML fragment. */
export function stripHtml(html: string): string {
  return html
    .replace(/<(script|style|sup)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#8211;|&ndash;/g, '–')
    .replace(/&#8212;|&mdash;/g, '—')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/** List items (<li>) of a Wikipedia page's HTML as plain text. */
export function listItems(html: string): string[] {
  const out: string[] = [];
  const re = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    // Nested lists repeat text; keep only the item's own first line.
    const own = m[1].split(/<ul\b/i)[0];
    const t = stripHtml(own).replace(/\s+/g, ' ').trim();
    if (t.length >= 25 && !/^(Ongoing|Recent deaths|Nominate an article|More…|Archive)\b/i.test(t)) out.push(t);
  }
  return out;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n).replace(/\s+\S*$/, '')}…` : s);

async function getJson(fetchFn: FetchFn, url: string, signal: AbortSignal, init?: RequestInit): Promise<unknown> {
  const res = await fetchFn(url, { ...init, signal });
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
  return res.json();
}

/** Wikipedia article intros for a keyword query (one request). */
export async function wikipediaSearch(q: string, fetchFn: FetchFn, signal: AbortSignal, limit = 3, lang = 'en'): Promise<WebSource[]> {
  const url =
    `${WIKI_API(lang)}?action=query&format=json&formatversion=2&origin=*&redirects=1` +
    `&generator=search&gsrlimit=${limit}&gsrsearch=${encodeURIComponent(q)}` +
    `&prop=extracts|info&inprop=url&exintro=1&explaintext=1&exchars=1200&exlimit=${limit}`;
  const data = (await getJson(fetchFn, url, signal)) as {
    query?: { pages?: { title: string; extract?: string; fullurl?: string; touched?: string; index?: number; missing?: boolean }[] | Record<string, { title: string; extract?: string; fullurl?: string; touched?: string; index?: number }> };
  };
  const pages = data.query?.pages ? (Array.isArray(data.query.pages) ? data.query.pages : Object.values(data.query.pages)) : [];
  return pages
    .filter((p) => p.extract && p.extract.trim().length > 40)
    .sort((a, b) => (a.index ?? 99) - (b.index ?? 99))
    .map((p) => ({
      n: 0,
      title: p.title,
      url: p.fullurl || WIKI_PAGE(p.title, lang),
      snippet: clip(p.extract!.replace(/\s+/g, ' ').trim(), 900),
      site: 'Wikipedia',
      date: p.touched?.slice(0, 10),
      kind: 'wikipedia' as const,
      part: 'Introduction (summary at the top of the article)',
    }));
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Title of Wikipedia's daily "Current events" page for a UTC date. */
export function currentEventsTitle(d: Date): string {
  return `Portal:Current events/${d.getUTCFullYear()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

async function wikiParse(page: string, fetchFn: FetchFn, signal: AbortSignal): Promise<string> {
  const url = `${WIKI_API()}?action=parse&format=json&formatversion=2&origin=*&prop=text&redirects=1&page=${encodeURIComponent(page)}`;
  const data = (await getJson(fetchFn, url, signal)) as { parse?: { text?: string | { '*': string } } };
  const t = data.parse?.text;
  return typeof t === 'string' ? t : t?.['*'] ?? '';
}

/** Today's headlines from Wikipedia ("In the news" + the last two days of "Current events"). */
export async function wikipediaNews(q: string, fetchFn: FetchFn, signal: AbortSignal, now = new Date()): Promise<WebSource[]> {
  const yesterday = new Date(now.getTime() - 86_400_000);
  const pages = [
    { title: 'Template:In the news', date: now },
    { title: currentEventsTitle(now), date: now },
    { title: currentEventsTitle(yesterday), date: yesterday },
  ];
  const got = await Promise.allSettled(pages.map((p) => wikiParse(p.title, fetchFn, signal)));
  const terms = q.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const out: WebSource[] = [];
  got.forEach((r, i) => {
    if (r.status !== 'fulfilled' || !r.value) return;
    let items = listItems(r.value);
    if (terms.length) {
      const hits = items.filter((t) => terms.some((w) => t.toLowerCase().includes(w)));
      // A general "latest news" question has no topic words left: keep the top items.
      items = hits.length ? hits : terms.length <= 1 ? items : [];
    }
    if (!items.length) return;
    const p = pages[i];
    out.push({
      n: 0,
      title: p.title === 'Template:In the news' ? 'Wikipedia: In the news' : `Wikipedia: Current events, ${p.title.split('/')[1]}`,
      url: WIKI_PAGE(p.title === 'Template:In the news' ? 'Main Page' : p.title),
      snippet: clip(items.slice(0, 6).map((t) => `• ${t}`).join('\n'), 1100),
      site: 'Wikipedia',
      date: p.date.toISOString().slice(0, 10),
      kind: 'wiki-news',
      part: 'News list items',
    });
  });
  return out;
}

/** Web results through the site owner's gateway (Tavily). Null = not available. */
export async function gatewaySearch(gateway: string, q: string, news: boolean, fetchFn: FetchFn, signal: AbortSignal): Promise<WebSource[] | null> {
  try {
    const data = (await getJson(fetchFn, `${gateway.replace(/\/+$/, '')}/v1/search`, signal, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: q, max_results: 5, topic: news ? 'news' : 'general' }),
    })) as { results?: { title?: string; url?: string; content?: string; published_date?: string }[] };
    return (data.results ?? [])
      .filter((r) => r.url && r.content)
      .map((r) => ({
        n: 0,
        title: r.title || hostOf(r.url!),
        url: r.url!,
        snippet: clip(r.content!.replace(/\s+/g, ' ').trim(), 900),
        site: hostOf(r.url!),
        date: r.published_date ? isoDate(r.published_date) : undefined,
        kind: 'web' as const,
        part: 'Extract from the page',
      }));
  } catch (e) {
    if ((e as { status?: number }).status && [404, 405, 501].includes((e as { status: number }).status)) return null;
    throw e;
  }
}

/** Plain-text abstract from OpenAlex's inverted index (word -> positions). */
export function abstractFromIndex(inv: Record<string, number[]> | null | undefined): string {
  if (!inv) return '';
  const words: string[] = [];
  for (const [w, positions] of Object.entries(inv)) for (const p of positions) words[p] = w;
  return words.filter((w) => w !== undefined).join(' ').replace(/\s+/g, ' ').trim();
}

interface OAWork {
  id?: string;
  doi?: string | null;
  display_name?: string | null;
  publication_date?: string | null;
  type?: string | null;
  primary_location?: { landing_page_url?: string | null; version?: string | null; source?: { display_name?: string | null } | null } | null;
  authorships?: { author?: { display_name?: string | null } | null }[] | null;
  abstract_inverted_index?: Record<string, number[]> | null;
}

/** Recent scholarly works (with abstracts) from OpenAlex. Last 2 years; widened to 5 when fewer than 2 are found. */
export async function openAlexSearch(q: string, fetchFn: FetchFn, signal: AbortSignal, now = new Date(), limit = 3): Promise<WebSource[]> {
  const fields = 'id,doi,display_name,publication_date,type,primary_location,authorships,abstract_inverted_index';
  const get = async (years: number) => {
    const from = new Date(now.getTime());
    from.setUTCFullYear(from.getUTCFullYear() - years);
    const url =
      `https://api.openalex.org/works?search=${encodeURIComponent(q)}` +
      `&filter=from_publication_date:${from.toISOString().slice(0, 10)},has_abstract:true,is_retracted:false` +
      `&per-page=${limit}&select=${fields}`;
    const data = (await getJson(fetchFn, url, signal)) as { results?: OAWork[] };
    return data.results ?? [];
  };
  let works = await get(2);
  if (works.length < 2) works = await get(5);
  const out: WebSource[] = [];
  for (const w of works) {
    const abstract = abstractFromIndex(w.abstract_inverted_index);
    const title = (w.display_name ?? '').trim();
    if (!title || abstract.length < 80) continue;
    const doi = w.doi ? w.doi.replace(/^https?:\/\/doi\.org\//i, '') : undefined;
    const url = w.doi || w.primary_location?.landing_page_url || w.id || '';
    if (!url) continue;
    const venue = w.primary_location?.source?.display_name ?? undefined;
    const preprint = w.primary_location?.version === 'submittedVersion';
    out.push({
      n: 0,
      title,
      url,
      snippet: clip(abstract, 1000),
      site: venue || hostOf(url),
      date: w.publication_date ?? undefined,
      kind: 'scholarly',
      part: 'Abstract',
      authors: (w.authorships ?? []).map((a) => a.author?.display_name ?? '').filter(Boolean).slice(0, 20),
      venue,
      doi,
      workType: preprint ? 'preprint' : w.type ?? undefined,
    });
  }
  return out;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function isoDate(s: string): string | undefined {
  const t = Date.parse(s);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString().slice(0, 10);
}

/** Abort after `ms`, or when the parent signal aborts. */
export function timeoutSignal(ms: number, parent?: AbortSignal): { signal: AbortSignal; done: () => void } {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(new Error('timeout')), ms);
  const onAbort = () => c.abort(parent?.reason);
  parent?.addEventListener('abort', onAbort, { once: true });
  if (parent?.aborted) c.abort(parent.reason);
  return {
    signal: c.signal,
    done: () => {
      clearTimeout(t);
      parent?.removeEventListener('abort', onAbort);
    },
  };
}

/** Does the gateway answer /v1/search? Remembered for the page's life. */
let gatewaySearchOff = false;
export const resetGatewaySearch = () => void (gatewaySearchOff = false);

/** Search every available source in parallel. Never throws for a single failed source. */
export async function webSearch(opts: {
  query: string;
  news: boolean;
  gateway?: string | null;
  fetchFn?: FetchFn;
  signal?: AbortSignal;
  timeoutMs?: number;
  now?: Date;
  max?: number;
  /** Also search scholarly works (OpenAlex). Default true. */
  scholarly?: boolean;
}): Promise<{ sources: WebSource[]; errors: string[] }> {
  const fetchFn = opts.fetchFn ?? ((u, i) => fetch(u, i));
  const { signal, done } = timeoutSignal(opts.timeoutMs ?? 9000, opts.signal);
  const errors: string[] = [];
  const useGateway = !!opts.gateway && !gatewaySearchOff;
  // Listed in the order results are shown: news first (freshest), then web
  // results, then encyclopedia intros.
  const tasks: Promise<WebSource[]>[] = [];
  if (opts.news) tasks.push(wikipediaNews(opts.query, fetchFn, signal, opts.now));
  if (useGateway) {
    tasks.push(
      gatewaySearch(opts.gateway!, opts.query, opts.news, fetchFn, signal).then((r) => {
        if (r === null) gatewaySearchOff = true;
        return r ?? [];
      }),
    );
  }
  if (opts.scholarly !== false) tasks.push(openAlexSearch(opts.query, fetchFn, signal, opts.now));
  tasks.push(wikipediaSearch(opts.query, fetchFn, signal, 2));
  const settled = await Promise.allSettled(tasks);
  done();
  if (opts.signal?.aborted) throw opts.signal.reason ?? new DOMException('Aborted', 'AbortError');
  const seen = new Set<string>();
  const all: WebSource[] = [];
  for (const r of settled) {
    if (r.status === 'rejected') {
      errors.push(String((r.reason as Error)?.message ?? r.reason));
      continue;
    }
    for (const s of r.value) {
      const key = s.url.replace(/[#?].*$/, '').toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(s);
    }
  }
  const sources = all.slice(0, opts.max ?? 8).map((s, i) => ({ ...s, n: i + 1 }));
  return { sources, errors };
}

// ---------------------------------------------------------------------------
// 4. Prompt
// ---------------------------------------------------------------------------

/** "Today is Sunday, 22 November 2026, 14:05 (Asia/Thimphu)." */
export function dateLine(now = new Date(), timeZone?: string): string {
  let tz = timeZone;
  try {
    tz ??= Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    /* no Intl */
  }
  const opts: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz };
  let s: string;
  try {
    s = new Intl.DateTimeFormat('en-GB', opts).format(now);
  } catch {
    s = now.toUTCString();
    tz = 'UTC';
  }
  return `Today is ${s.replace(' at ', ', ')}${tz ? ` (${tz})` : ''}.`;
}

const KIND_LABEL: Record<SourceKind, string> = {
  scholarly: 'scholarly work',
  web: 'web page',
  wikipedia: 'Wikipedia article (does not count as evidence under strict source rules)',
  'wiki-news': 'Wikipedia news list (does not count as evidence under strict source rules)',
};

/** One numbered result, with everything a careful answer needs to cite it. */
export function describeSource(s: WebSource): string {
  const lines = [`[${s.n}] ${s.title}`];
  const kind = s.kind ? KIND_LABEL[s.kind] : 'web page';
  lines.push(`Type: ${kind}${s.workType ? ` (${s.workType})` : ''}`);
  if (s.authors?.length) lines.push(`Authors: ${s.authors.join('; ')}`);
  const where = s.venue || s.site;
  if (s.date || where) lines.push(`${s.kind === 'wikipedia' ? 'Last edited' : 'Published'}: ${s.date ?? 'date not given'}${where ? ` · ${where}` : ''}`);
  if (s.doi) lines.push(`DOI: ${s.doi}`);
  lines.push(`URL: ${s.url}`);
  lines.push(`Text shown (${s.part ?? 'extract'}, the only part you have seen): ${s.snippet}`);
  return lines.join('\n');
}

/** System message with the date and numbered web results.
 * `rules`: the site owner's answer rules are on, so cite in their format. */
export function webPrompt(query: string, sources: WebSource[], now = new Date(), timeZone?: string, opts: { rules?: boolean } = {}): string {
  const head = dateLine(now, timeZone);
  if (!sources.length) {
    return `${head}\nWeb search results: a search for "${query}" found nothing useful (or could not be reached). Treat every outside fact as unverified, and say that your information may be out of date.`;
  }
  const cite = opts.rules
    ? 'Cite the results you use in the format the answer rules require, using each result\'s URL exactly. Do not cite them as bare numbers. JeeA! also lists them as chips under your answer.'
    : 'Cite the results you use with their number in square brackets, like [1] or [2][3], right after the sentence.';
  return [
    head,
    `Web search results for "${query}", fetched just now (${sources.length}):`,
    '',
    sources.map(describeSource).join('\n\n'),
    '',
    'How to use them: these results are newer than your training data, so prefer them for facts that change over time (dates, people in office, prices, scores, versions, news, recent research).',
    cite,
    'If results disagree, say so and prefer the newest strong source. If they do not answer the question, say that briefly, then answer from your own knowledge and mark it as unverified and possibly out of date.',
    'Never invent a source, author, date, DOI or link that is not listed above.',
  ].join('\n');
}

/** Turn "[2]" in an answer into Markdown links to the sources. */
export function linkCitations(md: string, sources: WebSource[] | undefined): string {
  if (!sources?.length) return md;
  const byN = new Map(sources.map((s) => [s.n, s.url]));
  const parts = md.split(/(```[\s\S]*?```|`[^`\n]*`)/);
  return parts
    .map((p, i) => (i % 2 ? p : p.replace(/\[(\d{1,2})\](?![(:\]])/g, (all, n: string) => {
      const url = byN.get(Number(n));
      return url ? `[\\[${n}\\]](${url} "Source ${n}")` : all;
    })))
    .join('');
}
