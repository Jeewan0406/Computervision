// Export an answer (or a whole chat) as Word, PDF, Excel, PowerPoint,
// Markdown or an image. Loaded only when the user exports, so the heavy
// libraries (docx, pptxgenjs, html-to-image) never slow down the app.
import type { Token, Tokens } from 'marked';
import { lexMarkdown, renderMarkdown } from './markdown';
import { downloadText } from './utils';
import type { WebSource } from './web';

export type ExportFormat = 'docx' | 'pdf' | 'xlsx' | 'pptx' | 'md' | 'png' | 'jpeg' | 'svg';

export interface ExportInput {
  title: string;
  markdown: string;
  /** Rendered element, for image export. */
  node?: HTMLElement | null;
  /** Sources JeeA! found; listed at the end when the answer has no reference list. */
  sources?: WebSource[];
}

const BRAND = { maroon: '8B1E2D', saffron: 'F39A32', gold: 'FFC93C', ink: '2B1A12', grey: '6B5B50' };

export const fileBase = (title: string) =>
  (title.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'jeea-answer').toLowerCase();

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Adds "Sources found by JeeA!" (APA 7th) when the answer has no reference list. */
export function withSources(md: string, sources?: WebSource[]): string {
  if (!sources?.length || /^#{1,6}\s*references\b|^\*\*references\*\*|^references\s*$/im.test(md)) return md;
  const refs = sources.map((s, i) => `${i + 1}. ${s.apaRef ?? `${s.title}. ${s.url}`}`).join('\n');
  return `${md.trim()}\n\n## Sources found by JeeA! (APA 7th)\n\n${refs}\n`;
}

// ---------------------------------------------------------------------------
// Shared text helpers
// ---------------------------------------------------------------------------

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };
const decode = (s: string) => s.replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, n: string) => ENT[n] ?? _);

/** "\textcolor{#2CA02C}{\text{Dorji, 2025}}" -> coloured text; other LaTeX stays as source. */
export function texParts(tex: string): { text: string; color?: string; bold?: boolean; math: boolean } {
  const m = /^\s*\\textcolor\{#?([0-9a-fA-F]{6})\}\{\\text(bf)?\{([\s\S]*)\}\}\s*$/.exec(tex);
  const unesc = (s: string) => s.replace(/\\([&%#_$])/g, '$1');
  if (m) return { text: unesc(m[3]), color: m[1].toUpperCase(), bold: !!m[2], math: false };
  const t = /^\s*\\text(bf)?\{([^{}]*)\}\s*$/.exec(tex);
  if (t) return { text: unesc(t[2]), bold: !!t[1], math: false };
  return { text: tex.trim(), math: true };
}

/** Plain text of inline tokens. */
export function inlineText(tokens: Token[] | undefined): string {
  return (tokens ?? [])
    .map((t) => {
      const g = t as Tokens.Generic;
      if (g.type === 'mathInline') return texParts(String(g.text)).text;
      if (g.type === 'br') return '\n';
      if ('tokens' in g && Array.isArray(g.tokens)) return inlineText(g.tokens as Token[]);
      return decode(String(g.text ?? ''));
    })
    .join('');
}

interface Block {
  kind: 'heading' | 'para' | 'item' | 'code' | 'math' | 'quote' | 'table' | 'rule';
  depth?: number;
  ordered?: boolean;
  level?: number;
  inline?: Token[];
  text?: string;
  table?: { header: Token[][]; rows: Token[][][] };
  listId?: number;
}

/** Flatten Markdown into simple blocks that every exporter understands. */
export function toBlocks(md: string): Block[] {
  const out: Block[] = [];
  let listId = 0;
  const walk = (tokens: Token[], quote = false) => {
    for (const t of tokens) {
      const g = t as Tokens.Generic;
      switch (g.type) {
        case 'heading':
          out.push({ kind: 'heading', depth: g.depth, inline: g.tokens });
          break;
        case 'paragraph':
          out.push({ kind: quote ? 'quote' : 'para', inline: g.tokens });
          break;
        case 'text':
          out.push({ kind: quote ? 'quote' : 'para', inline: g.tokens ?? [{ type: 'text', raw: g.raw, text: g.text } as Token] });
          break;
        case 'list': {
          const id = ++listId;
          const each = (list: Tokens.List, level: number) => {
            for (const item of list.items) {
              const inline: Token[] = [];
              for (const c of item.tokens) {
                const cg = c as Tokens.Generic;
                if (cg.type === 'list') continue;
                if (cg.tokens) inline.push(...(inline.length ? [{ type: 'text', raw: ' ', text: ' ' } as Token] : []), ...(cg.tokens as Token[]));
              }
              out.push({ kind: 'item', ordered: list.ordered, level, inline, listId: id });
              for (const c of item.tokens) if ((c as Tokens.Generic).type === 'list') each(c as Tokens.List, level + 1);
            }
          };
          each(g as Tokens.List, 0);
          break;
        }
        case 'code':
          out.push({ kind: 'code', text: g.text });
          break;
        case 'mathBlock':
          out.push({ kind: 'math', text: g.text });
          break;
        case 'blockquote':
          walk(g.tokens as Token[], true);
          break;
        case 'table':
          out.push({ kind: 'table', table: { header: (g.header as { tokens: Token[] }[]).map((c) => c.tokens), rows: (g.rows as { tokens: Token[] }[][]).map((r) => r.map((c) => c.tokens)) } });
          break;
        case 'hr':
          out.push({ kind: 'rule' });
          break;
        default:
          break;
      }
    }
  };
  walk(lexMarkdown(md));
  return out;
}

// ---------------------------------------------------------------------------
// Word (.docx)
// ---------------------------------------------------------------------------

async function toDocx(input: ExportInput): Promise<Blob> {
  const d = await import('docx');
  const { Document, Packer, Paragraph, TextRun, ExternalHyperlink, HeadingLevel, Table, TableRow, TableCell, WidthType, LevelFormat, AlignmentType, ShadingType, BorderStyle } = d;
  type Child = InstanceType<typeof TextRun> | InstanceType<typeof ExternalHyperlink>;
  interface Fmt { bold?: boolean; italics?: boolean; strike?: boolean; link?: boolean }
  const run = (text: string, f: Fmt, extra: Record<string, unknown> = {}) =>
    new TextRun({ text, bold: f.bold, italics: f.italics, strike: f.strike, ...(f.link && !extra.color ? { style: 'Hyperlink' } : {}), ...extra });
  const runs = (tokens: Token[] | undefined, f: Fmt = {}): Child[] =>
    (tokens ?? []).flatMap((t): Child[] => {
      const g = t as Tokens.Generic;
      switch (g.type) {
        case 'strong': return runs(g.tokens, { ...f, bold: true });
        case 'em': return runs(g.tokens, { ...f, italics: true });
        case 'del': return runs(g.tokens, { ...f, strike: true });
        case 'codespan': return [run(decode(g.text), f, { font: 'Consolas' })];
        case 'br': return [new TextRun({ text: '', break: 1 })];
        case 'link': return [new ExternalHyperlink({ link: g.href, children: runs(g.tokens, { ...f, link: true }) as InstanceType<typeof TextRun>[] })];
        case 'mathInline': {
          const p = texParts(g.text);
          return [run(p.text, { ...f, bold: f.bold || p.bold, italics: f.italics || p.math }, { ...(p.color ? { color: p.color } : {}), ...(p.math ? { font: 'Cambria Math' } : {}) })];
        }
        case 'image': return [run(`[image: ${g.text || g.href}]`, f)];
        default:
          if (g.tokens) return runs(g.tokens, f);
          return g.text ? [run(decode(String(g.text)), f)] : [];
      }
    });

  const children: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: input.title })] }),
    new Paragraph({ children: [new TextRun({ text: `Made with JeeA! · ${new Date().toLocaleString()}`, color: BRAND.grey, size: 18 })] }),
  ];
  const H = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];
  for (const b of toBlocks(input.markdown)) {
    if (b.kind === 'heading') children.push(new Paragraph({ heading: H[Math.min(5, (b.depth ?? 1) - 1)], children: runs(b.inline) }));
    else if (b.kind === 'para') children.push(new Paragraph({ children: runs(b.inline), spacing: { after: 120 } }));
    else if (b.kind === 'quote') children.push(new Paragraph({ children: runs(b.inline, { italics: true }), indent: { left: 480 }, border: { left: { style: BorderStyle.SINGLE, size: 12, color: BRAND.saffron, space: 8 } } }));
    else if (b.kind === 'item') {
      children.push(new Paragraph({
        children: runs(b.inline),
        ...(b.ordered ? { numbering: { reference: 'jeea-num', level: Math.min(3, b.level ?? 0), instance: b.listId } } : { bullet: { level: Math.min(3, b.level ?? 0) } }),
      }));
    } else if (b.kind === 'code') {
      const lines = (b.text ?? '').split('\n');
      children.push(new Paragraph({ shading: { type: ShadingType.CLEAR, fill: 'F3F0EC', color: 'auto' }, children: lines.map((l, i) => new TextRun({ text: l, font: 'Consolas', size: 19, break: i ? 1 : 0 })) }));
    } else if (b.kind === 'math') {
      const p = texParts(b.text ?? '');
      children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: p.text, font: p.math ? 'Cambria Math' : undefined, italics: p.math, color: p.color, bold: p.bold })] }));
    } else if (b.kind === 'rule') {
      children.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC', space: 1 } }, children: [] }));
    } else if (b.kind === 'table' && b.table) {
      const cell = (tokens: Token[], head: boolean) =>
        new TableCell({ children: [new Paragraph({ children: runs(tokens, { bold: head }) })], ...(head ? { shading: { type: ShadingType.CLEAR, fill: 'F6E3D1', color: 'auto' } } : {}) });
      children.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [new TableRow({ tableHeader: true, children: b.table.header.map((c) => cell(c, true)) }), ...b.table.rows.map((r) => new TableRow({ children: r.map((c) => cell(c, false)) }))],
      }));
      children.push(new Paragraph({ children: [] }));
    }
  }
  const doc = new Document({
    creator: 'JeeA!',
    title: input.title,
    styles: { default: { document: { run: { font: 'Calibri', size: 22, color: BRAND.ink } } } },
    numbering: {
      config: [{
        reference: 'jeea-num',
        levels: [0, 1, 2, 3].map((level) => ({ level, format: LevelFormat.DECIMAL, text: `%${level + 1}.`, alignment: AlignmentType.START, style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } } })),
      }],
    },
    sections: [{ children }],
  });
  return Packer.toBlob(doc);
}

// ---------------------------------------------------------------------------
// PowerPoint (.pptx)
// ---------------------------------------------------------------------------

async function toPptx(input: ExportInput): Promise<Blob> {
  const { default: PptxGenJS } = await import('pptxgenjs');
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 in
  pptx.title = input.title;
  pptx.author = 'JeeA!';
  type TP = { text: string; options?: Record<string, unknown> };
  const runs = (tokens: Token[] | undefined, o: Record<string, unknown> = {}): TP[] =>
    (tokens ?? []).flatMap((t): TP[] => {
      const g = t as Tokens.Generic;
      switch (g.type) {
        case 'strong': return runs(g.tokens, { ...o, bold: true });
        case 'em': return runs(g.tokens, { ...o, italic: true });
        case 'codespan': return [{ text: decode(g.text), options: { ...o, fontFace: 'Consolas' } }];
        case 'link': return runs(g.tokens, { ...o, hyperlink: { url: g.href } });
        case 'br': return [{ text: '', options: { ...o, breakLine: true } }];
        case 'mathInline': {
          const p = texParts(g.text);
          return [{ text: p.text, options: { ...o, ...(p.color ? { color: p.color } : {}), ...(p.bold ? { bold: true } : {}), ...(p.math ? { fontFace: 'Cambria Math', italic: true } : {}) } }];
        }
        default:
          if (g.tokens) return runs(g.tokens, o);
          return g.text ? [{ text: decode(String(g.text)), options: o }] : [];
      }
    });

  // Title slide in the Druk colours.
  const cover = pptx.addSlide();
  cover.background = { color: BRAND.maroon };
  cover.addShape(pptx.ShapeType.rect, { x: 0, y: 6.9, w: 13.33, h: 0.6, fill: { color: BRAND.saffron } });
  cover.addText(input.title, { x: 0.8, y: 2.3, w: 11.7, h: 1.8, fontSize: 40, bold: true, color: 'FFFFFF', fontFace: 'Calibri', valign: 'middle' });
  cover.addText(`Made with JeeA! · ${new Date().toLocaleDateString()}`, { x: 0.8, y: 4.2, w: 11.7, h: 0.6, fontSize: 18, color: BRAND.gold, fontFace: 'Calibri' });

  const blocks = toBlocks(input.markdown);
  let title = input.title;
  let para: { runs: TP[]; bullet?: boolean | { type: 'number' }; level: number }[] = [];
  let used = 0;
  const flush = (cont = false) => {
    if (!para.length) return;
    const s = pptx.addSlide();
    s.addText(cont ? `${title} (continued)` : title, { x: 0.5, y: 0.3, w: 12.3, h: 0.8, fontSize: 28, bold: true, color: BRAND.maroon, fontFace: 'Calibri' });
    s.addShape(pptx.ShapeType.rect, { x: 0.5, y: 1.1, w: 1.4, h: 0.07, fill: { color: BRAND.saffron } });
    const text: TP[] = [];
    for (const p of para) {
      p.runs.forEach((r, i) => text.push({ text: r.text, options: { ...r.options, ...(p.bullet ? { bullet: p.bullet, indentLevel: p.level } : {}), ...(i === p.runs.length - 1 ? { breakLine: true } : {}) } }));
    }
    s.addText(text, { x: 0.6, y: 1.35, w: 12.1, h: 5.6, fontSize: 18, color: BRAND.ink, fontFace: 'Calibri', valign: 'top', paraSpaceAfter: 6 });
    s.addText('JeeA!', { x: 11.8, y: 7.0, w: 1.2, h: 0.35, fontSize: 10, color: BRAND.grey, align: 'right' });
    para = [];
    used = 0;
  };
  let continued = false;
  const add = (p: (typeof para)[number]) => {
    const len = p.runs.reduce((n, r) => n + r.text.length, 0);
    if (para.length >= 8 || used + len > 900) {
      flush(continued);
      continued = true;
    }
    para.push(p);
    used += len;
  };
  for (const b of blocks) {
    if (b.kind === 'heading' && (b.depth ?? 1) <= 2) {
      flush(continued);
      continued = false;
      title = inlineText(b.inline) || title;
    } else if (b.kind === 'heading') add({ runs: runs(b.inline, { bold: true, color: BRAND.maroon }), level: 0 });
    else if (b.kind === 'para' || b.kind === 'quote') add({ runs: runs(b.inline, b.kind === 'quote' ? { italic: true } : {}), level: 0 });
    else if (b.kind === 'item') add({ runs: runs(b.inline), bullet: b.ordered ? { type: 'number' } : true, level: b.level ?? 0 });
    else if (b.kind === 'code') add({ runs: [{ text: b.text ?? '', options: { fontFace: 'Consolas', fontSize: 12 } }], level: 0 });
    else if (b.kind === 'math') {
      const p = texParts(b.text ?? '');
      add({ runs: [{ text: p.text, options: { fontFace: p.math ? 'Cambria Math' : 'Calibri', color: p.color, align: 'center' } }], level: 0 });
    } else if (b.kind === 'table' && b.table) {
      flush(continued);
      const s = pptx.addSlide();
      s.addText(title, { x: 0.5, y: 0.3, w: 12.3, h: 0.8, fontSize: 28, bold: true, color: BRAND.maroon, fontFace: 'Calibri' });
      const head = b.table.header.map((c) => ({ text: inlineText(c), options: { bold: true, color: 'FFFFFF', fill: { color: BRAND.maroon } } }));
      const rows = b.table.rows.map((r) => r.map((c) => ({ text: inlineText(c) })));
      s.addTable([head, ...rows], { x: 0.5, y: 1.35, w: 12.3, fontSize: 13, fontFace: 'Calibri', color: BRAND.ink, border: { type: 'solid', pt: 0.5, color: 'BFBFBF' }, autoPage: true, autoPageRepeatHeader: true });
      continued = true;
    }
  }
  flush(continued);
  return (await pptx.write({ outputType: 'blob' })) as Blob;
}

// ---------------------------------------------------------------------------
// Excel (.xlsx): a small writer (Office Open XML in a zip), no big library.
// ---------------------------------------------------------------------------

const xmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const colName = (i: number) => {
  let n = i + 1;
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

export interface Sheet {
  name: string;
  rows: string[][];
  /** First row is a header. */
  header?: boolean;
}

/** Build an .xlsx file. Numbers become numeric cells; the header row is bold. */
export async function buildXlsx(sheets: Sheet[]): Promise<Uint8Array> {
  const { zipSync, strToU8 } = await import('fflate');
  const used = new Set<string>();
  const names = sheets.map((s, i) => {
    let n = (s.name || `Sheet ${i + 1}`).replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || `Sheet ${i + 1}`;
    let k = 2;
    while (used.has(n.toLowerCase())) n = `${n.slice(0, 28)} ${k++}`;
    used.add(n.toLowerCase());
    return n;
  });
  const files: Record<string, Uint8Array> = {};
  const NS = 'http://schemas.openxmlformats.org';
  files['[Content_Types].xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="${NS}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
  );
  files['_rels/.rels'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${NS}/package/2006/relationships"><Relationship Id="rId1" Type="${NS}/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  files['xl/workbook.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${NS}/spreadsheetml/2006/main" xmlns:r="${NS}/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${xmlEsc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`);
  files['xl/_rels/workbook.xml.rels'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${NS}/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${NS}/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="${NS}/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  );
  files['xl/styles.xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="${NS}/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF${BRAND.maroon}"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
  );
  sheets.forEach((sh, i) => {
    const width = new Array(Math.max(1, ...sh.rows.map((r) => r.length))).fill(8) as number[];
    sh.rows.forEach((r) => r.forEach((c, j) => (width[j] = Math.min(70, Math.max(width[j], Math.ceil((c ?? '').length * 1.1) + 2)))));
    const rows = sh.rows
      .map((r, ri) => {
        const cells = r
          .map((c, ci) => {
            const ref = `${colName(ci)}${ri + 1}`;
            const v = (c ?? '').trim();
            const head = sh.header && ri === 0;
            if (!head && /^-?\d+(\.\d+)?$/.test(v.replace(/,/g, '')) && v.replace(/,/g, '').length < 16) return `<c r="${ref}" s="2"><v>${v.replace(/,/g, '')}</v></c>`;
            return `<c r="${ref}" t="inlineStr" s="${head ? 1 : 0}"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
          })
          .join('');
        return `<row r="${ri + 1}">${cells}</row>`;
      })
      .join('');
    const cols = width.map((w, j) => `<col min="${j + 1}" max="${j + 1}" width="${w}" customWidth="1"/>`).join('');
    const freeze = sh.header ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' : '';
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${NS}/spreadsheetml/2006/main">${freeze}<cols>${cols}</cols><sheetData>${rows}</sheetData></worksheet>`);
  });
  return zipSync(files, { level: 6 });
}

/** Sheets from an answer: one per table, one with the text, one with the sources. */
export function answerSheets(input: ExportInput): Sheet[] {
  const blocks = toBlocks(input.markdown);
  const sheets: Sheet[] = [];
  let lastHeading = '';
  let n = 0;
  for (const b of blocks) {
    if (b.kind === 'heading') lastHeading = inlineText(b.inline);
    if (b.kind === 'table' && b.table) {
      n += 1;
      sheets.push({ name: lastHeading ? `${n}. ${lastHeading}` : `Table ${n}`, header: true, rows: [b.table.header.map(inlineText), ...b.table.rows.map((r) => r.map(inlineText))] });
    }
  }
  const text: string[][] = [['Part', 'Text']];
  for (const b of blocks) {
    if (b.kind === 'heading') text.push([`Heading ${b.depth}`, inlineText(b.inline)]);
    else if (b.kind === 'para' || b.kind === 'quote') text.push([b.kind === 'quote' ? 'Quote' : 'Paragraph', inlineText(b.inline)]);
    else if (b.kind === 'item') text.push([`${b.ordered ? 'Numbered' : 'Bullet'} item${b.level ? ` (level ${b.level + 1})` : ''}`, inlineText(b.inline)]);
    else if (b.kind === 'code') text.push(['Code', b.text ?? '']);
    else if (b.kind === 'math') text.push(['Formula', texParts(b.text ?? '').text]);
  }
  sheets.push({ name: 'Answer text', header: true, rows: text });
  if (input.sources?.length) {
    sheets.push({
      name: 'Sources (APA 7th)',
      header: true,
      rows: [['No.', 'APA 7th reference', 'In-text citation', 'Type', 'Date', 'Link'], ...input.sources.map((s, i) => [String(i + 1), s.apaRef ?? s.title, s.apaInText ?? '', s.kind ?? '', s.date?.slice(0, 10) ?? '', s.url])],
    });
  }
  return sheets;
}

// ---------------------------------------------------------------------------
// PDF (the browser's own print-to-PDF keeps text selectable and maths sharp)
// ---------------------------------------------------------------------------

const PRINT_CSS = `
  @page { margin: 18mm 16mm; }
  body { font: 11.5pt/1.55 Calibri, 'Segoe UI', Arial, sans-serif; color: #2b1a12; margin: 0; }
  h1.doc-title { font-size: 22pt; color: #8b1e2d; margin: 0 0 2pt; }
  .meta { color: #6b5b50; font-size: 9pt; margin-bottom: 14pt; border-bottom: 2px solid #f39a32; padding-bottom: 6pt; }
  h1, h2, h3, h4 { color: #8b1e2d; break-after: avoid; }
  a { color: #0b57d0; word-break: break-word; }
  table { border-collapse: collapse; width: 100%; margin: 8pt 0; font-size: 10pt; break-inside: avoid; }
  th, td { border: 1px solid #bfbfbf; padding: 4pt 6pt; text-align: left; vertical-align: top; }
  th { background: #f6e3d1; }
  pre { background: #f3f0ec; padding: 8pt; border-radius: 4pt; white-space: pre-wrap; font-size: 9.5pt; }
  code { font-family: Consolas, 'Courier New', monospace; }
  blockquote { border-left: 3px solid #f39a32; margin: 8pt 0; padding: 2pt 10pt; color: #4a3a30; }
  .codeblock-head, .codeblock-actions, .cb-btn { display: none !important; }
  .math-block, .katex-display { margin: 8pt 0; text-align: center; }
  img { max-width: 100%; }
`;

function printPdf(input: ExportInput): Promise<void> {
  const html = renderMarkdown(input.markdown);
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  // Re-use KaTeX's stylesheet so formulas look the same as in the app.
  const css = [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].filter((l) => /katex/i.test(l.href)).map((l) => `<link rel="stylesheet" href="${l.href}">`).join('')
    + [...document.querySelectorAll('style')].filter((s) => s.textContent?.includes('.katex')).map((s) => `<style>${s.textContent}</style>`).join('');
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.className = 'jeea-print-frame';
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(input.title)}</title>${css}<style>${PRINT_CSS}</style></head><body><h1 class="doc-title">${esc(input.title)}</h1><div class="meta">Made with JeeA! · ${esc(new Date().toLocaleString())}</div><main>${html}</main></body></html>`);
  doc.close();
  return new Promise((resolve) => {
    const go = () => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      } finally {
        setTimeout(() => frame.remove(), 60_000);
        resolve();
      }
    };
    // Give stylesheets and fonts a moment to load.
    const fonts = (doc as Document & { fonts?: FontFaceSet }).fonts;
    setTimeout(() => (fonts ? fonts.ready.then(go, go) : go()), 350);
  });
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

async function toImage(input: ExportInput, format: 'png' | 'jpeg' | 'svg'): Promise<string> {
  if (!input.node) throw new Error('Nothing to capture.');
  const lib = await import('html-to-image');
  const bg = getComputedStyle(document.body).backgroundColor || '#ffffff';
  const opts = {
    backgroundColor: bg,
    pixelRatio: Math.min(3, Math.max(2, window.devicePixelRatio || 1)),
    cacheBust: true,
    filter: (n: HTMLElement) => !(n.classList?.contains('msg-actions') || n.classList?.contains('export-btn') || n.classList?.contains('codeblock-actions')),
    style: { margin: '0', padding: '18px' },
  };
  if (format === 'svg') return lib.toSvg(input.node, opts);
  if (format === 'jpeg') return lib.toJpeg(input.node, { ...opts, quality: 0.95 });
  return lib.toPng(input.node, opts);
}

// ---------------------------------------------------------------------------

export async function exportAs(format: ExportFormat, input: ExportInput): Promise<void> {
  const md = withSources(input.markdown, input.sources);
  const data = { ...input, markdown: md };
  const base = fileBase(input.title);
  switch (format) {
    case 'md':
      return downloadText(`${base}.md`, `# ${input.title}\n\n${md}`, 'text/markdown');
    case 'docx':
      return saveBlob(await toDocx(data), `${base}.docx`);
    case 'pptx':
      return saveBlob(await toPptx(data), `${base}.pptx`);
    case 'xlsx':
      return saveBlob(new Blob([(await buildXlsx(answerSheets(data))) as Uint8Array<ArrayBuffer>], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${base}.xlsx`);
    case 'pdf':
      return printPdf(data);
    case 'png':
    case 'jpeg':
    case 'svg': {
      const url = await toImage(input, format);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${base}.${format === 'jpeg' ? 'jpg' : format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      return;
    }
  }
}
