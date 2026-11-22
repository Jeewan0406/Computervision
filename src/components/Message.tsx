import { memo, useMemo, useState, type MouseEvent } from 'react';
import { AlertTriangle, Brain, Check, ChevronDown, ChevronRight, Copy, Gauge, Pencil, Play, RotateCcw, Timer, Zap } from 'lucide-react';
import type { Message } from '../lib/types';
import { renderMarkdown, extFor } from '../lib/markdown';
import { splitThink, extractRunnable } from '../lib/text';
import { copyText, downloadText, fmtMs, fmtNum } from '../lib/utils';
import { openInCodeFrame } from '../lib/actions';
import { useSettings, allProviders } from '../lib/settings';
import { useUI } from '../lib/ui';
import { ModelBadge } from './ModelPicker';
import { SourcesBar } from './Web';
import { linkCitations } from '../lib/web';

/** Markdown with working "Copy / Download / Run" buttons on code blocks. */
export const Markdown = memo(function Markdown({ text, className = '' }: { text: string; className?: string }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  const toast = useUI((s) => s.toast);
  const onClick = async (e: MouseEvent<HTMLDivElement>) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!btn) return;
    const blockEl = btn.closest<HTMLElement>('.codeblock');
    const code = blockEl?.querySelector('code')?.textContent ?? '';
    const lang = blockEl?.dataset.lang ?? '';
    if (btn.dataset.act === 'copy') {
      if (await copyText(code)) {
        btn.textContent = 'Copied';
        setTimeout(() => (btn.textContent = 'Copy'), 1400);
      }
    } else if (btn.dataset.act === 'download') {
      downloadText(`jeea-snippet.${extFor(lang)}`, code);
    } else if (btn.dataset.act === 'run') {
      openInCodeFrame(code, lang);
      toast('Opened in CodeFrame', 'success');
    }
  };
  return <div className={`md ${className}`} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
});

export function Metrics({ m }: { m: Message }) {
  const meta = m.meta;
  if (!meta) return null;
  // Only meaningful when text streamed for a while; a reply that arrives in
  // one burst would give a huge, meaningless number.
  const streamMs = meta.totalMs != null && meta.ttftMs != null ? meta.totalMs - meta.ttftMs : 0;
  const tps = meta.tokensOut && !meta.estimated && streamMs >= 300 ? meta.tokensOut / (streamMs / 1000) : undefined;
  return (
    <div className="metrics">
      <span title="Time to first token"><Zap size={12} /> {fmtMs(meta.ttftMs)}</span>
      <span title="Total time"><Timer size={12} /> {fmtMs(meta.totalMs)}</span>
      {tps != null && isFinite(tps) && <span title="Output tokens per second"><Gauge size={12} /> {tps.toFixed(0)} tok/s</span>}
      <span title={meta.estimated ? 'Estimated (≈4 characters per token)' : 'Reported by the provider'}>
        {meta.estimated ? '≈' : ''}{fmtNum(meta.tokensIn)} in · {meta.estimated ? '≈' : ''}{fmtNum(meta.tokensOut)} out
      </span>
      {meta.slotLabel && <span className="metric-key" title="API slot used">🔑 {meta.slotLabel}</span>}
      {meta.fellBackFrom && <span className="metric-warn" title="The first choice failed">↪ fallback from {meta.fellBackFrom}</span>}
    </div>
  );
}

export function Reasoning({ text, streaming }: { text: string; streaming?: boolean }) {
  const show = useSettings((s) => s.showReasoning);
  const [open, setOpen] = useState(false);
  if (!text || !show) return null;
  return (
    <div className={`reasoning${open ? ' open' : ''}`}>
      <button className="reasoning-toggle" onClick={() => setOpen((o) => !o)}>
        <Brain size={14} />
        <span>{streaming ? 'Thinking…' : 'Reasoning'}</span>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {open && <div className="reasoning-body">{text}</div>}
    </div>
  );
}

export const MessageItem = memo(function MessageItem({
  m,
  onRegenerate,
  onEdit,
  onRetry,
  showModel = true,
  displayText,
}: {
  m: Message;
  onRegenerate?: () => void;
  onEdit?: (text: string) => void;
  onRetry?: () => void;
  showModel?: boolean;
  /** Override what is shown (CodeFrame hides long code). */
  displayText?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.content);
  const streaming = m.status === 'streaming';

  if (m.role === 'user') {
    return (
      <div className="msg msg-user">
        {editing ? (
          <div className="msg-edit">
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={Math.min(12, draft.split('\n').length + 1)} autoFocus />
            <div className="row gap-8 end">
              <button className="btn ghost sm" onClick={() => setEditing(false)}>Cancel</button>
              <button
                className="btn primary sm"
                onClick={() => {
                  setEditing(false);
                  onEdit?.(draft);
                }}
              >
                Save & send
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="bubble-user">{m.content}</div>
            <div className="msg-actions">
              <button className="icon-btn xs" title="Copy" onClick={async () => setCopied(await copyText(m.content))}>
                {copied ? <Check size={13} /> : <Copy size={13} />}
              </button>
              {onEdit && (
                <button className="icon-btn xs" title="Edit and resend" onClick={() => { setDraft(m.content); setEditing(true); }}>
                  <Pencil size={13} />
                </button>
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  const split = m.reasoning ? { reasoning: m.reasoning, answer: m.content } : splitThink(m.content);
  const text = displayText ?? split.answer;
  const shown = m.sources ? linkCitations(text, m.sources) : text;
  const provider = m.model ? allProviders().find((p) => p.id === m.model!.providerId) : undefined;
  const runnable = !streaming && m.content.includes('```') ? extractRunnable(m.content) : null;

  return (
    <div className={`msg msg-assistant${streaming ? ' streaming' : ''}`}>
      <div className="avatar" style={{ background: provider?.color ?? 'var(--accent)' }}>
        {(provider?.name ?? 'AI').slice(0, 1)}
      </div>
      <div className="msg-body">
        {showModel && m.model && (
          <div className="msg-head">
            <ModelBadge r={m.model} />
            {provider && <span className="muted xs">{provider.name}</span>}
          </div>
        )}
        <Reasoning text={split.reasoning} streaming={streaming && !text} />
        {m.statusText && <div className="status-line"><span className="pulse-dot" />{m.statusText}</div>}
        {text ? <Markdown text={shown} /> : streaming && !split.reasoning && !m.statusText ? <TypingDots /> : null}
        {(m.sources || (!streaming && m.web?.note)) && <SourcesBar sources={m.sources} web={m.web} />}
        {m.status === 'error' && (
          <div className="msg-error">
            <AlertTriangle size={15} />
            <span>{m.error || 'Something went wrong.'}</span>
            {onRetry && <button className="btn ghost sm" onClick={onRetry}><RotateCcw size={13} /> Retry</button>}
          </div>
        )}
        {m.status === 'stopped' && <div className="muted xs">Stopped.</div>}
        {!streaming && (
          <div className="msg-foot">
            <Metrics m={m} />
            <div className="msg-actions">
              <button className="icon-btn xs" title="Copy answer" onClick={async () => setCopied(await copyText(text))}>
                {copied ? <Check size={13} /> : <Copy size={13} />}
              </button>
              {runnable && (
                <button className="icon-btn xs" title="Run this answer in CodeFrame" onClick={() => openInCodeFrame(runnable, 'html')}>
                  <Play size={13} />
                </button>
              )}
              {onRegenerate && (
                <button className="icon-btn xs" title="Regenerate" onClick={onRegenerate}>
                  <RotateCcw size={13} />
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

export function TypingDots() {
  return (
    <div className="typing" aria-label="Thinking">
      <span />
      <span />
      <span />
    </div>
  );
}
