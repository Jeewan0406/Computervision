// Pure helpers for the trusted-news collector (agents/news.mjs).
// No dependencies: RSS 2.0, RSS 1.0 (RDF) and Atom are read with small,
// tested regular expressions. Run the tests with: npm test

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…' };

export function decodeEntities(s) {
  return String(s ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
}
const safeChar = (n) => (n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '');

/** Text of an XML element's content: CDATA unwrapped, tags removed, entities decoded. */
export function textOf(raw) {
  if (raw == null) return '';
  let s = String(raw).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  // Escaped HTML inside RSS descriptions: decode once, then strip tags.
  if (!/<[a-z]/i.test(s) && /&lt;[a-z/]/i.test(s)) s = decodeEntities(s);
  s = s
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/p>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(s).replace(/\s+/g, ' ').trim();
}

function tag(block, names) {
  for (const n of names) {
    const re = new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, 'i');
    const m = re.exec(block);
    if (m) return m[1];
  }
  return null;
}
function tagsAll(block, name) {
  const out = [];
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'gi');
  let m;
  while ((m = re.exec(block))) out.push(m[1]);
  return out;
}

/** ISO date string, or null when the text is not a date. */
export function toIso(s) {
  if (!s) return null;
  const t = Date.parse(textOf(s));
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function atomLink(block) {
  const links = [...block.matchAll(/<link\b([^>]*?)\/?>/gi)].map((m) => m[1]);
  const attr = (a, n) => (new RegExp(`\\b${n}\\s*=\\s*["']([^"']*)["']`, 'i').exec(a) || [])[1];
  const alt = links.find((a) => !attr(a, 'rel') || attr(a, 'rel') === 'alternate');
  return alt ? decodeEntities(attr(alt, 'href') || '') : '';
}

/** Items of an RSS 2.0, RSS 1.0 (RDF) or Atom feed. */
export function parseFeed(xml) {
  const src = String(xml ?? '');
  const atom = /<feed\b[^>]*xmlns=["']http:\/\/www\.w3\.org\/2005\/Atom["']/i.test(src) || (/<entry\b/i.test(src) && !/<item\b/i.test(src));
  const blocks = atom ? tagsAll(src, 'entry') : tagsAll(src, 'item');
  const items = [];
  for (const b of blocks) {
    const title = textOf(tag(b, ['title']));
    let link = atom ? atomLink(b) : textOf(tag(b, ['link']));
    if (!link && !atom) {
      const guid = /<guid(?:\s[^>]*)?>([\s\S]*?)<\/guid>/i.exec(b);
      if (guid && /^https?:\/\//.test(textOf(guid[1]))) link = textOf(guid[1]);
    }
    const date = toIso(tag(b, atom ? ['published', 'updated'] : ['pubDate', 'dc:date', 'prism:publicationDate', 'updated']));
    const summary = textOf(tag(b, atom ? ['summary', 'content'] : ['description', 'content:encoded', 'summary']));
    const authors = (atom ? tagsAll(b, 'author').map((a) => textOf(tag(a, ['name']))) : tagsAll(b, 'dc:creator').map(textOf))
      .flatMap((a) => a.split(/\s*(?:;|,\s*and\s|\sand\s)\s*/))
      .map((a) => a.trim())
      .filter((a) => a && a.length < 80);
    if (title && /^https?:\/\//.test(link)) items.push({ title, link, date, summary, authors });
  }
  return items;
}

const clip = (s, n) => (s.length > n ? `${s.slice(0, n).replace(/\s+\S*$/, '')}…` : s);

/**
 * Build the index the website reads. Keeps recent, dated items only.
 * results: [{ source, url, ok, error?, items? }]
 */
export function buildIndex(results, now = new Date(), { maxAgeHours = 96, perSource = 25, summaryChars = 320 } = {}) {
  const cutoff = now.getTime() - maxAgeHours * 3600_000;
  const future = now.getTime() + 36 * 3600_000; // some feeds date items a day ahead
  const items = [];
  const sources = [];
  const seen = new Set();
  for (const r of results) {
    const s = r.source;
    let kept = 0;
    if (r.ok) {
      const fresh = (r.items ?? [])
        .filter((it) => it.date && Date.parse(it.date) >= cutoff && Date.parse(it.date) <= future)
        .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
      for (const it of fresh) {
        if (kept >= perSource) break;
        const key = it.link.replace(/[?#].*$/, '').toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        kept += 1;
        const row = { t: clip(it.title, 240), u: it.link, d: it.date, s: clip(it.summary ?? '', summaryChars), o: s.org, k: s.type, f: s.id };
        if (s.site) row.n = s.site;
        if (it.authors?.length) row.a = it.authors.slice(0, 20);
        items.push(row);
      }
    }
    sources.push({ id: s.id, org: s.org, type: s.type, ok: !!r.ok, url: r.url ?? null, items: kept, ...(r.error ? { error: String(r.error).slice(0, 160) } : {}) });
  }
  items.sort((a, b) => Date.parse(b.d) - Date.parse(a.d));
  return { version: 1, generatedAt: now.toISOString(), maxAgeHours, sources, items };
}
