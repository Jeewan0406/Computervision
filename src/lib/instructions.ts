// Custom instructions and projects: the text each model receives.
// Pure functions, no runtime imports, so they are unit-tested in Node.
//
// Layers, from broadest to most specific (the model is told this order):
//   1. the site owner's answer rules (rules.ts)
//   2. the user's custom instructions (every conversation, chosen areas)
//   3. the project's instructions and knowledge (chats in that project)
//   4. this conversation's own system prompt
// As in Claude, a project's instructions apply only to chats in that project,
// and its files are shared by every chat in it; chats do not see each other.

export function customPrompt(text: string): string {
  const t = text.trim();
  if (!t) return '';
  return [
    "# The user's custom instructions",
    'The user wrote these for every conversation. Follow them unless a more specific instruction below says otherwise.',
    '',
    t,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Project knowledge: whole files when they fit, else the most relevant passages
// ---------------------------------------------------------------------------

export interface KnowledgeFile {
  name: string;
  text: string;
  /** Character offset where each page starts (PDFs). */
  pages?: number[];
}

export interface Chunk {
  file: string;
  /** 1-based page numbers covered (PDFs). */
  pageFrom?: number;
  pageTo?: number;
  /** Position of the chunk in its file (for keeping document order). */
  idx: number;
  fileIdx: number;
  text: string;
}

const pageAt = (pages: number[] | undefined, offset: number) => {
  if (!pages?.length) return undefined;
  let p = 1;
  for (let i = 0; i < pages.length; i++) if (pages[i] <= offset) p = i + 1;
  return p;
};

/** Split files into passages of about `size` characters at paragraph or sentence breaks. */
export function chunkFiles(files: KnowledgeFile[], size = 1200): Chunk[] {
  const out: Chunk[] = [];
  files.forEach((f, fileIdx) => {
    const text = f.text;
    let start = 0;
    let idx = 0;
    while (start < text.length) {
      let end = Math.min(text.length, start + size);
      if (end < text.length) {
        const window = text.slice(start + Math.floor(size * 0.6), end);
        const para = window.lastIndexOf('\n\n');
        const sentence = Math.max(window.lastIndexOf('. '), window.lastIndexOf('.\n'));
        const cut = para >= 0 ? para + 2 : sentence >= 0 ? sentence + 2 : -1;
        if (cut >= 0) end = start + Math.floor(size * 0.6) + cut;
      }
      const piece = text.slice(start, end).trim();
      if (piece) out.push({ file: f.name, fileIdx, idx: idx++, pageFrom: pageAt(f.pages, start), pageTo: pageAt(f.pages, Math.max(start, end - 1)), text: piece });
      start = end;
    }
  });
  return out;
}

const STOP = new Set(
  'the a an and or but of in on at to for from by with about as is are was were be been being this that these those it its into than then there their they them what which who whom how why when where can could would should will shall may might must do does did done have has had not no yes all any each more most other some such only own same so too very just also over under again further once here both few nor off out up down our your you we i me my he she his her'.split(' '),
);

export function tokens(s: string): string[] {
  return s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !STOP.has(w));
}

/** Rank passages for a question (BM25), best first. */
export function rankChunks(chunks: Chunk[], query: string): { chunk: Chunk; score: number }[] {
  const q = [...new Set(tokens(query))];
  if (!q.length) return chunks.map((chunk) => ({ chunk, score: 0 }));
  const docs = chunks.map((c) => tokens(c.text));
  const avg = docs.reduce((n, d) => n + d.length, 0) / Math.max(1, docs.length);
  const df = new Map<string, number>();
  for (const d of docs) for (const w of new Set(d)) df.set(w, (df.get(w) ?? 0) + 1);
  const N = docs.length;
  const k1 = 1.4;
  const b = 0.75;
  return chunks
    .map((chunk, i) => {
      const d = docs[i];
      const tf = new Map<string, number>();
      for (const w of d) tf.set(w, (tf.get(w) ?? 0) + 1);
      let score = 0;
      for (const w of q) {
        const f = tf.get(w) ?? 0;
        if (!f) continue;
        const idf = Math.log(1 + (N - (df.get(w) ?? 0) + 0.5) / ((df.get(w) ?? 0) + 0.5));
        score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.length) / (avg || 1))));
      }
      return { chunk, score };
    })
    .sort((a, b2) => b2.score - a.score);
}

export interface KnowledgeResult {
  text: string;
  mode: 'none' | 'full' | 'passages';
  /** Characters sent / characters in all files. */
  sent: number;
  total: number;
  passages: number;
}

const label = (c: Pick<Chunk, 'file' | 'pageFrom' | 'pageTo'>) =>
  c.pageFrom ? `${c.file}, ${c.pageFrom === c.pageTo || !c.pageTo ? `p. ${c.pageFrom}` : `pp. ${c.pageFrom}–${c.pageTo}`}` : c.file;

/** Project files as text for the model, within `budget` characters. */
export function knowledgeBlock(files: KnowledgeFile[], query: string, budget: number): KnowledgeResult {
  const total = files.reduce((n, f) => n + f.text.length, 0);
  if (!files.length || !total) return { text: '', mode: 'none', sent: 0, total: 0, passages: 0 };
  if (total <= budget) {
    // Whole files, with page markers so the model can cite pages.
    const body = files
      .map((f) => {
        if (!f.pages?.length) return `=== File: ${f.name} ===\n${f.text.trim()}`;
        const parts = f.pages.map((start, i) => `--- ${f.name}, page ${i + 1} ---\n${f.text.slice(start, f.pages![i + 1] ?? f.text.length).trim()}`);
        return `=== File: ${f.name} (${f.pages.length} pages) ===\n${parts.join('\n')}`;
      })
      .join('\n\n');
    return { text: body, mode: 'full', sent: total, total, passages: 0 };
  }
  const chunks = chunkFiles(files);
  const ranked = rankChunks(chunks, query).filter((r) => r.score > 0);
  const chosen: Chunk[] = [];
  let used = 0;
  for (const r of ranked) {
    if (used + r.chunk.text.length > budget) continue;
    chosen.push(r.chunk);
    used += r.chunk.text.length;
    if (used > budget * 0.95) break;
  }
  chosen.sort((a, b) => a.fileIdx - b.fileIdx || a.idx - b.idx);
  const body = chosen.map((c) => `--- Passage from ${label(c)} ---\n${c.text}`).join('\n\n');
  return { text: body, mode: 'passages', sent: used, total, passages: chosen.length };
}

export interface ProjectText {
  name: string;
  instructions: string;
}

export function projectPrompt(p: ProjectText, k: KnowledgeResult, fileCount: number): string {
  const lines = [`# Project: ${p.name}`, 'This conversation belongs to this project. Its instructions and files apply to every chat in the project.'];
  if (p.instructions.trim()) lines.push(`\n## Project instructions\n${p.instructions.trim()}`);
  if (k.mode !== 'none') {
    lines.push(
      '\n## Project files (the user\'s own documents)',
      k.mode === 'full'
        ? `All ${fileCount} file${fileCount === 1 ? ' is' : 's are'} included in full below.`
        : `The files are larger than the space for them in this request, so JeeA! included only the ${k.passages} passage${k.passages === 1 ? '' : 's'} most related to the question (${Math.round((k.sent / k.total) * 100)}% of the text). If the answer may be elsewhere in the files, say so.`,
      'Treat these files as opened sources. Cite them by file name and page or section, for example (report.pdf, p. 3). Never claim a file says something that is not in the text below.',
      '',
      k.text,
    );
  }
  return lines.join('\n');
}

/** How the layers rank when they conflict. */
export function priorityNote(opts: { rules: boolean; custom: boolean; project: boolean }): string {
  if (!opts.custom && !opts.project) return '';
  const order = ["this conversation's own instructions", opts.project ? "the project's instructions" : '', opts.custom ? "the user's custom instructions" : ''].filter(Boolean);
  return [
    '# Which instruction wins',
    opts.rules
      ? `The site owner's answer rules come first: their hard rules (sections 0 to 8) always apply. Below them, the most specific instruction wins: ${order.join(', then ')}. These may change the answer rules' preferences (sections 9 to 12), never their hard rules.`
      : `If instructions conflict, the most specific one wins: ${order.join(', then ')}.`,
  ].join('\n');
}
