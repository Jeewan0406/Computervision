import { Globe } from 'lucide-react';
import { useSettings } from '../lib/settings';
import type { WebMode, WebSource } from '../lib/web';

const NEXT: Record<WebMode, WebMode> = { auto: 'on', on: 'off', off: 'auto' };
const LABEL: Record<WebMode, string> = { auto: 'Auto', on: 'On', off: 'Off' };
export const WEB_HELP: Record<WebMode, string> = {
  auto: 'Web: Auto. JeeA! searches the web by itself when a question needs fresh facts (news, dates, prices, people, versions). Click to search for every message.',
  on: 'Web: On. Every message searches the web first. Click to turn web search off.',
  off: 'Web: Off. Answers use only what the model already knows. Click for Auto.',
};

/** Small "🌐 Auto / On / Off" button for the chat box. */
export function WebToggle() {
  const mode = useSettings((s) => s.webMode);
  const set = useSettings((s) => s.set);
  return (
    <button
      type="button"
      className={`web-toggle web-${mode}`}
      onClick={() => set({ webMode: NEXT[mode] })}
      title={WEB_HELP[mode]}
      aria-label={WEB_HELP[mode]}
    >
      <Globe size={14} />
      <span>{LABEL[mode]}</span>
    </button>
  );
}

const chipText = (s: WebSource) => {
  const t = s.title.replace(/^Wikipedia: /, '');
  const short = t.length > 30 ? `${t.slice(0, 29)}…` : t;
  return s.site === 'Wikipedia' ? `Wikipedia · ${short}` : `${s.site} · ${short}`;
};

/** "Sources" chips under an answer, or a short note when the search found nothing. */
export function SourcesBar({ sources, web }: { sources?: WebSource[]; web?: { query: string; note?: string } }) {
  if (sources?.length) {
    return (
      <div className="sources" aria-label="Web sources">
        <span className="sources-label"><Globe size={12} /> Sources</span>
        {sources.map((s) => (
          <a
            key={s.n}
            className="source-chip"
            href={s.url}
            target="_blank"
            rel="noreferrer"
            title={`${s.title}${s.date ? ` (${s.date})` : ''}\n${s.snippet.slice(0, 220)}`}
          >
            <span className="source-n">{s.n}</span>
            <span className="source-text">{chipText(s)}</span>
          </a>
        ))}
      </div>
    );
  }
  if (web?.note) {
    return (
      <div className="web-note">
        <Globe size={12} /> Searched the web for “{web.query}”: {web.note}.
      </div>
    );
  }
  return null;
}
