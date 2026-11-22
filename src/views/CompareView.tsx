import { useMemo, useState } from 'react';
import { Plus, Scale, Trophy, X } from 'lucide-react';
import type { CompareLane, CompareSession, Message, ModelRef } from '../lib/types';
import { useData } from '../lib/data';
import { useSettings, usableModelRefs, modelKey, allProviders } from '../lib/settings';
import { useUI } from '../lib/ui';
import { stopJobs } from '../lib/runner';
import { streamReply } from '../lib/reply';
import { splitThink } from '../lib/text';
import { fmtMs, titleFrom, uid } from '../lib/utils';
import { TopBar, ParamsButton } from '../components/Shell';
import { ModelPicker } from '../components/ModelPicker';
import { MessageItem, Markdown, Metrics, Reasoning, TypingDots } from '../components/Message';
import { Composer } from '../components/Composer';
import { toApiMessages } from './ChatView';

const MAX_LANES = 6;

function laneStats(lane: CompareLane) {
  const done = lane.messages.filter((m) => m.role === 'assistant' && m.status === 'done' && m.meta);
  if (!done.length) return null;
  const avg = (k: 'ttftMs' | 'totalMs') => done.reduce((a, m) => a + (m.meta?.[k] ?? 0), 0) / done.length;
  return { ttft: avg('ttftMs'), total: avg('totalMs') };
}

export function CompareView() {
  const activeId = useData((s) => s.active.compare);
  const session = useData((s) => (activeId ? (s.sessions[activeId] as CompareSession | undefined) : undefined));
  const create = useData((s) => s.create);
  const update = useData((s) => s.update);
  const recordVote = useSettings((s) => s.recordVote);
  const openModal = useUI((s) => s.openModal);
  const toast = useUI((s) => s.toast);
  const [draft, setDraft] = useState<ModelRef[]>(() => {
    const r = usableModelRefs(3);
    while (r.length < 2) r.push(r[0]);
    return r;
  });
  const [draftSystem, setDraftSystem] = useState('');
  const [draftParams, setDraftParams] = useState<CompareSession['params']>({});

  const lanes: { id: string; model: ModelRef; messages: Message[] }[] = session
    ? session.lanes
    : draft.map((m, i) => ({ id: `draft-${i}`, model: m, messages: [] }));
  const busy = !!session?.lanes.some((l) => l.messages.some((m) => m.status === 'streaming')) || session?.judge?.message?.status === 'streaming';
  const turns = useMemo(() => Math.max(0, ...lanes.map((l) => l.messages.filter((m) => m.role === 'user').length)), [lanes]);

  const setLaneModel = (i: number, r: ModelRef) => {
    if (session) update(session.id, (x) => void ((x as CompareSession).lanes[i].model = r), false);
    else setDraft(draft.map((d, j) => (j === i ? r : d)));
  };
  const addLane = () => {
    const pool = usableModelRefs(MAX_LANES);
    const used = new Set(lanes.map((l) => modelKey(l.model)));
    const next = pool.find((r) => !used.has(modelKey(r))) ?? pool[0];
    if (session) update(session.id, (x) => void (x as CompareSession).lanes.push({ id: uid(), model: next, messages: [] }), false);
    else setDraft([...draft, next]);
  };
  const removeLane = (i: number) => {
    if (lanes.length <= 2) return toast('Keep at least two models to compare.');
    if (session) {
      stopJobs(`${session.id}:${session.lanes[i].id}`);
      update(session.id, (x) => void (x as CompareSession).lanes.splice(i, 1), false);
    } else setDraft(draft.filter((_, j) => j !== i));
  };

  const runLane = (sid: string, laneId: string) => {
    const s = useData.getState().sessions[sid] as CompareSession;
    const lane = s.lanes.find((l) => l.id === laneId)!;
    const history = lane.messages.slice();
    const asstId = uid();
    update(sid, (x) => {
      (x as CompareSession).lanes.find((l) => l.id === laneId)?.messages.push({ id: asstId, role: 'assistant', content: '', model: lane.model, status: 'streaming', createdAt: Date.now() });
    });
    return streamReply({
      sessionId: sid,
      jobId: `${sid}:${laneId}:${asstId}`,
      locate: (x) => (x as CompareSession).lanes.find((l) => l.id === laneId)?.messages.find((m) => m.id === asstId),
      ref: lane.model,
      messages: toApiMessages(s.system, history),
      params: s.params,
      feature: 'compare',
    });
  };

  const send = (text: string) => {
    let id = session?.id;
    if (!id) {
      id = create('compare', {
        title: titleFrom(text),
        system: draftSystem,
        params: draftParams,
        lanes: draft.map((model) => ({ id: uid(), model, messages: [] })),
      });
    }
    const sid = id;
    update(sid, (x) => {
      const c = x as CompareSession;
      if (!c.lanes.some((l) => l.messages.length)) c.title = titleFrom(text);
      c.judge = c.judge ? { model: c.judge.model } : undefined;
      for (const l of c.lanes) l.messages.push({ id: uid(), role: 'user', content: text, createdAt: Date.now() });
    });
    const s = useData.getState().sessions[sid] as CompareSession;
    s.lanes.forEach((l) => void runLane(sid, l.id));
  };

  const vote = (turn: number, laneId: string) => {
    if (!session || session.votes[turn]) return;
    const winner = session.lanes.find((l) => l.id === laneId)!;
    update(session.id, (x) => void ((x as CompareSession).votes[turn] = laneId), false);
    recordVote(modelKey(winner.model), session.lanes.map((l) => modelKey(l.model)));
    toast(`Vote saved: ${winner.model.model} wins round ${turn + 1}`, 'success');
  };

  const judgeModel: ModelRef = session?.judge?.model ?? usableModelRefs(1)[0];
  const runJudge = async () => {
    if (!session) return;
    const turn = turns - 1;
    const question = session.lanes[0].messages.filter((m) => m.role === 'user')[turn]?.content ?? '';
    const answers = session.lanes.map((l, i) => {
      const a = l.messages.filter((m) => m.role === 'assistant')[turn];
      return `### Answer ${String.fromCharCode(65 + i)}\n${a ? splitThink(a.content).answer : '(no answer)'}`;
    });
    const msgId = uid();
    update(session.id, (x) => {
      (x as CompareSession).judge = {
        model: judgeModel,
        message: { id: msgId, role: 'assistant', content: '', model: judgeModel, status: 'streaming', createdAt: Date.now() },
      };
    });
    await streamReply({
      sessionId: session.id,
      jobId: `${session.id}:judge`,
      locate: (x) => ((x as CompareSession).judge?.message?.id === msgId ? (x as CompareSession).judge!.message : undefined),
      ref: judgeModel,
      feature: 'compare',
      messages: [
        { role: 'system', content: 'You are a fair, strict judge of AI answers. The answers are anonymous. Judge accuracy first, then helpfulness, clarity and completeness. Do not favour length.' },
        { role: 'user', content: `## Question\n${question}\n\n${answers.join('\n\n')}\n\nRank the answers from best to worst. For each, give a score out of 10 and one or two sentences of reasons. End with a line "Winner: Answer X".` },
      ],
    });
  };

  const providers = allProviders();
  const laneNames = session?.lanes.map((l, i) => `${String.fromCharCode(65 + i)} = ${l.model.model}`).join(' · ');

  return (
    <div className="view compare-view">
      <TopBar
        right={
          <>
            <button className="btn ghost sm" onClick={() => openModal('leaderboard')} title="Your leaderboard from votes"><Trophy size={15} /> Leaderboard</button>
            <ParamsButton
              system={session?.system ?? draftSystem}
              params={session?.params ?? draftParams}
              onChange={(system, params) => {
                if (session) update(session.id, (x) => {
                  const c = x as CompareSession;
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
        <span className="topbar-title strong">Compare</span>
        <span className="muted sm hide-sm">{lanes.length} models · same prompt · live metrics</span>
      </TopBar>

      <div className="lanes-scroll">
        <div className="lanes" style={{ ['--lanes' as string]: lanes.length }}>
          {lanes.map((lane, i) => {
            const stats = session ? laneStats(lane as CompareLane) : null;
            const p = providers.find((x) => x.id === lane.model.providerId);
            const assistants = lane.messages.filter((m) => m.role === 'assistant');
            return (
              <section key={lane.id} className="lane" style={{ ['--lane-color' as string]: p?.color ?? 'var(--accent)' }}>
                <div className="lane-head">
                  <span className="lane-letter">{String.fromCharCode(65 + i)}</span>
                  <ModelPicker value={lane.model} onChange={(r) => setLaneModel(i, r)} size="sm" />
                  <button className="icon-btn xs" title="Remove this model" onClick={() => removeLane(i)} disabled={busy}><X size={14} /></button>
                </div>
                {stats && (
                  <div className="lane-stats">
                    <span>first token {fmtMs(stats.ttft)}</span>
                    <span>total {fmtMs(stats.total)}</span>
                  </div>
                )}
                <div className="lane-body">
                  {lane.messages.length === 0 && <div className="lane-empty">Waiting for your prompt…</div>}
                  {lane.messages.map((m) => {
                    if (m.role === 'user') return <div key={m.id} className="lane-q">{m.content}</div>;
                    const turn = assistants.indexOf(m);
                    const winner = session?.votes[turn];
                    const split = m.reasoning ? { reasoning: m.reasoning, answer: m.content } : splitThink(m.content);
                    return (
                      <div key={m.id} className={`lane-a${winner === lane.id ? ' winner' : ''}`}>
                        <Reasoning text={split.reasoning} streaming={m.status === 'streaming' && !split.answer} />
                        {m.statusText && <div className="status-line"><span className="pulse-dot" />{m.statusText}</div>}
                        {split.answer ? <Markdown text={split.answer} /> : m.status === 'streaming' ? <TypingDots /> : null}
                        {m.status === 'error' && <div className="msg-error"><span>{m.error}</span></div>}
                        {m.status === 'done' && (
                          <div className="lane-foot">
                            <Metrics m={m} />
                            {winner === lane.id ? (
                              <span className="win-badge"><Trophy size={13} /> Winner</span>
                            ) : !winner && !busy ? (
                              <button className="btn ghost xs" onClick={() => vote(turn, lane.id)}><Trophy size={13} /> Best</button>
                            ) : null}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
          {lanes.length < MAX_LANES && (
            <button className="lane add-lane" onClick={addLane} disabled={busy}>
              <Plus size={22} />
              <span>Add model</span>
              <span className="muted xs">up to {MAX_LANES}</span>
            </button>
          )}
        </div>
      </div>

      {session && turns > 0 && (
        <div className="judge-bar">
          <Scale size={16} />
          <span className="hide-sm">AI judge</span>
          <ModelPicker value={judgeModel} onChange={(r) => update(session.id, (x) => void ((x as CompareSession).judge = { ...(x as CompareSession).judge, model: r }), false)} size="sm" />
          <button className="btn primary sm" onClick={runJudge} disabled={busy}>Judge the last round</button>
          {laneNames && <span className="muted xs hide-sm">{laneNames}</span>}
        </div>
      )}
      {session?.judge?.message && (
        <div className="judge-panel">
          <MessageItem m={session.judge.message} />
        </div>
      )}

      <Composer onSend={send} busy={busy} onStop={() => session && stopJobs(session.id)} placeholder="Ask all models the same thing…" />
    </div>
  );
}
