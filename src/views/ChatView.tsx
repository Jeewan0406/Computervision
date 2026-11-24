import { useState } from 'react';
import { Bot, Code2, Columns3, KeyRound, Users } from 'lucide-react';
import type { ChatSession, Message, ModelRef } from '../lib/types';
import { useData } from '../lib/data';
import { useSettings, getProvider, isUsable, modelLabel } from '../lib/settings';
import { useUI } from '../lib/ui';
import { stopJobs } from '../lib/runner';
import { streamReply } from '../lib/reply';
import { prepareWeb, joinSystem } from '../lib/webrun';
import { rulesText } from '../lib/rules';
import { personalContext } from '../lib/context';
import { splitThink } from '../lib/text';
import { titleFrom, uid } from '../lib/utils';
import { withApa } from '../lib/apa';
import type { WebSource } from '../lib/web';
import type { ChatMsg } from '../lib/llm';
import { TopBar, ParamsButton } from '../components/Shell';
import { ModelPicker } from '../components/ModelPicker';
import { MessageItem } from '../components/Message';
import { Composer } from '../components/Composer';
import { WebToggle } from '../components/Web';
import { ExportMenu } from '../components/Export';
import { LogoMark, Wordmark } from '../components/Logo';
import { useAutoScroll } from '../components/hooks';
import { ContextBadges } from '../components/Projects';

/** All sources of a chat, once each, numbered again with fresh APA letters. */
function dedupeSources(list: WebSource[]): WebSource[] {
  const seen = new Set<string>();
  const out = list.filter((s) => (seen.has(s.url) ? false : (seen.add(s.url), true))).map((s, i) => ({ ...s, n: i + 1 }));
  return out.length ? withApa(out) : [];
}

export function toApiMessages(system: string, history: Message[]): ChatMsg[] {
  const out: ChatMsg[] = [];
  if (system.trim()) out.push({ role: 'system', content: system.trim() });
  for (const m of history) {
    if (m.role === 'system') continue;
    if (m.role === 'assistant' && (m.status === 'error' || !m.content.trim())) continue;
    out.push({ role: m.role, content: m.role === 'assistant' ? splitThink(m.content).answer : m.content });
  }
  return out;
}

/** Stream an assistant reply into a chat session. */
async function ask(sessionId: string) {
  const s = useData.getState().sessions[sessionId] as ChatSession | undefined;
  if (!s) return;
  const history = s.messages.slice();
  const asstId = uid();
  const { update } = useData.getState();
  const patch = (fn: (m: Message) => void) =>
    update(sessionId, (x) => {
      const m = (x as ChatSession).messages.find((y) => y.id === asstId);
      if (m) fn(m);
    }, false);
  update(sessionId, (x) => {
    (x as ChatSession).messages.push({ id: asstId, role: 'assistant', content: '', model: s.model, status: 'streaming', createdAt: Date.now() });
  });
  // Auto web search: fresh facts for questions that need them.
  const users = history.filter((m) => m.role === 'user');
  const w = await prepareWeb(users[users.length - 1]?.content ?? '', {
    jobId: `${sessionId}:${asstId}`,
    feature: 'chat',
    previous: users[users.length - 2]?.content,
    onStart: (info) => patch((m) => {
      m.web = info;
      m.statusText = `Searching the web for “${info.query}”…`;
    }),
  });
  patch((m) => {
    m.web = w.web;
    m.sources = w.sources;
    m.statusText = undefined;
    if (w.aborted) m.status = 'stopped';
  });
  if (w.aborted) return;
  const pc = await personalContext('chat', s.projectId, users[users.length - 1]?.content ?? '');
  await streamReply({
    sessionId,
    jobId: `${sessionId}:${asstId}`,
    locate: (x) => (x as ChatSession).messages.find((m) => m.id === asstId),
    ref: s.model,
    messages: toApiMessages(joinSystem(rulesText(), pc.text, s.system, w.prompt), history),
    params: s.params,
    feature: 'chat',
  });
}

const SUGGESTIONS = [
  { title: 'Explain like I am 15', prompt: 'Explain how a large language model works in simple words, with one everyday example.' },
  { title: 'Write code', prompt: 'Write a Python script that renames all photos in a folder by the date they were taken.' },
  { title: 'Plan something', prompt: 'Make a 7-day study plan to learn the basics of machine learning, 1 hour per day.' },
  { title: 'Check my thinking', prompt: 'What are the strongest arguments for and against working from home? Be balanced.' },
];

function Welcome({ model, onPick }: { model: ModelRef; onPick: (text: string) => void }) {
  const setView = useUI((s) => s.setView);
  const slots = useSettings((s) => s.slots);
  const p = getProvider(model.providerId);
  const ready = p ? isUsable(p, slots) : false;
  return (
    <div className="welcome">
      <div className="welcome-hero">
        <div className="hero-logo"><LogoMark size={72} /></div>
        <h1>Hi, I'm <Wordmark /></h1>
        <p className="welcome-sub">One place to chat with many AI models: free ones, and any you bring with your own keys.</p>
        <div className={`ready-chip${ready ? '' : ' warn'}`}>
          <span className={`pulse-dot${ready ? ' green' : ''}`} />
          {ready ? `${p?.name} is ready` : `No key yet for ${p?.name ?? 'this provider'}`}
        </div>
      </div>
      <div className="suggest-grid">
        {SUGGESTIONS.map((s) => (
          <button key={s.title} className="suggest" onClick={() => onPick(s.prompt)}>
            <span className="suggest-title">{s.title}</span>
            <span className="suggest-text">{s.prompt}</span>
          </button>
        ))}
      </div>
      <div className="feature-row">
        <button className="feature" onClick={() => setView('agent')}><Bot size={18} /><span><b>Agent</b>: tools, steps and 24/7 runs</span></button>
        <button className="feature" onClick={() => setView('compare')}><Columns3 size={18} /><span><b>Compare</b> up to 6 models side by side</span></button>
        <button className="feature" onClick={() => setView('team')}><Users size={18} /><span><b>Team</b>: give each model a role</span></button>
        <button className="feature" onClick={() => setView('code')}><Code2 size={18} /><span><b>CodeFrame</b>: build and run apps live</span></button>
        <button className="feature" onClick={() => setView('keys')}><KeyRound size={18} /><span><b>API Slots</b>: add your own keys</span></button>
      </div>
    </div>
  );
}

export function ChatView() {
  const activeId = useData((s) => s.active.chat);
  const session = useData((s) => (activeId ? (s.sessions[activeId] as ChatSession | undefined) : undefined));
  const create = useData((s) => s.create);
  const update = useData((s) => s.update);
  const defaultModel = useSettings((s) => s.defaultModel);
  const [draftModel, setDraftModel] = useState<ModelRef>(defaultModel);
  const [draftSystem, setDraftSystem] = useState('');
  const [draftParams, setDraftParams] = useState<ChatSession['params']>({});
  const model = session?.model ?? draftModel;
  const busy = !!session?.messages.some((m) => m.status === 'streaming');
  const last = session?.messages[session.messages.length - 1];
  const { ref } = useAutoScroll<HTMLDivElement>(`${session?.messages.length}:${last?.content.length}:${last?.reasoning?.length}:${last?.status}`, !!session?.messages.length);

  const send = (text: string) => {
    let id = session?.id;
    if (!id) id = create('chat', { model: draftModel, system: draftSystem, params: draftParams, title: titleFrom(text) });
    update(id, (x) => {
      const c = x as ChatSession;
      if (!c.messages.length) c.title = titleFrom(text);
      c.messages.push({ id: uid(), role: 'user', content: text, createdAt: Date.now() });
    });
    void ask(id);
  };

  const truncateAndAsk = (index: number, newUserText?: string) => {
    if (!session || busy) return;
    update(session.id, (x) => {
      const c = x as ChatSession;
      if (newUserText != null) {
        c.messages[index].content = newUserText;
        c.messages = c.messages.slice(0, index + 1);
      } else {
        c.messages = c.messages.slice(0, index);
      }
    });
    void ask(session.id);
  };

  /** The whole conversation as Markdown (for Export). */
  const chatMarkdown = () =>
    (session?.messages ?? [])
      .filter((m) => m.role !== 'system' && m.content.trim())
      .map((m) => `### ${m.role === 'user' ? 'You' : modelLabel(m.model ?? model)}\n\n${m.role === 'assistant' ? splitThink(m.content).answer : m.content}\n`)
      .join('\n');

  return (
    <div className="view chat-view">
      <TopBar
        right={
          <>
            {session && session.messages.length > 0 && (
              <ExportMenu
                title={session.title}
                getMarkdown={chatMarkdown}
                sources={dedupeSources(session.messages.flatMap((m) => m.sources ?? []))}
                getNode={() => document.querySelector<HTMLElement>('.chat-view .thread')}
              />
            )}
            <ParamsButton
              system={session?.system ?? draftSystem}
              params={session?.params ?? draftParams}
              onChange={(system, params) => {
                if (session) update(session.id, (x) => {
                  const c = x as ChatSession;
                  c.system = system;
                  c.params = params;
                }, false);
                else {
                  setDraftSystem(system);
                  setDraftParams(params);
                }
              }}
            />
          </>
        }
      >

        <span className="topbar-title strong" title={session?.title ?? 'New chat'}>{session?.title ?? 'New chat'}</span>
      </TopBar>

      <div className="scroll" ref={ref}>
        {!session || session.messages.length === 0 ? (
          <Welcome model={model} onPick={send} />
        ) : (
          <div className="thread">
            {session.messages.map((m, i) => (
              <MessageItem
                key={m.id}
                m={m}
                onEdit={m.role === 'user' && !busy ? (t) => truncateAndAsk(i, t) : undefined}
                onRegenerate={m.role === 'assistant' && !busy && i === session.messages.length - 1 ? () => truncateAndAsk(i) : undefined}
                onRetry={m.role === 'assistant' && !busy ? () => truncateAndAsk(i) : undefined}
              />
            ))}
          </div>
        )}
      </div>

      <Composer context={<ContextBadges area="chat" projectId={session ? session.projectId ?? null : undefined} />}
        onSend={send}
        busy={busy}
        onStop={() => session && stopJobs(session.id)}
        placeholder={`Message ${modelLabel(model)}…`}
        left={
          <>
            <ModelPicker size="sm"
              value={model}
              onChange={(r) => (session ? update(session.id, (x) => void ((x as ChatSession).model = r), false) : setDraftModel(r))}
            />
            <WebToggle />
          </>
        }
      />
    </div>
  );
}
