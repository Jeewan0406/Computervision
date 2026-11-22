import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUp, FileText, Paperclip, Square, X } from 'lucide-react';
import { useSettings } from '../lib/settings';
import { useUI } from '../lib/ui';

interface Attachment {
  name: string;
  text: string;
}

const MAX_FILE = 200_000; // characters per attached file

/** Message box with auto-grow, Enter-to-send, stop button and text-file attachments. */
export function Composer({
  onSend,
  onStop,
  busy,
  placeholder = 'Message JeeA!…',
  left,
  hint,
  autoFocus = true,
}: {
  onSend: (text: string) => void;
  onStop?: () => void;
  busy?: boolean;
  placeholder?: string;
  left?: ReactNode;
  hint?: ReactNode;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<Attachment[]>([]);
  const ta = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const sendOnEnter = useSettings((s) => s.sendOnEnter);
  const toast = useUI((s) => s.toast);

  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 280)}px`;
  }, [text]);

  const submit = () => {
    const body = text.trim();
    if ((!body && !files.length) || busy) return;
    const att = files.map((f) => `\n\n**Attached file: ${f.name}**\n\`\`\`\n${f.text}\n\`\`\``).join('');
    onSend((body + att).trim());
    setText('');
    setFiles([]);
  };

  const addFiles = async (list: FileList | null) => {
    if (!list) return;
    const next: Attachment[] = [];
    for (const f of Array.from(list)) {
      if (f.size > 2_000_000) {
        toast(`${f.name} is too large (max 2 MB).`, 'error');
        continue;
      }
      const t = await f.text();
      if (/\u0000/.test(t.slice(0, 1000))) {
        toast(`${f.name} looks like a binary file. Only text files can be attached.`, 'error');
        continue;
      }
      next.push({ name: f.name, text: t.length > MAX_FILE ? `${t.slice(0, MAX_FILE)}\n…(cut at ${MAX_FILE} characters)` : t });
    }
    setFiles((cur) => [...cur, ...next]);
  };

  return (
    <div className="composer-wrap">
      <div
        className="composer"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          addFiles(e.dataTransfer.files);
        }}
      >
        {files.length > 0 && (
          <div className="attachments">
            {files.map((f, i) => (
              <span key={i} className="attachment">
                <FileText size={13} /> {f.name}
                <button className="icon-btn xs" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label="Remove file">
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
            if (e.clipboardData.files.length) {
              e.preventDefault();
              addFiles(e.clipboardData.files);
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
            <button className="icon-btn" title="Attach text or code files" onClick={() => fileInput.current?.click()}>
              <Paperclip size={17} />
            </button>
            <input ref={fileInput} type="file" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
            {left}
          </div>
          {busy ? (
            <button className="send-btn stop" onClick={onStop} title="Stop">
              <Square size={14} fill="currentColor" />
            </button>
          ) : (
            <button className="send-btn" onClick={submit} disabled={!text.trim() && !files.length} title="Send">
              <ArrowUp size={18} />
            </button>
          )}
        </div>
      </div>
      <div className="composer-hint">
        {hint ?? (sendOnEnter ? 'Enter to send · Shift + Enter for a new line' : 'Ctrl/⌘ + Enter to send')}
      </div>
    </div>
  );
}
