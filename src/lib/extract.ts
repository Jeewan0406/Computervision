// Plain text from files added to a project: text and code files, PDF (with
// page numbers, via pdf.js) and Word .docx (via mammoth). The libraries load
// only when such a file is added.

export const MAX_FILE_CHARS = 2_000_000;

export const KNOWLEDGE_ACCEPT =
  '.txt,.md,.markdown,.csv,.tsv,.json,.xml,.html,.htm,.css,.js,.jsx,.ts,.tsx,.py,.java,.c,.cpp,.cs,.go,.rs,.rb,.php,.sql,.yaml,.yml,.tex,.bib,.log,.ini,.toml,.pdf,.docx';

export interface Extracted {
  text: string;
  /** Character offset where each page starts (PDF only). */
  pages?: number[];
  kind: 'text' | 'pdf' | 'docx';
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

export async function extractText(file: File): Promise<Extracted> {
  const name = file.name.toLowerCase();
  if (file.size > 40_000_000) throw new Error('File is larger than 40 MB.');
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return pdfText(await file.arrayBuffer());
  if (name.endsWith('.docx')) return docxText(await file.arrayBuffer());
  const text = await file.text();
  if (/\u0000/.test(text.slice(0, 2000))) throw new Error('This looks like a binary file. Add text, PDF or Word files.');
  return { text: text.slice(0, MAX_FILE_CHARS), kind: 'text' };
}
