import { useEffect, useRef, useState } from 'react';
import { Bot, Check, ChevronDown, ChevronRight, Download, ExternalLink, Loader2, Wrench, X, Clock3 } from 'lucide-react';
import type { AgentSession, AgentStep, Message, ModelRef } from '../lib/types';
import { useData } from '../lib/data';
import { useSettings, getProvider } from '../lib/settings';
import { useUI } from '../lib/ui';
import { stopJobs } from '../lib/runner';
import { runAgent } from '../lib/agent';
import { AGENT_TOOLS, clearMemory, memoryCount } from '../lib/tools';
import { DEFAULT_AGENT_TOOLS, stripToolBlock } from '../lib/agentText';
import { downloadText, fmtMs, fmtNum, titleFrom, uid } from '../lib/utils';
import { TopBar } from '../components/Shell';
import { ModelPicker, ModelBadge } from '../components/ModelPicker';
import { Markdown, Reasoning, TypingDots, MessageItem } from '../components/Message';
import { SourcesBar } from '../components/Web';
import { linkCitations } from '../lib/web';
import { Composer } from '../components/Composer';
import { Popover } from '../components/Popover';
import { useAutoScroll } from '../components/hooks';
import { ScheduledAgents } from './ScheduledAgents';

const EXAMPLES = [
  { title: 'Research with sources', prompt: 'Using Wikipedia, compare Mount Everest and K2: height, first ascent, and death rate. Give a short table and cite the pages you used.' },
  { title: 'Exact maths', prompt: 'If I save 5,000 per month at 7% yearly interest, compounded monthly, how much will I have after 10 years? Show the formula and calculate it exactly.' },
  { title: 'Build an app', prompt: 'Create a web app: a unit converter for length, weight and temperature, with a clean modern design. Then tell me how to use it.' },
  { title: 'Second opinion', prompt: 'Ask another model to explain quantum entanglement in two sentences, then check its answer and improve it.' },
  { title: 'Write a file', prompt: 'Write a one-page study plan for learning Python in 30 days and save it as study-plan.md.' },
  { title: 'Memory', prompt: 'Remember that I prefer answers in simple English with examples. Then recall everything you remember about me.' },
];

function argSummary(args: Record<string, unknown>) {
  const first = Object.values(args).find((v) => typeof v === 'string') as string | undefined;
  if (!first) return '';
  const one = first.replace(/\s+/g, ' ').trim();
  return one.length > 90 ? `${one.slice(0, 89)}…` : one;
}

function ToolStep({ step }: { step: AgentStep }) {
  const [open, setOpen] = useState(false);
  const setActive = useData((s) => s.setActive);
  const setView = useUI((s) => s.setView);
  const t = step.tool!;
  const def = AGENT_TOOLS.find((x) => x.name === t.name);
  return (
    <div className={`tool-step tool-${t.status}`}>
      <button className="tool-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="tool-emoji">{def?.emoji ?? '🔧'}</span>
        <span className="tool-name">{def?.label ?? t.name}</span>
        <span className="tool-arg">{argSummary(t.args)}</span>
        <span className="tool-status">
          {t.status === 'running' ? <Loader2 size={14} className="spin" /> : t.status === 'done' ? <Check size={14} /> : <X size={14} />}
          {t.ms != null && <span className="muted xs">{fmtMs(t.ms)}</span>}
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>
      {t.link && (
        <button className="btn ghost xs tool-link" onClick={() => { setActive('code', t.link!.sessionId); setView('code'); }}>
          <ExternalLink size={12} /> {t.link.label}
        </button>
      )}
      {open && (
        <div className="tool-body">
          <div className="tool-label">Arguments</div>
          <pre>{JSON.stringify(t.args, null, 2)}</pre>
          {t.result != null && (
            <>
              <div className="tool-label">Result</div>
              <pre>{t.result}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function AgentRun({ m, files }: { m: Message; files: Record<string, string> }) {
  const streaming = m.status === 'streaming';
  const provider = m.model ? getProvider(m.model.providerId) : undefined;
  const steps = m.steps ?? [];
  const toolCount = steps.filter((s) => s.kind === 'tool').length;
  const live = streaming ? stripToolBlock(m.content) : m.content;
  void files;
  return (
    <div className={`msg msg-assistant agent-run${streaming ? ' streaming' : ''}`}>
      <div className="avatar" style={{ background: provider?.color ?? 'var(--accent)' }}><Bot size={16} /></div>
      <div className="msg-body">
        <div className="msg-head">
          {m.model && <ModelBadge r={m.model} />}
          <span className="agent-chip">Agent</span>
          <span className="muted xs">{toolCount} tool step{toolCount === 1 ? '' : 's'}</span>
        </div>
        {steps.length > 0 && (
          <div className="agent-steps">
            {steps.map((s) =>
              s.kind === 'tool' ? <ToolStep key={s.id} step={s} /> : <div key={s.id} className="thought"><Markdown text={s.text ?? ''} /></div>,
            )}
          </div>
        )}
        <Reasoning text={m.reasoning ?? ''} streaming={streaming && !live} />
        {m.statusText && <div className="status-line"><span className="pulse-dot" />{m.statusText}</div>}
        {live ? <Markdown text={linkCitations(live, m.sources)} /> : streaming && !m.statusText ? <TypingDots /> : null}
        {(m.sources || (!streaming && m.web?.note)) && <SourcesBar sources={m.sources} web={m.web} />}
        {m.status === 'error' && <div className="msg-error"><X size={15} /><span>{m.error}</span></div>}
        {m.status === 'stopped' && <div className="muted xs">Stopped.</div>}
        {m.status === 'done' && m.meta && (
          <div className="metrics">
            <span>⏱ {fmtMs(m.meta.totalMs)} total</span>
            <span>{toolCount} tool{toolCount === 1 ? '' : 's'}</span>
            <span>{m.meta.estimated ? '≈' : ''}{fmtNum(m.meta.tokensIn)} in · {m.meta.estimated ? '≈' : ''}{fmtNum(m.meta.tokensOut)} out</span>
            {m.meta.slotLabel && <span className="metric-key">🔑 {m.meta.slotLabel}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function ToolsButton({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [mem, setMem] = useState<number | null>(null);
  const toast = useUI((s) => s.toast);
  useEffect(() => {
    if (open) memoryCount().then(setMem);
  }, [open]);
  return (
    <>
      <button ref={btn} className="btn ghost sm" onClick={() => setOpen((o) => !o)} title="Choose the tools the agent may use">
        <Wrench size={14} /> Tools <span className="muted">{value.length}</span>
      </button>
      <Popover anchor={btn} open={open} onClose={() => setOpen(false)} width={380} align="end">
        <div className="tools-pop">
          <div className="row gap-8">
            <b className="grow">Tools the agent may use</b>
            <button className="btn ghost xs" onClick={() => onChange(DEFAULT_AGENT_TOOLS.slice())}>All</button>
            <button className="btn ghost xs" onClick={() => onChange([])}>None</button>
          </div>
          {AGENT_TOOLS.map((t) => (
            <label key={t.name} className="tool-opt">
              <input type="checkbox" checked={value.includes(t.name)} onChange={(e) => onChange(e.target.checked ? [...value, t.name] : value.filter((x) => x !== t.name))} />
              <span className="tool-emoji">{t.emoji}</span>
              <span><b>{t.label}</b><br /><span className="muted xs">{t.description}</span></span>
            </label>
          ))}
          <div className="row gap-8 tools-mem">
            <span className="muted xs grow">Long-term memory: {mem ?? '…'} item{mem === 1 ? '' : 's'} (stored in this browser)</span>
            <button className="btn ghost xs" onClick={async () => { await clearMemory(); setMem(0); toast('Memory cleared'); }}>Clear memory</button>
          </div>
        </div>
      </Popover>
    </>
  );
}

export function AgentView() {
  const activeId = useData((s) => s.active.agent);
  const session = useData((s) => (activeId ? (s.sessions[activeId] as AgentSession | undefined) : undefined));
  const create = useData((s) => s.create);
  const update = useData((s) => s.update);
  const defaultModel = useSettings((s) => s.defaultModel);
  const [tab, setTab] = useState<'here' | 'github'>(() => (location.hash.includes('github') ? 'github' : 'here'));
  const [draftModel, setDraftModel] = useState<ModelRef>(defaultModel);
  const [draftTools, setDraftTools] = useState<string[]>(DEFAULT_AGENT_TOOLS.slice());
  const [draftSteps, setDraftSteps] = useState(8);
  const model = session?.model ?? draftModel;
  const tools = session?.tools ?? draftTools;
  const maxSteps = session?.maxSteps ?? draftSteps;
  const busy = !!session?.messages.some((m) => m.status === 'streaming');
  const last = session?.messages[session.messages.length - 1];
  const { ref } = useAutoScroll<HTMLDivElement>(`${session?.messages.length}:${last?.content.length}:${last?.steps?.length}:${last?.steps?.map((s) => s.tool?.status).join()}`, !!session?.messages.length);
  const files = Object.entries(session?.files ?? {});

  const send = (text: string) => {
    let id = session?.id;
    if (!id) id = create('agent', { model: draftModel, tools: draftTools, maxSteps: draftSteps, title: titleFrom(text) });
    const asstId = uid();
    update(id, (x) => {
      const a = x as AgentSession;
      if (!a.messages.length) a.title = titleFrom(text);
      a.messages.push({ id: uid(), role: 'user', content: text, createdAt: Date.now() });
      a.messages.push({ id: asstId, role: 'assistant', content: '', model: a.model, status: 'streaming', steps: [], createdAt: Date.now() });
    });
    void runAgent(id, asstId);
  };

  const set = (patch: Partial<AgentSession>) => {
    if (session) update(session.id, (x) => void Object.assign(x, patch), false);
    else {
      if (patch.model) setDraftModel(patch.model);
      if (patch.tools) setDraftTools(patch.tools);
      if (patch.maxSteps) setDraftSteps(patch.maxSteps);
    }
  };

  return (
    <div className="view agent-view">
      <TopBar
        right={
          tab === 'here' ? (
            <>
              <ToolsButton value={tools} onChange={(v) => set({ tools: v })} />
              <label className="steps-sel hide-sm" title="Maximum tool steps per task">
                <span className="muted xs">Steps</span>
                <select className="sm" value={maxSteps} onChange={(e) => set({ maxSteps: Number(e.target.value) })}>
                  {[3, 5, 8, 12, 16, 20].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            </>
          ) : null
        }
      >
        <div className="seg">
          <button className={tab === 'here' ? 'active' : ''} onClick={() => setTab('here')}><Bot size={14} /> Run here</button>
          <button className={tab === 'github' ? 'active' : ''} onClick={() => setTab('github')}><Clock3 size={14} /> 24/7 on GitHub</button>
        </div>
      </TopBar>

      {tab === 'github' ? (
        <ScheduledAgents />
      ) : (
        <>
          <div className="scroll" ref={ref}>
            {!session || session.messages.length === 0 ? (
              <div className="agent-empty">
                <div className="agent-hero">
                  <div className="agent-orb"><Bot size={34} /></div>
                  <h1>Give JeeA! a goal</h1>
                  <p className="muted">The agent makes a plan, uses tools (search, web pages, maths, code, files, memory, other models) and reports back with sources. Every step is shown.</p>
                </div>
                <div className="suggest-grid">
                  {EXAMPLES.map((e) => (
                    <button key={e.title} className="suggest" onClick={() => send(e.prompt)}>
                      <span className="suggest-title">{e.title}</span>
                      <span className="suggest-text">{e.prompt}</span>
                    </button>
                  ))}
                </div>
                <div className="tool-chips">
                  {AGENT_TOOLS.filter((t) => tools.includes(t.name)).map((t) => <span key={t.name} className="chip">{t.emoji} {t.label}</span>)}
                </div>
                <p className="muted xs center">Models with native tool calling get real tool calls. The free model and others use a text tool protocol automatically.</p>
              </div>
            ) : (
              <div className="thread">
                {session.messages.map((m) => (m.role === 'user' ? <MessageItem key={m.id} m={m} /> : <AgentRun key={m.id} m={m} files={session.files} />))}
              </div>
            )}
          </div>
          {files.length > 0 && (
            <div className="files-bar">
              <span className="muted xs">Workspace</span>
              {files.map(([p, c]) => (
                <button key={p} className="chip" onClick={() => downloadText(p.split('/').pop() || 'file.txt', c)} title="Download">
                  <Download size={12} /> {p}
                </button>
              ))}
            </div>
          )}
          <Composer
            onSend={send}
            busy={busy}
            onStop={() => session && stopJobs(session.id)}
            placeholder="Describe a goal for the agent…"
            left={<ModelPicker value={model} onChange={(r) => set({ model: r })} size="sm" />}
          />
        </>
      )}
    </div>
  );
}
