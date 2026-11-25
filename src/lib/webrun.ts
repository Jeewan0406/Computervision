// App side of the automatic web search: reads the setting, runs the search
// as a stoppable job, logs it and builds the system text for the model.
import { authHeaders } from './account';
import type { View } from './types';
import { dateLine, searchQuery, webDecision, webPrompt, webSearch, type WebSource } from './web';
import { gatewayInfo, useSettings } from './settings';
import { withApa } from './apa';
import { loadNewsIndex, searchNews } from './news';
import { newsIndexUrl } from './repo';
import { endJob, startJob } from './runner';
import { log } from './logs';
import { isAbort } from './utils';

export interface WebInfo {
  query: string;
  at: number;
  /** Shown when nothing useful was found. */
  note?: string;
}

export interface WebResult {
  /** System text: always the date; plus the numbered results when searched. */
  prompt: string;
  web?: WebInfo;
  sources?: WebSource[];
  aborted?: boolean;
}

/**
 * Search the web for a message when the Web setting allows it ("Auto" decides
 * by itself). Never throws: a failed search just returns the date line.
 */
export async function prepareWeb(
  text: string,
  opts: { jobId: string; feature: View; previous?: string; onStart?: (info: WebInfo) => void },
): Promise<WebResult> {
  const mode = useSettings.getState().webMode;
  const d = webDecision(text, mode);
  if (!d.search) return { prompt: dateLine() };
  const query = searchQuery(text, opts.previous);
  const info: WebInfo = { query, at: Date.now() };
  opts.onStart?.(info);
  const ctrl = startJob(`${opts.jobId}:web`);
  const t0 = performance.now();
  try {
    const gw = gatewayInfo();
    const allowNews = useSettings.getState().trustedNews !== false;
    const found = await webSearch({
      query,
      news: d.news,
      gateway: gw ? gw.baseUrl.replace(/\/v1$/, '') : null,
      gatewayHeaders: authHeaders(),
      signal: ctrl.signal,
      trusted: async (signal) => searchNews(await loadNewsIndex(newsIndexUrl(), undefined, signal), query, { text, allowNews, max: d.news ? 9 : 7 }),
    });
    const errors = found.errors;
    const sources = withApa(found.sources);
    const ms = Math.round(performance.now() - t0);
    log({
      level: sources.length ? 'info' : 'warn',
      type: 'system',
      feature: opts.feature,
      message: `Web search "${query}" (${d.reason}): ${sources.length} result${sources.length === 1 ? '' : 's'} in ${ms} ms${errors.length ? `; failed: ${errors.join('; ')}` : ''}`,
    });
    const note = sources.length ? undefined : errors.length ? 'the search could not be reached' : 'no useful results';
    return { prompt: webPrompt(query, sources, undefined, undefined, { rules: rulesOn() }), web: { ...info, note }, sources: sources.length ? sources : undefined };
  } catch (e) {
    if (isAbort(e) || ctrl.signal.aborted) return { prompt: '', web: info, aborted: true };
    return { prompt: webPrompt(query, [], undefined, undefined, { rules: rulesOn() }), web: { ...info, note: 'the search failed' } };
  } finally {
    endJob(`${opts.jobId}:web`);
  }
}

const rulesOn = () => !!useSettings.getState().answerRules?.enabled;

/** Join system texts (answer rules, the chat's own system prompt, web/date text), skipping empty ones. */
export const joinSystem = (...parts: (string | undefined)[]) => parts.map((p) => (p ?? '').trim()).filter(Boolean).join('\n\n');
