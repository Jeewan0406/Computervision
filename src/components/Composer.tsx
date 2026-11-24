import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUp, FileText, Loader2, Paperclip, Square, X } from 'lucide-react';
import { useSettings } from '../lib/settings';
import { useUI } from '../lib/ui';
import type { ImageAtt } from '../lib/types';
import { ATTACH_ACCEPT, MAX_ATTACH_CHARS, isPicture, loadPicture, pasteAction } from '../lib/attach';
import { extractText } from '../lib/extract';
import { uid } from '../lib/utils';

interface Attachment {
  id: string;
  name: string;
  /** Text read from a document or code file. */
  text?: string;
  /** A picture (sent to models that can see images). */
  image?: ImageAtt;
  /** Still being read. */
  loading?: boolean;
  /** Extra line shown on hover (pages, cut, ...). */
  note?: string;
}

/**
 * Message box with auto-grow, Enter-to-send, stop button and attachments:
 * text and code files, PDF, Word, PowerPoint and Excel are read in the
 * browser and sent as text; pictures are sent as pictures where `allowImages`.
 */
export function Composer({
  onSend,
  onStop,
  busy,
  placeholder = 'Message JeeA!…',
  left,
  hint,
  context,
  allowImages = false,
  autoFocus = true,
}: {
  onSend: (text: string, images?: ImageAtt[]) => void;
  onStop?: () => void;
  busy?: boolean;
  placeholder?: string;
  left?: ReactNode;
  hint?: ReactNode;
  /** Small badges before the hint (project, custom instructions, rules). */
  context?: ReactNode;
  /** Pictures can be sent (Chat, Compare). Elsewhere they are refused with a note. */
  allowImages?: boolean;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<Attachment[]>([]);
  const ta = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const sendOnEnter = useSettings((s) => s.sendOnEnter);
  const toast = useUI((s) => s.toast);
  const reading = files.some((f) => f.loading);

  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 280)}px`;
  }, [text]);

  const submit = () => {
    const body = text.trim();
    const ready = files.filter((f) => !f.loading);
    if ((!body && !ready.length) || busy || reading) return;
    const att = ready
      .filter((f) => f.text != null)
      .map((f) => `\n\n**Attached file: ${f.name}**\n\`\`\`\n${f.text}\n\`\`\``)
      .join('');
    const images = ready.flatMap((f) => (f.image ? [f.image] : []));
    const message = (body + att).trim() || (images.length ? 'Please look at the attached picture.' : '');
    onSend(message, images.length ? images : undefined);
    setText('');
    setFiles([]);
  };

  const patchFile = (id: string, patch: Partial<Attachment> | null) =>
    setFiles((cur) => (patch ? cur.map((f) => (f.id === id ? { ...f, ...patch } : f)) : cur.filter((f) => f.id !== id)));

  const addFiles = (list: File[]) => {
    for (const f of list) {
      const id = uid();
      if (isPicture(f)) {
        if (!allowImages) {
          toast(`${f.name || 'Picture'}: pictures can be sent in Chat and Compare. Here, attach documents or paste text.`, 'error');
          continue;
        }
        if (f.size > 25_000_000) {
          toast(`${f.name} is larger than 25 MB.`, 'error');
          continue;
        }
        setFiles((cur) => [...cur, { id, name: f.name || 'picture', loading: true }]);
        loadPicture(f).then(
          (image) => patchFile(id, { image, loading: false }),
          (e: Error) => {
            patchFile(id, null);
            toast(e.message, 'error');
          },
        );
        continue;
      }
      setFiles((cur) => [...cur, { id, name: f.name, loading: true }]);
      extractText(f).then(
        (r) => {
          const cut = r.text.length > MAX_ATTACH_CHARS;
          const body = cut ? `${r.text.slice(0, MAX_ATTACH_CHARS)}\n…(cut at ${MAX_ATTACH_CHARS.toLocaleString()} characters)` : r.text;
          if (!r.text.trim()) {
            patchFile(id, null);
            toast(`${f.name} has no text that can be read.`, 'error');
            return;
          }
          const pages = r.pages ? `${r.pages.length} page${r.pages.length === 1 ? '' : 's'}, ` : '';
          patchFile(id, { text: body, loading: false, note: `${pages}${r.text.length.toLocaleString()} characters${cut ? ' (cut)' : ''}` });
        },
        (e: Error) => {
          patchFile(id, null);
          toast(`${f.name}: ${e.message}`, 'error');
        },
      );
    }
  };

  return (
    <div className="composer-wrap">
      <div
        className="composer"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          addFiles(Array.from(e.dataTransfer.files));
        }}
      >
        {files.length > 0 && (
          <div className="attachments">
            {files.map((f) => (
              <span key={f.id} className={`attachment${f.image ? ' attachment-pic' : ''}`} title={f.note ?? f.name}>
                {f.loading ? <Loader2 size={13} className="spin" /> : f.image ? <img src={f.image.dataUrl} alt="" /> : <FileText size={13} />}
                <span className="attachment-name">{f.name}</span>
                {f.loading && <span className="muted xs">reading…</span>}
                <button className="icon-btn xs" onClick={() => patchFile(f.id, null)} aria-label={`Remove ${f.name}`}>
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={ta}
          rows={1}
          value={text}
          autoFocus={autoFocus}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const cd = e.clipboardData;
            const list = Array.from(cd.files);
            if (pasteAction(cd.getData('text/plain'), list) === 'files') {
              e.preventDefault();
              addFiles(list);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              const wantSend = sendOnEnter ? !e.shiftKey : e.ctrlKey || e.metaKey;
              if (wantSend) {
                e.preventDefault();
                submit();
              }
            }
          }}
          aria-label="Message"
        />
        <div className="composer-bar">
          <div className="composer-left">
            <button
              className="icon-btn"
              title={allowImages ? 'Attach files or pictures: PDF, Word, PowerPoint, Excel, text, code, images' : 'Attach files: PDF, Word, PowerPoint, Excel, text, code'}
              aria-label="Attach files"
              onClick={() => fileInput.current?.click()}
            >
              <Paperclip size={17} />
            </button>
            <input ref={fileInput} type="file" multiple hidden accept={ATTACH_ACCEPT} onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
            {left}
          </div>
          {busy ? (
            <button className="send-btn stop" onClick={onStop} title="Stop">
              <Square size={14} fill="currentColor" />
            </button>
          ) : (
            <button className="send-btn" onClick={submit} disabled={reading || (!text.trim() && !files.length)} title={reading ? 'Still reading a file…' : 'Send'}>
              <ArrowUp size={18} />
            </button>
          )}
        </div>
      </div>
      <div className="composer-hint">
        {context}
        <span>{hint ?? (sendOnEnter ? 'Enter to send · Shift + Enter for a new line' : 'Ctrl/⌘ + Enter to send')}</span>
      </div>
    </div>
  );
}
