import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Copy, ExternalLink, RefreshCw, XCircle, Clock3, KeyRound, ListChecks, Play } from 'lucide-react';
import { GithubIcon } from '../components/Logo';
import { useSettings } from '../lib/settings';
import { useUI } from '../lib/ui';
import { BUILTIN_PROVIDERS, KEYLESS_ID } from '../lib/providers';
import { copyText, fmtMs } from '../lib/utils';
import { Markdown } from '../components/Message';
import { REPO_URL } from '../components/Shell';
import { detectRepo } from '../lib/repo';

/**
 * 24/7 agents run on GitHub Actions (see .github/workflows/agents.yml and
 * agents/run.mjs). They keep working when every browser is closed. Their
 * results are committed to the "agent-results" branch, and this page reads
 * them from raw.githubusercontent.com.
 */

interface RunRecord {
  task: string;
  name: string;
  at: string;
  status: 'ok' | 'error' | 'skipped';
  model?: string;
  steps?: number;
  ms?: number;
  tokensIn?: number;
  tokensOut?: number;
  summary?: string;
  path?: string;
  error?: string;
}
interface ResultsIndex {
  updatedAt: string;
  tasks: Record<string, { name: string; lastRun?: string; lastStatus?: string; every?: string; model?: string }>;
  runs: RunRecord[];
}

/** Secrets the workflow passes to agents/run.mjs, per provider id. */
export const SERVER_PROVIDERS: { id: string; secret: string }[] = [
  { id: 'gemini', secret: 'GEMINI_API_KEY' },
  { id: 'groq', secret: 'GROQ_API_KEY' },
  { id: 'openrouter', secret: 'OPENROUTER_API_KEY' },
  { id: 'mistral', secret: 'MISTRAL_API_KEY' },
  { id: 'cerebras', secret: 'CEREBRAS_API_KEY' },
  { id: 'openai', secret: 'OPENAI_API_KEY' },
  { id: 'anthropic', secret: 'ANTHROPIC_API_KEY' },
  { id: 'deepseek', secret: 'DEEPSEEK_API_KEY' },
  { id: 'together', secret: 'TOGETHER_API_KEY' },
  { id: 'xai', secret: 'XAI_API_KEY' },
  { id: 'sambanova', secret: 'SAMBANOVA_API_KEY' },
  { id: 'huggingface', secret: 'HF_TOKEN' },
  { id: 'cohere', secret: 'COHERE_API_KEY' },
  { id: 'nvidia', secret: 'NVIDIA_API_KEY' },
];

const SERVER_TOOLS = [
  ['search_wikipedia', '🔎 Search Wikipedia'],
  ['read_wikipedia', '📖 Read Wikipedia'],
  ['fetch_url', '🌐 Read any web page or RSS feed'],
  ['calculate', '🧮 Calculate'],
  ['get_datetime', '🕒 Date and time'],
  ['previous_result', '🗂️ Read its own last result'],
] as const;

const EVERY = ['30m', '1h', '3h', '6h', '12h', '1d', '7d'];

export { detectRepo };

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'my-task';

function TaskBuilder({ repo }: { repo: string }) {
  const toast = useUI((s) => s.toast);
  const [name, setName] = useState('Morning tech digest');
  const [prompt, setPrompt] = useState('Read the Hacker News front page feed (https://news.ycombinator.com/rss) and write a digest of the 5 most interesting stories: one line each, with the link.');
  const [every, setEvery] = useState('1d');
  const [provider, setProvider] = useState('auto');
  const [model, setModel] = useState('');
  const [tools, setTools] = useState<string[]>(['fetch_url', 'get_datetime', 'previous_result']);
  const def = BUILTIN_PROVIDERS.find((p) => p.id === provider);
  const json = useMemo(
    () => JSON.stringify({ id: slug(name), name, enabled: true, every, model: provider === 'auto' ? 'auto' : `${provider}:${model || def?.defaultModel || ''}`, tools, prompt }, null, 2),
    [name, every, provider, model, tools, prompt, def],
  );
  return (
    <div className="card">
      <div className="card-head"><ListChecks size={16} /><h3>Make a new 24/7 task</h3></div>
      <div className="form-grid">
        <label className="field"><span className="field-label">Name</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field">
          <span className="field-label">Run every</span>
          <select value={every} onChange={(e) => setEvery(e.target.value)}>{EVERY.map((x) => <option key={x}>{x}</option>)}</select>
        </label>
        <label className="field">
          <span className="field-label">Provider</span>
          <select value={provider} onChange={(e) => { setProvider(e.target.value); setModel(''); }}>
            <option value="auto">Auto: first provider with a secret, else the free model</option>
            <option value={KEYLESS_ID}>JeeA Free (no secret needed, slow)</option>
            {SERVER_PROVIDERS.map((p) => <option key={p.id} value={p.id}>{BUILTIN_PROVIDERS.find((b) => b.id === p.id)?.name ?? p.id} — secret {p.secret}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Model</span>
          <input value={provider === 'auto' ? '' : model} disabled={provider === 'auto'} onChange={(e) => setModel(e.target.value)} placeholder={provider === 'auto' ? 'chosen automatically' : def?.defaultModel} spellCheck={false} />
        </label>
        <label className="field span-2"><span className="field-label">What should the agent do each time?</span><textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} /></label>
        <div className="field span-2">
          <span className="field-label">Tools</span>
          <div className="row wrap gap-8">
            {SERVER_TOOLS.map(([id, label]) => (
              <label key={id} className={`chip${tools.includes(id) ? ' active' : ''}`}>
                <input type="checkbox" hidden checked={tools.includes(id)} onChange={(e) => setTools(e.target.checked ? [...tools, id] : tools.filter((t) => t !== id))} />
                {label}
              </label>
            ))}
          </div>
        </div>
      </div>
      <pre className="json-out">{json}</pre>
      <div className="row gap-8 wrap">
        <button className="btn primary sm" onClick={async () => (await copyText(`${json},`)) && toast('Task copied. Paste it inside the "tasks" list.', 'success')}><Copy size={14} /> Copy task</button>
        <a className="btn ghost sm" href={`https://github.com/${repo}/edit/main/agents/tasks.json`} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Open agents/tasks.json on GitHub</a>
      </div>
      <p className="muted xs">Paste the task inside the <code>"tasks": [ … ]</code> list, separated by commas, and commit. The next scheduled run picks it up.</p>
    </div>
  );
}

export function ScheduledAgents() {
  const agentRepo = useSettings((s) => s.agentRepo);
  const setSettings = useSettings((s) => s.set);
  const repo = agentRepo || detectRepo() || REPO_URL.replace('https://github.com/', '');
  const [state, setState] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  const [index, setIndex] = useState<ResultsIndex | null>(null);
  const [err, setErr] = useState('');
  const [sel, setSel] = useState<RunRecord | null>(null);
  const [doc, setDoc] = useState('');
  const raw = `https://raw.githubusercontent.com/${repo}/agent-results`;

  const load = useCallback(async () => {
    setState('loading');
    try {
      const r = await fetch(`${raw}/index.json?t=${Date.now()}`, { cache: 'no-store' });
      if (r.status === 404) return setState('empty');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as ResultsIndex;
      setIndex(j);
      setState('ready');
    } catch (e) {
      setErr((e as Error).message);
      setState('error');
    }
  }, [raw]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!sel?.path) return setDoc('');
    setDoc('Loading…');
    fetch(`${raw}/${sel.path}?t=${Date.now()}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setDoc)
      .catch((e) => setDoc(`Could not load the result: ${e.message}`));
  }, [sel, raw]);

  const gh = `https://github.com/${repo}`;
  return (
    <div className="scroll page">
      <div className="page-inner">
        <div className="hero-card">
          <div>
            <h1>Agents that run 24/7</h1>
            <p className="muted">These agents run on <b>GitHub Actions</b> in your repository, on a schedule, even when your computer is off. Each run saves its answer to the <code>agent-results</code> branch, and this page shows it.</p>
          </div>
          <div className="row gap-8 wrap">
            <a className="btn ghost sm" href={`${gh}/actions/workflows/agents.yml`} target="_blank" rel="noreferrer"><Play size={14} /> Run now on GitHub</a>
            <button className="btn ghost sm" onClick={load}><RefreshCw size={14} /> Refresh</button>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><GithubIcon size={16} /><h3>Repository</h3></div>
          <div className="row gap-8 wrap">
            <input className="grow" value={agentRepo} onChange={(e) => setSettings({ agentRepo: e.target.value.trim() })} placeholder={repo} spellCheck={false} />
            <span className="muted xs">Reading results from <code>{repo}</code></span>
          </div>
        </div>

        <div className="setup-steps">
          <div className="setup-step"><span className="n">1</span><div><b>Add a key as a secret</b><p className="muted sm">Settings → Secrets and variables → Actions → New repository secret. For example <code>GEMINI_API_KEY</code> or <code>GROQ_API_KEY</code>. With no secret, tasks use the shared free model.</p><a href={`${gh}/settings/secrets/actions`} target="_blank" rel="noreferrer" className="btn ghost xs"><KeyRound size={12} /> Open secrets</a></div></div>
          <div className="setup-step"><span className="n">2</span><div><b>Choose the tasks</b><p className="muted sm">Edit <code>agents/tasks.json</code>, or build a task below and paste it in.</p><a href={`${gh}/blob/main/agents/tasks.json`} target="_blank" rel="noreferrer" className="btn ghost xs"><ListChecks size={12} /> View tasks</a></div></div>
          <div className="setup-step"><span className="n">3</span><div><b>Let it run</b><p className="muted sm">The workflow checks every hour and runs each task when it is due. Press “Run workflow” on GitHub to start one now.</p><a href={`${gh}/actions/workflows/agents.yml`} target="_blank" rel="noreferrer" className="btn ghost xs"><Clock3 size={12} /> Open the workflow</a></div></div>
        </div>
        <div className="note">
          In a public repository the results are public too. GitHub may delay scheduled runs at busy times, and it switches schedules off in a public repository after 60 days with no repository activity (turn it back on from the Actions tab).
        </div>

        <h2 className="section-title">Results</h2>
        {state === 'loading' && <div className="empty-mini">Loading results…</div>}
        {state === 'empty' && <div className="empty-mini">No results yet. Add a secret (optional), then press “Run workflow” on GitHub. Results appear here a few minutes after the first run.</div>}
        {state === 'error' && <div className="empty-mini">Could not read results from {repo}: {err}. Check the repository name above.</div>}
        {state === 'ready' && index && (
          <div className="results">
            <div className="results-list">
              <div className="muted xs">Updated {new Date(index.updatedAt).toLocaleString()}</div>
              {index.runs.length === 0 && <div className="empty-mini">No runs recorded yet.</div>}
              {index.runs.map((r) => (
                <button key={`${r.task}-${r.at}`} className={`run-item${sel === r ? ' active' : ''}`} onClick={() => setSel(r)}>
                  <span className={`run-status ${r.status}`}>{r.status === 'ok' ? <CheckCircle2 size={14} /> : r.status === 'error' ? <XCircle size={14} /> : <AlertTriangle size={14} />}</span>
                  <span className="run-main">
                    <b>{r.name}</b>
                    <span className="muted xs">{new Date(r.at).toLocaleString()} · {r.model ?? '–'} · {r.steps ?? 0} tools · {fmtMs(r.ms)}</span>
                    <span className="run-sum">{r.error ?? r.summary}</span>
                  </span>
                </button>
              ))}
            </div>
            <div className="results-doc card">
              {sel ? <Markdown text={doc} /> : <div className="muted">Select a run to read its full answer.</div>}
            </div>
          </div>
        )}

        <TaskBuilder repo={repo} />
      </div>
    </div>
  );
}
