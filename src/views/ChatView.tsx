import { useState } from 'react';
import { Bot, Code2, Columns3, Download, KeyRound, Users } from 'lucide-react';
import type { ChatSession, Message, ModelRef } from '../lib/types';
import { useData } from '../lib/data';
import { useSettings, getProvider, isUsable, modelLabel } from '../lib/settings';
import { useUI } from '../lib/ui';
import { stopJobs } from '../lib/runner';
import { streamReply } from '../lib/reply';
import { splitThink } from '../lib/text';
import { downloadText, titleFrom, uid } from '../lib/utils';
import type { ChatMsg } from '../lib/llm';
import { TopBar, ParamsButton } from '../components/Shell';
import { ModelPicker } from '../components/ModelPicker';
import { MessageItem } from '../components/Message';
import { Composer } from '../components/Composer';
import { LogoMark, Wordmark } from '../components/Logo';
import { useAutoScroll } from '../components/hooks';

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
  useData.getState().update(sessionId, (x) => {
    (x as ChatSession).messages.push({ id: asstId, role: 'assistant', content: '', model: s.model, status: 'streaming', createdAt: Date.now() });
  });
  await streamReply({
    sessionId,
    jobId: `${sessionId}:${asstId}`,
    locate: (x) => (x as ChatSession).messages.find((m) => m.id === asstId),
    ref: s.model,
    messages: toApiMessages(s.system, history),
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

  const exportMd = () => {
    if (!session) return;
    const md = [`# ${session.title}`, '', ...session.messages.map((m) => `**${m.role === 'user' ? 'You' : `${m.model?.model ?? 'AI'}`}:**\n\n${m.content}\n`)].join('\n');
    downloadText(`${session.title.replace(/[^\w-]+/g, '_').slice(0, 40) || 'chat'}.md`, md, 'text/markdown');
  };

  return (
    <div className="view chat-view">
      <TopBar
        right={
          <>
            {session && session.messages.length > 0 && (
              <button className="icon-btn" title="Export as Markdown" onClick={exportMd}><Download size={17} /></button>
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
        <ModelPicker
          value={model}
          onChange={(r) => (session ? update(session.id, (x) => void ((x as ChatSession).model = r), false) : setDraftModel(r))}
        />
        {session && <span className="topbar-title" title={session.title}>{session.title}</span>}
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

      <Composer onSend={send} busy={busy} onStop={() => session && stopJobs(session.id)} placeholder={`Message ${modelLabel(model)}…`} />
    </div>
  );
}
