import { Globe } from 'lucide-react';
import { useSettings } from '../lib/settings';
import type { WebMode, WebSource } from '../lib/web';

const NEXT: Record<WebMode, WebMode> = { on: 'auto', auto: 'off', off: 'on' };
const LABEL: Record<WebMode, string> = { auto: 'Auto', on: 'On', off: 'Off' };
export const WEB_HELP: Record<WebMode, string> = {
  on: 'Web: On. Every question searches the web first, so answers use the latest information (greetings such as "hi" are skipped). Click for Auto.',
  auto: 'Web: Auto. JeeA! searches only when a question seems to need fresh facts (news, dates, prices, people, versions). Click to turn web search off.',
  off: 'Web: Off. Answers use only what the model already knows, which may be out of date. Click to search for every question.',
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
  if (s.kind === 'scholarly') {
    const first = s.authors?.[0]?.split(/\s+/).pop() ?? s.site;
    const more = (s.authors?.length ?? 0) > 1 ? ' et al.' : '';
    return `📄 ${first}${more} ${s.date?.slice(0, 4) ?? ''} · ${short}`;
  }
  const icon = s.kind === 'official' ? '🏛 ' : s.kind === 'news' ? '📰 ' : '';
  return `${icon}${s.site} · ${short}`;
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
            title={`${s.apaRef ?? s.title}\n\n${s.snippet.slice(0, 220)}`}
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
