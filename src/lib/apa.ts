// APA 7th edition citations, built by JeeA! from search-result metadata so
// models only need to copy them. Pure functions (unit-tested in Node).
import type { WebSource } from './web';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "Karma Dorji" -> "Dorji, K."; "Dorji, Karma" -> "Dorji, K."; "J. R. R. Tolkien" -> "Tolkien, J. R. R." */
export function apaName(full: string): string {
  const n = full.replace(/\s+/g, ' ').trim();
  if (!n) return '';
  let family: string;
  let given: string[];
  if (n.includes(',')) {
    const [f, g] = n.split(',', 2);
    family = f.trim();
    given = g.trim().split(' ').filter(Boolean);
  } else {
    const parts = n.split(' ');
    if (parts.length === 1) return parts[0];
    // Keep particles with the family name: "Ludwig van Beethoven" -> "van Beethoven, L."
    let i = parts.length - 1;
    while (i > 1 && /^(van|von|der|den|de|da|di|du|la|le|del|dos|bin|al|ibn)$/i.test(parts[i - 1])) i -= 1;
    family = parts.slice(i).join(' ');
    given = parts.slice(0, i);
  }
  const initials = given
    .map((g) => g.split('-').map((p) => (p.replace(/[^\p{L}]/gu, '')[0] ?? '').toUpperCase()).filter(Boolean).map((c) => `${c}.`).join('-'))
    .filter(Boolean)
    .join(' ');
  return initials ? `${family}, ${initials}` : family;
}

const familyOf = (full: string) => apaName(full).split(',')[0];

/** Reference-list author part: up to 20 names; 21 or more = first 19, "…", last. */
export function apaAuthors(names: string[]): string {
  const list = names.map(apaName).filter(Boolean);
  if (!list.length) return '';
  if (list.length === 1) return list[0];
  if (list.length <= 20) return `${list.slice(0, -1).join(', ')}, & ${list[list.length - 1]}`;
  return `${list.slice(0, 19).join(', ')}, . . . ${list[list.length - 1]}`;
}

/** In-text author part: "Dorji", "Dorji & Wangmo", "Dorji et al.", or a group author. */
export function apaInTextAuthors(names: string[] | undefined, group?: string): string {
  const list = (names ?? []).filter((n) => n.trim());
  if (!list.length) return group ?? '';
  if (list.length === 1) return familyOf(list[0]);
  if (list.length === 2) return `${familyOf(list[0])} & ${familyOf(list[1])}`;
  return `${familyOf(list[0])} et al.`;
}

export function apaYear(iso?: string): string {
  const y = iso?.slice(0, 4);
  return y && /^\d{4}$/.test(y) ? y : 'n.d.';
}

/** "2026, November 24" (used for news and official releases). */
export function apaFullDate(iso?: string): string {
  if (!iso) return 'n.d.';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return apaYear(iso);
  return `${d.getUTCFullYear()}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export interface ApaInput {
  title: string;
  url: string;
  date?: string;
  authors?: string[];
  /** Group author (organisation) when there are no personal authors. */
  org?: string;
  /** Journal or website name. */
  venue?: string;
  doi?: string;
  /** scholarly = journal article style; dated = news/official release with a full date. */
  style: 'scholarly' | 'dated' | 'web';
}

const endDot = (s: string) => (/[.?!]$/.test(s) ? s : `${s}.`);

/** Reference entry. `suffix` is the a/b/c letter for same author and year. */
export function apaReference(s: ApaInput, suffix = ''): string {
  const who = s.authors?.length ? apaAuthors(s.authors) : s.org || s.venue || '';
  const link = s.doi ? `https://doi.org/${s.doi}` : s.url;
  if (s.style === 'scholarly') {
    const year = `${apaYear(s.date)}${suffix}`;
    const head = who ? `${endDot(who)} (${year}).` : `${endDot(s.title)} (${year}).`;
    const title = who ? ` ${endDot(s.title)}` : '';
    return `${head}${title}${s.venue ? ` *${s.venue}*.` : ''} ${link}`;
  }
  const date = s.style === 'dated' ? apaFullDate(s.date) : apaYear(s.date);
  const dated = suffix && date !== 'n.d.' ? date.replace(/^(\d{4})/, `$1${suffix}`) : date === 'n.d.' && suffix ? `n.d.-${suffix}` : date;
  // Website name only when it differs from the author.
  const site = s.venue && s.venue !== who ? ` ${endDot(s.venue)}` : '';
  return `${who ? `${endDot(who)} ` : ''}(${dated}). *${s.title.replace(/[.]$/, '')}*.${site} ${link}`;
}

/** In-text citation: "(Dorji & Wangmo, 2025)", "(United Nations, 2026a)". */
export function apaInText(s: ApaInput, suffix = ''): string {
  const who = apaInTextAuthors(s.authors, s.org || s.venue) || s.title.split(/\s+/).slice(0, 4).join(' ');
  const year = apaYear(s.date);
  return `(${who}, ${year === 'n.d.' && suffix ? `n.d.-${suffix}` : `${year}${suffix}`})`;
}

/** a, b, c … for works with the same in-text author and year, given in
 * alphabetical order of title, as APA 7th asks. */
export function apaSuffixes(list: ApaInput[]): string[] {
  const key = (s: ApaInput) => `${apaInTextAuthors(s.authors, s.org || s.venue)}|${apaYear(s.date)}`;
  const groups = new Map<string, number[]>();
  list.forEach((s, i) => groups.set(key(s), [...(groups.get(key(s)) ?? []), i]));
  const out = list.map(() => '');
  for (const idx of groups.values()) {
    if (idx.length < 2) continue;
    const sorted = [...idx].sort((a, b) => list[a].title.replace(/^(the|a|an)\s+/i, '').localeCompare(list[b].title.replace(/^(the|a|an)\s+/i, '')));
    sorted.forEach((i, k) => (out[i] = String.fromCharCode(97 + k)));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Search results -> APA 7th
// ---------------------------------------------------------------------------
export function apaInput(s: WebSource): ApaInput {
  if (s.kind === 'scholarly') {
    return { title: s.title, url: s.url, date: s.date, authors: s.authors, org: s.venue, venue: s.venue, doi: s.doi, style: 'scholarly' };
  }
  if (s.kind === 'official' || s.kind === 'news') {
    return { title: s.title, url: s.url, date: s.date, authors: s.authors, org: s.org ?? s.site, venue: s.site, style: 'dated' };
  }
  return { title: s.title, url: s.url, date: s.date, org: s.site, style: s.date ? 'dated' : 'web' };
}

/** Add ready-made APA 7th in-text citations and references to results. */
export function withApa(sources: WebSource[]): WebSource[] {
  const inputs = sources.map(apaInput);
  const suffix = apaSuffixes(inputs);
  return sources.map((s, i) => ({ ...s, apaInText: apaInText(inputs[i], suffix[i]), apaRef: apaReference(inputs[i], suffix[i]) }));
}
