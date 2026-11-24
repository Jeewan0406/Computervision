// Plain text from files added to a chat or a project: text and code files,
// PDF (with page numbers, via pdf.js), Word .docx (via mammoth), PowerPoint
// .pptx and Excel .xlsx (read straight from their XML with fflate). The
// libraries load only when such a file is added.

export const MAX_FILE_CHARS = 2_000_000;

export const KNOWLEDGE_ACCEPT =
  '.txt,.md,.markdown,.csv,.tsv,.json,.xml,.html,.htm,.css,.js,.jsx,.ts,.tsx,.py,.java,.c,.cpp,.cs,.go,.rs,.rb,.php,.sql,.yaml,.yml,.tex,.bib,.log,.ini,.toml,.rtf,.pdf,.docx,.pptx,.xlsx';

export interface Extracted {
  text: string;
  /** Character offset where each page starts (PDF only). */
  pages?: number[];
  kind: 'text' | 'pdf' | 'docx' | 'pptx' | 'xlsx';
}

async function pdfText(buf: ArrayBuffer): Promise<Extracted> {
  const pdfjs = await import('pdfjs-dist');
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const task = pdfjs.getDocument({ data: new Uint8Array(buf) });
  const doc = await task.promise;
  let text = '';
  const pages: number[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      pages.push(text.length);
      for (const item of content.items as { str?: string; hasEOL?: boolean }[]) {
        if (typeof item.str === 'string') text += item.str + (item.hasEOL ? '\n' : '');
      }
      text += '\n\n';
      if (text.length > MAX_FILE_CHARS) break;
    }
  } finally {
    await task.destroy();
  }
  if (!text.trim()) throw new Error('This PDF has no text layer (it may be a scanned image).');
  return { text: text.slice(0, MAX_FILE_CHARS), pages, kind: 'pdf' };
}

async function docxText(buf: ArrayBuffer): Promise<Extracted> {
  const mammoth = await import('mammoth');
  const r = await (mammoth.default ?? mammoth).extractRawText({ arrayBuffer: buf });
  return { text: r.value.slice(0, MAX_FILE_CHARS), kind: 'docx' };
}

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
/** Decode the few XML entities Office files use. */
export const xmlText = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : XML_ENTITIES[e.toLowerCase()] ?? '');

const num = (name: string) => Number(/(\d+)\.xml$/.exec(name)?.[1] ?? 0);

/** Text runs of one DrawingML part (a slide or its notes), one line per paragraph. */
function drawingText(xml: string): string {
  return xml
    .split(/<\/a:p>/)
    .map((p) => [...p.matchAll(/<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>/g)].map((m) => xmlText(m[1])).join(''))
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

/** PowerPoint .pptx: the text of every slide, in order, with its speaker notes. */
export async function pptxText(buf: ArrayBuffer): Promise<Extracted> {
  const { unzipSync, strFromU8 } = await import('fflate');
  const files = unzipSync(new Uint8Array(buf), { filter: (f) => /^ppt\/(slides\/slide|notesSlides\/notesSlide)\d+\.xml$/.test(f.name) });
  const slides = Object.keys(files).filter((n) => n.startsWith('ppt/slides/')).sort((a, b) => num(a) - num(b));
  const parts: string[] = [];
  for (const name of slides) {
    const n = num(name);
    const body = drawingText(strFromU8(files[name]));
    const notesFile = files[`ppt/notesSlides/notesSlide${n}.xml`];
    // Notes pages repeat the slide number; keep only real note text.
    const notes = notesFile ? drawingText(strFromU8(notesFile)).split('\n').filter((l) => l !== String(n)).join('\n') : '';
    parts.push(`Slide ${n}\n${body || '(no text on this slide)'}${notes ? `\nSpeaker notes: ${notes}` : ''}`);
  }
  if (!parts.length) throw new Error('No slides found in this PowerPoint file.');
  return { text: parts.join('\n\n').slice(0, MAX_FILE_CHARS), kind: 'pptx' };
}

const colIndex = (ref: string) => {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

/** Excel .xlsx: every sheet as rows of cells separated by " | ". Formulas show their last saved value. */
export async function xlsxText(buf: ArrayBuffer): Promise<Extracted> {
  const { unzipSync, strFromU8 } = await import('fflate');
  const files = unzipSync(new Uint8Array(buf), { filter: (f) => /^xl\/(workbook\.xml|sharedStrings\.xml|_rels\/workbook\.xml\.rels|worksheets\/[^/]+\.xml)$/.test(f.name) });
  const read = (n: string) => (files[n] ? strFromU8(files[n]) : '');
  const shared = [...read('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    [...m[1].matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((t) => xmlText(t[1])).join(''),
  );
  const rels = new Map([...read('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)].map((m) => [/Id="([^"]+)"/.exec(m[0])?.[1] ?? '', (/Target="([^"]+)"/.exec(m[0])?.[1] ?? '').replace(/^\/?(xl\/)?/, 'xl/')]));
  let sheets = [...read('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)].map((m) => ({ name: xmlText(/name="([^"]*)"/.exec(m[0])?.[1] ?? 'Sheet'), file: rels.get(/r:id="([^"]+)"/.exec(m[0])?.[1] ?? '') ?? '' }));
  if (!sheets.some((s) => files[s.file])) sheets = Object.keys(files).filter((n) => n.startsWith('xl/worksheets/')).sort((a, b) => num(a) - num(b)).map((file, i) => ({ name: `Sheet ${i + 1}`, file }));
  const out: string[] = [];
  let size = 0;
  for (const sh of sheets) {
    const xml = read(sh.file);
    if (!xml) continue;
    const rows: string[] = [];
    for (const r of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1];
        const inner = c[2] ?? '';
        const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
        const v = /<v>([^<]*)<\/v>/.exec(inner)?.[1];
        let val = '';
        if (type === 's' && v != null) val = shared[Number(v)] ?? '';
        else if (type === 'inlineStr') val = [...inner.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((t) => xmlText(t[1])).join('');
        else if (type === 'b' && v != null) val = v === '1' ? 'TRUE' : 'FALSE';
        else if (v != null) val = xmlText(v);
        const ref = /\br="([A-Z]+)\d+"/.exec(attrs)?.[1];
        const at = ref ? colIndex(ref) : cells.length;
        while (cells.length < at) cells.push('');
        cells[at] = val.replace(/\s+/g, ' ').trim();
      }
      if (cells.some(Boolean)) rows.push(cells.join(' | '));
      size += rows[rows.length - 1]?.length ?? 0;
      if (size > MAX_FILE_CHARS) break;
    }
    out.push(`Sheet: ${sh.name}\n${rows.length ? rows.join('\n') : '(empty)'}`);
    if (size > MAX_FILE_CHARS) break;
  }
  if (!out.length) throw new Error('No sheets found in this Excel file.');
  return { text: out.join('\n\n').slice(0, MAX_FILE_CHARS), kind: 'xlsx' };
}

/** Old binary Office formats cannot be read in the browser. */
const LEGACY = /\.(doc|ppt|xls|pps)$/i;

export async function extractText(file: File): Promise<Extracted> {
  const name = file.name.toLowerCase();
  if (file.size > 40_000_000) throw new Error('File is larger than 40 MB.');
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return pdfText(await file.arrayBuffer());
  if (name.endsWith('.docx')) return docxText(await file.arrayBuffer());
  if (name.endsWith('.pptx') || name.endsWith('.ppsx')) return pptxText(await file.arrayBuffer());
  if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) return xlsxText(await file.arrayBuffer());
  if (LEGACY.test(name)) throw new Error('This is an old Office format. Save it as .docx, .pptx or .xlsx (File → Save As) and add it again.');
  const text = await file.text();
  if (/\u0000/.test(text.slice(0, 2000))) throw new Error('This file type cannot be read as text. Add text, code, PDF, Word, PowerPoint or Excel files, or pictures.');
  return { text: text.slice(0, MAX_FILE_CHARS), kind: 'text' };
}
