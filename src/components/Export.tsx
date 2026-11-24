import { useRef, useState, type ComponentType } from 'react';
import { FileCode, FileDown, FileSpreadsheet, FileText, FileType, Image as ImageIcon, Presentation } from 'lucide-react';
import { Popover } from './Popover';
import { useUI } from '../lib/ui';
import type { ExportFormat } from '../lib/exporter';
import type { WebSource } from '../lib/web';

const ITEMS: { id: ExportFormat; label: string; hint: string; Icon: ComponentType<{ size?: number }> }[] = [
  { id: 'docx', label: 'Word document', hint: '.docx', Icon: FileText },
  { id: 'pdf', label: 'PDF', hint: 'print → Save as PDF', Icon: FileType },
  { id: 'xlsx', label: 'Excel workbook', hint: '.xlsx · tables, text, sources', Icon: FileSpreadsheet },
  { id: 'pptx', label: 'PowerPoint slides', hint: '.pptx', Icon: Presentation },
  { id: 'md', label: 'Markdown', hint: '.md', Icon: FileCode },
  { id: 'png', label: 'Image', hint: '.png', Icon: ImageIcon },
  { id: 'jpeg', label: 'Image', hint: '.jpg', Icon: ImageIcon },
  { id: 'svg', label: 'Image', hint: '.svg', Icon: ImageIcon },
];

/** First heading or sentence of an answer, as a document title. */
export function titleOf(md: string, fallback = 'JeeA! answer'): string {
  const h = /^#{1,3}\s+(.+)$/m.exec(md)?.[1];
  const first = (h ?? md.replace(/[#*_`>[\]()$\\]/g, '').split(/(?<=[.!?])\s|\n/).find((s) => s.trim().length > 3) ?? '').trim();
  return (first.length > 70 ? `${first.slice(0, 67)}…` : first) || fallback;
}

/** "Export" button: Word, PDF, Excel, PowerPoint, Markdown or an image. */
export function ExportMenu({
  title,
  getMarkdown,
  sources,
  getNode,
  label,
}: {
  title: string;
  getMarkdown: () => string;
  sources?: WebSource[];
  /** The element to capture for image exports (given the button). */
  getNode?: (btn: HTMLElement | null) => HTMLElement | null;
  label?: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const toast = useUI((s) => s.toast);
  const run = async (f: ExportFormat) => {
    setBusy(f);
    try {
      const node = getNode ? getNode(ref.current) : null;
      const ex = await import('../lib/exporter');
      await ex.exportAs(f, { title, markdown: getMarkdown(), node, sources });
      toast(f === 'pdf' ? 'In the print window, choose "Save as PDF".' : 'Download started.', 'success');
      setOpen(false);
    } catch (e) {
      toast(`Export failed: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <button ref={ref} className={`icon-btn ${label ? '' : 'xs'} export-btn`} title="Export: Word, PDF, Excel, PowerPoint or image" aria-label="Export" onClick={() => setOpen((o) => !o)}>
        <FileDown size={label ? 17 : 13} />
        {label && <span className="export-label">{label}</span>}
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} width={280} align="end">
        <div className="export-menu" role="menu">
          <div className="export-head">Export as</div>
          {ITEMS.filter((it) => getNode || !['png', 'jpeg', 'svg'].includes(it.id)).map(({ id, label: l, hint, Icon }) => (
            <button key={id} role="menuitem" className="export-item" disabled={!!busy} onClick={() => run(id)} data-format={id}>
              <Icon size={16} />
              <span className="ei-label">{l}</span>
              <span className="ei-hint">{busy === id ? 'Working…' : hint}</span>
            </button>
          ))}
        </div>
      </Popover>
    </>
  );
}
