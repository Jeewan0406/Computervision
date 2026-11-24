import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  Code2, Download, Eye, History, Maximize2, Monitor, Play, Smartphone, Tablet, Terminal, Trash2, Copy, Columns2, MessageSquare,
} from 'lucide-react';
import type { CodeSession, ModelRef } from '../lib/types';
import { useData } from '../lib/data';
import { useSettings } from '../lib/settings';
import { useUI } from '../lib/ui';
import { stopJobs } from '../lib/runner';
import { streamReply } from '../lib/reply';
import { personalContext } from '../lib/context';
import { extractRunnable, liveHtml, splitThink, stripCode } from '../lib/text';
import { copyText, downloadText, fmtDateTime, titleFrom, uid } from '../lib/utils';
import type { ChatMsg } from '../lib/llm';
import { TopBar } from '../components/Shell';
import { ModelPicker } from '../components/ModelPicker';
import { MessageItem } from '../components/Message';
import { Composer } from '../components/Composer';
import { useAutoScroll } from '../components/hooks';
import { Popover } from '../components/Popover';
import { ContextBadges } from '../components/Projects';

const CodeEditor = lazy(() => import('../components/CodeEditor'));

const CODE_SYSTEM = `You are JeeA! CodeFrame, an expert front-end engineer and designer.
Rules:
1. Reply with one or two short sentences about what you built or changed, then ONE complete, self-contained HTML document in a single \`\`\`html code block.
2. Put CSS in <style> and JavaScript in <script> inside that file. You may load libraries from a CDN (for example cdn.jsdelivr.net or unpkg.com).
3. Make it modern, responsive and accessible, with good spacing, colours and typography.
4. When the user asks for a change, return the FULL updated file, never a partial diff.
5. The preview runs in a sandbox: no cookies; localStorage works only until reload.`;

const IDEAS = [
  { title: 'Landing page', prompt: 'Build a modern landing page for a coffee shop: hero with a call to action, menu cards, opening hours and a contact form. Dark theme with smooth hover animations.' },
  { title: 'Todo app', prompt: 'Make a polished todo app with add, edit, complete, delete, filters (all / active / done) and a counter.' },
  { title: 'Particles', prompt: 'Create an interactive full-screen canvas particle animation that reacts to the mouse and touch, with a colour picker.' },
  { title: 'Calculator', prompt: 'Build a beautiful calculator with keyboard support, a history list and a light/dark toggle.' },
  { title: 'Dashboard', prompt: 'Make a sales dashboard with 4 KPI cards and 3 charts using Chart.js from a CDN, with realistic sample data.' },
  { title: 'Pomodoro', prompt: 'Build a Pomodoro timer with start, pause and reset, a circular progress ring, custom durations and a sound when time is up.' },
];

/** Injected first into the preview: forwards console output to JeeA! and
 * gives the sandbox an in-memory localStorage (the real one is blocked). */
const PREVIEW_BOOT = `<script>(function(){
var send=function(l,a){try{parent.postMessage({__jeea:1,level:l,text:Array.prototype.map.call(a,function(x){try{return typeof x==='string'?x:JSON.stringify(x)}catch(e){return String(x)}}).join(' ')},'*')}catch(e){}};
['log','info','warn','error'].forEach(function(l){var o=console[l];console[l]=function(){send(l,arguments);if(o)o.apply(console,arguments)}});
addEventListener('error',function(e){send('error',[e.message+(e.lineno?' (line '+e.lineno+')':'')])});
addEventListener('unhandledrejection',function(e){send('error',['Unhandled promise rejection: '+((e.reason&&e.reason.message)||e.reason)])});
function mem(){var m={};return{getItem:function(k){return Object.prototype.hasOwnProperty.call(m,k)?m[k]:null},setItem:function(k,v){m[k]=String(v)},removeItem:function(k){delete m[k]},clear:function(){m={}},key:function(i){return Object.keys(m)[i]||null},get length(){return Object.keys(m).length}}}
try{window.localStorage.getItem('x')}catch(e){try{Object.defineProperty(window,'localStorage',{value:mem()});Object.defineProperty(window,'sessionStorage',{value:mem()})}catch(_){}}
})();</script>`;

function instrument(code: string) {
  if (!code.trim()) return '';
  if (/<head[^>]*>/i.test(code)) return code.replace(/<head[^>]*>/i, (m) => `${m}\n${PREVIEW_BOOT}`);
  return PREVIEW_BOOT + code;
}

interface ConsoleLine {
  id: number;
  level: string;
  text: string;
}

/** One CodeFrame turn: ask the model, stream the code live, save the result. */
async function runCodeTurn(sid: string, onLive: (code: string | null) => void) {
  const { update } = useData.getState();
  const s = useData.getState().sessions[sid] as CodeSession;
  const history = s.messages.slice();
  const lastUser = history[history.length - 1];
  // The user's custom instructions and the project's instructions and files
  // apply here too; the code-output format above them always wins.
  const pc = await personalContext('code', s.projectId, lastUser?.content ?? '');
  const system = pc.text
    ? `${CODE_SYSTEM}\n\nAlways keep the output format above, even if the instructions below ask for something else.\n\n${pc.text}`
    : CODE_SYSTEM;
  const api: ChatMsg[] = [{ role: 'system', content: system }];
  for (const m of history.slice(0, -1)) {
    if (m.role === 'assistant' && (m.status === 'error' || !m.content)) continue;
    api.push({ role: m.role as 'user' | 'assistant', content: m.role === 'assistant' ? stripCode(splitThink(m.content).answer, '[earlier code omitted]') : m.content });
  }
  api.push({
    role: 'user',
    content: s.code.trim() ? `${lastUser.content}\n\nCurrent file (index.html):\n\`\`\`html\n${s.code}\n\`\`\`` : lastUser.content,
  });
  const asstId = uid();
  update(sid, (x) => void (x as CodeSession).messages.push({ id: asstId, role: 'assistant', content: '', model: s.model, status: 'streaming', createdAt: Date.now() }));
  const final = await streamReply({
    sessionId: sid,
    jobId: `${sid}:${asstId}`,
    locate: (x) => (x as CodeSession).messages.find((m) => m.id === asstId),
    ref: s.model,
    messages: api,
    feature: 'code',
    onLive: (t) => onLive(liveHtml(splitThink(t).answer)),
  });
  onLive(null);
  if (!final) return;
  const doc = extractRunnable(splitThink(final).answer);
  if (!doc) {
    useUI.getState().toast('The model did not return an HTML file. Ask it to "return the full HTML file".', 'info');
    return;
  }
  update(sid, (x) => {
    const c = x as CodeSession;
    c.code = doc;
    c.versions.push({ id: uid(), at: Date.now(), code: doc, note: titleFrom(lastUser.content, 60) });
    if (c.versions.length > 30) c.versions.splice(0, c.versions.length - 30);
  });
}

export function CodeView() {
  const activeId = useData((s) => s.active.code);
  const session = useData((s) => (activeId ? (s.sessions[activeId] as CodeSession | undefined) : undefined));
  const create = useData((s) => s.create);
  const update = useData((s) => s.update);
  const defaultModel = useSettings((s) => s.defaultModel);
  const theme = useSettings((s) => s.theme);
  const toast = useUI((s) => s.toast);
  const [draftModel, setDraftModel] = useState<ModelRef>(defaultModel);
  const [layout, setLayout] = useState<'split' | 'preview' | 'code'>('split');
  const [mobileTab, setMobileTab] = useState<'chat' | 'work'>('chat');
  const [device, setDevice] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [live, setLive] = useState<string | null>(null);
  const [runKey, setRunKey] = useState(0);
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [histOpen, setHistOpen] = useState(false);
  const histBtn = useRef<HTMLButtonElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const previewBox = useRef<HTMLDivElement>(null);
  const editTimer = useRef<number | undefined>(undefined);
  const [editBuffer, setEditBuffer] = useState<string | null>(null);

  const model = session?.model ?? draftModel;
  const busy = !!session?.messages.some((m) => m.status === 'streaming');
  const code = live ?? editBuffer ?? session?.code ?? '';
  const srcDoc = useMemo(() => instrument(session?.code ?? ''), [session?.code, runKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const last = session?.messages[session.messages.length - 1];
  const { ref: chatRef } = useAutoScroll<HTMLDivElement>(`${session?.messages.length}:${last?.content.length}:${last?.status}`, !!session?.messages.length);
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  const errors = lines.filter((l) => l.level === 'error').length;

  useEffect(() => {
    let n = 0;
    const onMsg = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || !e.data?.__jeea) return;
      const d = e.data as { level: string; text: string };
      setLines((cur) => [...cur.slice(-199), { id: ++n + Date.now(), level: d.level, text: String(d.text).slice(0, 2000) }]);
      if (d.level === 'error') setConsoleOpen(true);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  useEffect(() => setLines([]), [srcDoc]);
  useEffect(() => {
    setEditBuffer(null);
    setLive(null);
  }, [activeId]);

  const send = (text: string) => {
    let id = session?.id;
    if (!id) id = create('code', { model: draftModel, title: titleFrom(text) });
    update(id, (x) => {
      const c = x as CodeSession;
      if (!c.messages.length && c.title === 'New project') c.title = titleFrom(text);
      c.messages.push({ id: uid(), role: 'user', content: text, createdAt: Date.now() });
    });
    if (editBuffer != null) flushEdit(editBuffer, id);
    setMobileTab('work');
    void runCodeTurn(id, setLive);
  };

  const flushEdit = (v: string, sid = session?.id) => {
    clearTimeout(editTimer.current);
    if (!sid) return;
    update(sid, (x) => void ((x as CodeSession).code = v));
    setEditBuffer(null);
  };

  const onEdit = (v: string) => {
    if (live != null) return;
    setEditBuffer(v);
    clearTimeout(editTimer.current);
    editTimer.current = window.setTimeout(() => {
      if (session) flushEdit(v);
      else {
        const id = create('code', { model: draftModel, title: 'Hand-written page', code: v });
        update(id, () => undefined);
        setEditBuffer(null);
      }
    }, 800);
  };

  const fullscreen = () => previewBox.current?.requestFullscreen?.().catch(() => toast('Fullscreen is not available here.'));
  const width = device === 'mobile' ? 390 : device === 'tablet' ? 768 : undefined;

  const workspace = (
    <div className="workspace">
      <div className="ws-toolbar">
        <div className="seg">
          <button className={layout === 'preview' ? 'active' : ''} onClick={() => setLayout('preview')} title="Preview only"><Eye size={14} /> <span className="hide-sm">Preview</span></button>
          <button className={layout === 'split' ? 'active' : ''} onClick={() => setLayout('split')} title="Code and preview"><Columns2 size={14} /> <span className="hide-sm">Split</span></button>
          <button className={layout === 'code' ? 'active' : ''} onClick={() => setLayout('code')} title="Code only"><Code2 size={14} /> <span className="hide-sm">Code</span></button>
        </div>
        <div className="seg">
          <button className={device === 'desktop' ? 'active' : ''} onClick={() => setDevice('desktop')} title="Desktop"><Monitor size={14} /></button>
          <button className={device === 'tablet' ? 'active' : ''} onClick={() => setDevice('tablet')} title="Tablet (768 px)"><Tablet size={14} /></button>
          <button className={device === 'mobile' ? 'active' : ''} onClick={() => setDevice('mobile')} title="Phone (390 px)"><Smartphone size={14} /></button>
        </div>
        <div className="ws-actions">
          <button className="icon-btn" title="Run again" onClick={() => { if (editBuffer != null) flushEdit(editBuffer); setRunKey((k) => k + 1); }}><Play size={16} /></button>
          <button className={`icon-btn${errors ? ' dot-danger' : ''}`} title="Console" onClick={() => setConsoleOpen((o) => !o)}><Terminal size={16} /></button>
          <button ref={histBtn} className="icon-btn" title="Versions" onClick={() => setHistOpen((o) => !o)} disabled={!session?.versions.length}><History size={16} /></button>
          <button className="icon-btn" title="Copy code" onClick={async () => (await copyText(code)) && toast('Code copied', 'success')} disabled={!code}><Copy size={16} /></button>
          <button className="icon-btn" title="Download index.html" onClick={() => downloadText('index.html', code, 'text/html')} disabled={!code}><Download size={16} /></button>
          <button className="icon-btn" title="Fullscreen preview" onClick={fullscreen} disabled={!code}><Maximize2 size={16} /></button>
        </div>
      </div>
      <Popover anchor={histBtn} open={histOpen} onClose={() => setHistOpen(false)} width={320} align="end">
        <div className="versions">
          <div className="versions-head">Versions (newest first)</div>
          {[...(session?.versions ?? [])].reverse().map((v, i) => (
            <button
              key={v.id}
              className={`version${v.code === session?.code ? ' current' : ''}`}
              onClick={() => {
                if (!session) return;
                update(session.id, (x) => void ((x as CodeSession).code = v.code));
                setHistOpen(false);
                toast('Version restored', 'success');
              }}
            >
              <span className="version-n">v{(session?.versions.length ?? 0) - i}</span>
              <span className="version-note">{v.note}</span>
              <span className="muted xs">{fmtDateTime(v.at)}</span>
            </button>
          ))}
        </div>
      </Popover>

      <div className={`ws-panes ws-${layout}`}>
        {layout !== 'preview' && (
          <div className="pane pane-code">
            <div className="pane-label">index.html {live != null && <span className="live-tag"><span className="pulse-dot" /> writing…</span>}</div>
            <Suspense fallback={<pre className="code-fallback">{code}</pre>}>
              <CodeEditor value={code} onChange={onEdit} dark={dark} readOnly={live != null} />
            </Suspense>
          </div>
        )}
        {layout !== 'code' && (
          <div className="pane pane-preview" ref={previewBox}>
            {srcDoc ? (
              <div className={`device device-${device}`} style={width ? { width } : undefined}>
                <iframe
                  key={runKey}
                  ref={frame}
                  title="CodeFrame preview"
                  className="preview-frame"
                  sandbox="allow-scripts allow-modals allow-forms allow-popups allow-pointer-lock"
                  srcDoc={srcDoc}
                />
              </div>
            ) : (
              <div className="preview-empty">
                <Eye size={28} />
                <p>{live != null ? 'Writing your app… the preview starts when the code is done.' : 'Your app will appear here.'}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {consoleOpen && (
        <div className="console">
          <div className="console-head">
            <Terminal size={14} /> Console <span className="muted xs">{lines.length} lines</span>
            <button className="icon-btn xs push" title="Clear" onClick={() => setLines([])}><Trash2 size={13} /></button>
            <button className="icon-btn xs" title="Close" onClick={() => setConsoleOpen(false)}>✕</button>
          </div>
          <div className="console-body">
            {lines.length === 0 && <div className="muted xs">No output yet. console.log() from your app shows here.</div>}
            {lines.map((l) => <div key={l.id} className={`cl cl-${l.level}`}>{l.text}</div>)}
            {errors > 0 && (
              <button className="btn ghost xs" disabled={busy} onClick={() => send(`Fix these errors from the console:\n${lines.filter((l) => l.level === 'error').map((l) => `- ${l.text}`).join('\n')}`)}>
                Ask the AI to fix {errors} error{errors > 1 ? 's' : ''}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="view code-view">
      <TopBar
        right={
          <div className="seg only-mobile-flex">
            <button className={mobileTab === 'chat' ? 'active' : ''} onClick={() => setMobileTab('chat')}><MessageSquare size={14} /> Chat</button>
            <button className={mobileTab === 'work' ? 'active' : ''} onClick={() => setMobileTab('work')}><Eye size={14} /> App</button>
          </div>
        }
      >
        <span className="topbar-title strong">CodeFrame</span>
      </TopBar>
      <div className={`code-layout mobile-${mobileTab}`}>
        <div className="code-chat">
          <div className="scroll" ref={chatRef}>
            {!session || session.messages.length === 0 ? (
              <div className="code-empty">
                <h2>Describe an app. Watch it come alive.</h2>
                <p className="muted">The model writes one HTML file. JeeA! runs it in a locked sandbox next to the code.</p>
                <div className="idea-grid">
                  {IDEAS.map((i) => (
                    <button key={i.title} className="idea" onClick={() => send(i.prompt)}>
                      <b>{i.title}</b>
                      <span>{i.prompt}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="thread compact">
                {session.messages.map((m) => (
                  <MessageItem key={m.id} m={m} showModel={false} displayText={m.role === 'assistant' ? stripCode(splitThink(m.content).answer) : undefined} />
                ))}
              </div>
            )}
          </div>
          <Composer context={<ContextBadges area="code" projectId={session ? session.projectId ?? null : undefined} />} onSend={send} busy={busy} onStop={() => session && stopJobs(session.id)} placeholder={session?.code ? 'Ask for a change…' : 'Describe the app you want…'} left={<ModelPicker value={model} onChange={(r) => (session ? update(session.id, (x) => void ((x as CodeSession).model = r), false) : setDraftModel(r))} size="sm" />} />
        </div>
        {workspace}
      </div>
    </div>
  );
}
