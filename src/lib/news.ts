// Search the trusted-news index (news-data/latest.json, written every hour by
// .github/workflows/news.yml). Pure functions plus a cached fetch.
import type { WebSource } from './web';

export type NewsType = 'intergovernmental' | 'government' | 'scholarly' | 'news';

/** One item, with short keys to keep the file small. */
export interface NewsItem {
  t: string; // title
  u: string; // link
  d: string; // ISO date
  s: string; // summary from the feed
  o: string; // organisation (APA group author, or journal name)
  k: NewsType;
  f: string; // source id
  n?: string; // site name, when different from the organisation
  a?: string[]; // personal authors, when the feed gives them
}

export interface NewsIndex {
  version: number;
  generatedAt: string;
  items: NewsItem[];
  sources: { id: string; org: string; type: NewsType; ok: boolean; items: number }[];
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const day = (d: Date) => d.toISOString().slice(0, 10);

/** The day a question asks about, as YYYY-MM-DD (UTC), or null. */
export function dateHint(text: string, now = new Date()): string | null {
  const t = text.toLowerCase();
  if (/\btoday\b|\btonight\b/.test(t)) return day(now);
  if (/\byesterday\b/.test(t)) return day(new Date(now.getTime() - 86_400_000));
  let m = /\b(20\d\d)-(\d\d)-(\d\d)\b/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const mon = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';
  m = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${mon}\\s*,?\\s*(20\\d\\d)?`).exec(t);
  if (m) return iso(Number(m[3] ?? now.getUTCFullYear()), MONTHS.indexOf(m[2]), Number(m[1]));
  m = new RegExp(`\\b${mon}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*,?\\s*(20\\d\\d)?`).exec(t);
  if (m) return iso(Number(m[3] ?? now.getUTCFullYear()), MONTHS.indexOf(m[1]), Number(m[2]));
  return null;
}
const iso = (y: number, mo: number, d: number) => (mo < 0 || d < 1 || d > 31 ? null : `${y}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);

const GENERIC = new Set('news global world international today tonight yesterday latest recent headlines headline update updates happened happening events event current breaking top major important key stories story summary give list what whats tell please'.split(' '));
const MONTH_WORDS = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*$/;

/** Topic words of a search query (no dates, months or generic news words). */
export function topicWords(query: string): string[] {
  return [...new Set(query.toLowerCase().split(/[^\p{L}\p{N}]+/u))].filter(
    (w) => w.length >= 3 && !GENERIC.has(w) && !MONTH_WORDS.test(w) && !/^\d+(st|nd|rd|th)?$/.test(w),
  );
}

const WEIGHT: Record<NewsType, number> = { intergovernmental: 1.3, government: 1.25, scholarly: 1.2, news: 1 };

/**
 * Best items for a question. With topic words: items whose title or summary
 * mention them. Without (e.g. "global news on 24 Nov 2026"): the newest items
 * of that day. At most `perOrg` items from one organisation, so answers draw
 * on several independent sources.
 */
export function searchNews(index: NewsIndex | null, query: string, opts: { text?: string; now?: Date; max?: number; perOrg?: number; allowNews?: boolean } = {}): WebSource[] {
  if (!index?.items?.length) return [];
  const now = opts.now ?? new Date();
  const max = opts.max ?? 6;
  const perOrg = opts.perOrg ?? 2;
  const hint = dateHint(opts.text ?? query, now);
  const terms = topicWords(query);
  let pool = index.items.filter((it) => opts.allowNews !== false || it.k !== 'news');
  if (hint) {
    const start = Date.parse(`${hint}T00:00:00Z`) - 12 * 3600_000; // allow for time zones
    const end = start + 48 * 3600_000;
    pool = pool.filter((it) => {
      const t = Date.parse(it.d);
      return t >= start && t < end;
    });
  }
  const scored = pool
    .map((it) => {
      const title = it.t.toLowerCase();
      const body = it.s.toLowerCase();
      let score = 0;
      let hits = 0;
      for (const w of terms) {
        const re = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
        const inTitle = re.test(title);
        const inBody = re.test(body);
        if (inTitle || inBody) hits += 1;
        score += (inTitle ? 3 : 0) + (inBody ? 1 : 0);
      }
      const ageH = Math.max(0, (now.getTime() - Date.parse(it.d)) / 3600_000);
      const fresh = 1 / (1 + ageH / 24);
      return { it, hits, score: (terms.length ? score : 1) * WEIGHT[it.k] + fresh };
    })
    .filter((x) => !terms.length || x.hits >= Math.min(2, terms.length) || x.score >= 3 * WEIGHT[x.it.k])
    .sort((a, b) => b.score - a.score);
  const perCount = new Map<string, number>();
  const out: WebSource[] = [];
  for (const { it } of scored) {
    const c = perCount.get(it.o) ?? 0;
    if (c >= perOrg) continue;
    perCount.set(it.o, c + 1);
    out.push(toSource(it));
    if (out.length >= max) break;
  }
  return out;
}

function toSource(it: NewsItem): WebSource {
  const host = (() => {
    try {
      return new URL(it.u).hostname.replace(/^www\./, '');
    } catch {
      return it.o;
    }
  })();
  const kind = it.k === 'news' ? 'news' : it.k === 'scholarly' ? 'scholarly' : 'official';
  return {
    n: 0,
    title: it.t,
    url: it.u,
    snippet: it.s || it.t,
    site: it.n ?? it.o ?? host,
    date: it.d,
    kind,
    part: kind === 'scholarly' ? "Summary from the journal's feed" : "Summary from the organisation's feed",
    authors: it.a?.length ? it.a : undefined,
    org: it.o,
    venue: kind === 'scholarly' ? it.o : it.n ?? it.o,
    workType: it.k === 'intergovernmental' ? 'intergovernmental body' : it.k === 'government' ? 'government' : kind === 'scholarly' ? 'journal article' : 'news report',
  };
}

let cache: { url: string; at: number; data: NewsIndex | null } | null = null;

/** The latest index (cached for 10 minutes). Null when it cannot be read. */
export async function loadNewsIndex(url: string, fetchFn: (u: string, i?: RequestInit) => Promise<Response> = (u, i) => fetch(u, i), signal?: AbortSignal): Promise<NewsIndex | null> {
  if (cache && cache.url === url && Date.now() - cache.at < 10 * 60_000) return cache.data;
  const res = await fetchFn(url, { signal, cache: 'no-cache' });
  if (!res.ok) throw new Error(`news index HTTP ${res.status}`);
  const data = (await res.json()) as NewsIndex;
  cache = { url, at: Date.now(), data: Array.isArray(data?.items) ? data : null };
  return cache.data;
}
export const resetNewsCache = () => void (cache = null);
