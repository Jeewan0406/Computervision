import { useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Plus, Trash2, Users } from 'lucide-react';
import type { TeamMode, TeamRole, TeamRun, TeamSession, TeamStep } from '../lib/types';
import { useData } from '../lib/data';
import { usableModelRefs } from '../lib/settings';
import { useUI } from '../lib/ui';
import { stopJobs } from '../lib/runner';
import { streamReply } from '../lib/reply';
import { MODE_INFO, TEAM_PRESETS, newStep, planTeam, presetRoles } from '../lib/team';
import { splitThink } from '../lib/text';
import { titleFrom, uid } from '../lib/utils';
import { TopBar } from '../components/Shell';
import { ModelPicker, ModelBadge } from '../components/ModelPicker';
import { Markdown, Metrics, Reasoning, TypingDots } from '../components/Message';
import { Composer } from '../components/Composer';
import { useAutoScroll } from '../components/hooks';

const COLORS = ['#8b5cf6', '#06b6d4', '#f59e0b', '#10b981', '#ec4899', '#3b82f6', '#ef4444'];
const EMOJIS = ['🤖', '🧠', '🦉', '🧭', '💻', '🔍', '✍️', '⚖️', '💡', '🧪'];

type TeamDraft = Pick<TeamSession, 'mode' | 'rounds' | 'roles'>;

function freshDraft(): TeamDraft {
  const p = TEAM_PRESETS[0];
  return { mode: p.mode, rounds: p.rounds ?? 2, roles: presetRoles(p) };
}

/** Run every wave of the plan; steps inside a wave run in parallel. */
async function executeRun(sid: string, runId: string, input: string) {
  const { update } = useData.getState();
  const s = useData.getState().sessions[sid] as TeamSession;
  const waves = planTeam(s, input);
  const done: { step: TeamStep; content: string }[] = [];
  const findRun = (x: TeamSession) => x.runs.find((r) => r.id === runId);
  let failed = false;

  for (const wave of waves) {
    const stepsNow = wave.map((p) => ({ plan: p, step: newStep(p.role, p.round) }));
    update(sid, (x) => {
      const run = findRun(x as TeamSession);
      if (run) run.steps.push(...stepsNow.map((w) => w.step));
    });
    const results = await Promise.all(
      stepsNow.map(async ({ plan, step }) => {
        const text = await streamReply({
          sessionId: sid,
          jobId: `${sid}:${runId}:${step.id}`,
          locate: (x) => findRun(x as TeamSession)?.steps.find((st) => st.id === step.id)?.message,
          ref: plan.role.model,
          messages: plan.build(done),
          feature: 'team',
        });
        return { step, text };
      }),
    );
    for (const r of results) {
      if (r.text == null) failed = true;
      else done.push({ step: r.step, content: splitThink(r.text).answer });
    }
    // Stop if a whole wave failed; a partial wave can still feed the next role.
    if (results.every((r) => r.text == null)) break;
  }
  const stopped = (useData.getState().sessions[sid] as TeamSession)?.runs
    .find((r) => r.id === runId)?.steps.some((st) => st.message.status === 'stopped');
  update(sid, (x) => {
    const run = findRun(x as TeamSession);
    if (run) run.status = stopped ? 'stopped' : failed ? 'error' : 'done';
  });
}

function RoleCard({ role, index, total, onChange, onMove, onRemove, mode }: {
  role: TeamRole; index: number; total: number; mode: TeamMode;
  onChange: (r: TeamRole) => void; onMove: (d: -1 | 1) => void; onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const isLast = index === total - 1;
  const tag = mode === 'moa' ? (isLast ? 'merges' : 'answers') : mode === 'debate' ? (isLast ? 'judges' : 'debates') : `step ${index + 1}`;
  return (
    <div className="role-card" style={{ ['--role-color' as string]: role.color }}>
      <div className="role-top">
        <button
          className="role-emoji"
          title="Change icon"
          onClick={() => onChange({ ...role, emoji: EMOJIS[(EMOJIS.indexOf(role.emoji) + 1) % EMOJIS.length] })}
        >
          {role.emoji}
        </button>
        <input className="role-name" value={role.name} onChange={(e) => onChange({ ...role, name: e.target.value })} aria-label="Role name" />
        <span className="role-tag">{tag}</span>
        <div className="role-tools">
          <button className="icon-btn xs" disabled={index === 0} onClick={() => onMove(-1)} title="Move up"><ArrowUp size={13} /></button>
          <button className="icon-btn xs" disabled={isLast} onClick={() => onMove(1)} title="Move down"><ArrowDown size={13} /></button>
          <button className="icon-btn xs" onClick={onRemove} title="Remove role"><Trash2 size={13} /></button>
        </div>
      </div>
      <div className="role-model">
        <ModelPicker value={role.model} onChange={(r) => onChange({ ...role, model: r })} size="sm" />
        <button className="btn ghost xs" onClick={() => setOpen((o) => !o)}>
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Instructions
        </button>
      </div>
      {open ? (
        <textarea rows={4} value={role.instructions} onChange={(e) => onChange({ ...role, instructions: e.target.value })} />
      ) : (
        <p className="role-instr" onClick={() => setOpen(true)}>{role.instructions}</p>
      )}
    </div>
  );
}

function StepCard({ step, final }: { step: TeamStep; final: boolean }) {
  const m = step.message;
  const [collapsed, setCollapsed] = useState(false);
  const split = m.reasoning ? { reasoning: m.reasoning, answer: m.content } : splitThink(m.content);
  return (
    <div className={`step${final ? ' final' : ''}`} style={{ ['--role-color' as string]: step.color }}>
      <div className="step-dot">{step.emoji}</div>
      <div className="step-card">
        <div className="step-head">
          <span className="step-role">{step.roleName}{step.round ? <span className="muted xs"> · round {step.round}</span> : null}</span>
          {m.model && <ModelBadge r={m.model} />}
          {final && m.status === 'done' && <span className="final-badge">Final answer</span>}
          <button className="icon-btn xs push" onClick={() => setCollapsed((c) => !c)} title={collapsed ? 'Expand' : 'Collapse'}>
            {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
        {!collapsed && (
          <>
            <Reasoning text={split.reasoning} streaming={m.status === 'streaming' && !split.answer} />
            {m.statusText && <div className="status-line"><span className="pulse-dot" />{m.statusText}</div>}
            {split.answer ? <Markdown text={split.answer} /> : m.status === 'streaming' ? <TypingDots /> : null}
            {m.status === 'error' && <div className="msg-error"><span>{m.error}</span></div>}
            {m.status === 'stopped' && <div className="muted xs">Stopped.</div>}
            {m.status === 'done' && <Metrics m={m} />}
          </>
        )}
      </div>
    </div>
  );
}

function RunView({ run }: { run: TeamRun }) {
  const lastId = run.steps[run.steps.length - 1]?.id;
  return (
    <div className="run">
      <div className="run-task">
        <span className="run-label">Task · {MODE_INFO[run.mode].label}</span>
        <div>{run.input}</div>
      </div>
      <div className="timeline">
        {run.steps.map((st) => (
          <StepCard key={st.id} step={st} final={st.id === lastId && run.status !== 'running'} />
        ))}
        {run.status === 'running' && run.steps.every((s) => s.message.status !== 'streaming') && (
          <div className="step"><div className="step-dot">⏳</div><div className="step-card"><TypingDots /></div></div>
        )}
      </div>
    </div>
  );
}

export function TeamView() {
  const activeId = useData((s) => s.active.team);
  const session = useData((s) => (activeId ? (s.sessions[activeId] as TeamSession | undefined) : undefined));
  const create = useData((s) => s.create);
  const update = useData((s) => s.update);
  const toast = useUI((s) => s.toast);
  const [draft, setDraft] = useState<TeamDraft>(freshDraft);
  const [setupOpen, setSetupOpen] = useState(true);
  const team: TeamDraft = session ?? draft;
  const busy = !!session?.runs.some((r) => r.status === 'running');
  const lastRun = session?.runs[session.runs.length - 1];
  const { ref } = useAutoScroll<HTMLDivElement>(`${session?.runs.length}:${lastRun?.steps.length}:${lastRun?.steps.map((s) => s.message.content.length).join(',')}`, !!session?.runs.length);

  const setTeam = (fn: (t: TeamDraft) => void) => {
    if (session) update(session.id, (x) => fn(x as TeamSession), false);
    else setDraft((d) => {
      const copy = structuredClone(d);
      fn(copy);
      return copy;
    });
  };

  const applyPreset = (id: string) => {
    const p = TEAM_PRESETS.find((x) => x.id === id);
    if (!p) return;
    const roles = presetRoles(p);
    setTeam((t) => {
      t.mode = p.mode;
      t.rounds = p.rounds ?? 2;
      t.roles = roles;
    });
    toast(`Loaded “${p.name}” — ${p.description}`, 'success');
  };

  const addRole = () => {
    const i = team.roles.length;
    const refs = usableModelRefs(6);
    setTeam((t) => void t.roles.push({
      id: uid(), name: `Role ${i + 1}`, emoji: EMOJIS[i % EMOJIS.length], color: COLORS[i % COLORS.length],
      model: refs[i % refs.length], instructions: 'Describe what this role should do.',
    }));
  };

  const send = (text: string) => {
    if (team.roles.length === 0) return toast('Add at least one role first.', 'error');
    if (team.mode === 'debate' && team.roles.length < 3) toast('Debate needs 3+ roles (debaters + judge). Running as a pipeline.', 'info');
    if (team.mode === 'moa' && team.roles.length < 2) toast('Mixture needs 2+ roles. Running as a pipeline.', 'info');
    let id = session?.id;
    if (!id) id = create('team', { title: titleFrom(text), mode: draft.mode, rounds: draft.rounds, roles: draft.roles });
    const runId = uid();
    update(id, (x) => {
      const t = x as TeamSession;
      if (!t.runs.length) t.title = titleFrom(text);
      t.runs.push({ id: runId, input: text, mode: t.mode, createdAt: Date.now(), steps: [], status: 'running' });
    });
    setSetupOpen(false);
    void executeRun(id, runId, text);
  };

  return (
    <div className="view team-view">
      <TopBar
        right={
          <button className="btn ghost sm only-mobile-flex" onClick={() => setSetupOpen((o) => !o)}>
            <Users size={15} /> {setupOpen ? 'Hide team' : 'Edit team'}
          </button>
        }
      >
        <span className="topbar-title strong">Team</span>
        <span className="muted sm hide-sm">different models · different roles · one task</span>
      </TopBar>

      <div className="team-layout">
        <aside className={`team-setup${setupOpen ? ' open' : ''}`}>
          <div className="team-setup-scroll">
            <label className="field">
              <span className="field-label">Start from a ready-made team</span>
              <select value="" onChange={(e) => applyPreset(e.target.value)} disabled={busy}>
                <option value="">Choose a preset…</option>
                {TEAM_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.description}</option>)}
              </select>
            </label>

            <div className="field">
              <span className="field-label">How the team works</span>
              <div className="seg full">
                {(Object.keys(MODE_INFO) as TeamMode[]).map((m) => (
                  <button key={m} className={team.mode === m ? 'active' : ''} onClick={() => setTeam((t) => void (t.mode = m))} disabled={busy}>
                    {MODE_INFO[m].label}
                  </button>
                ))}
              </div>
              <span className="field-help">{MODE_INFO[team.mode].hint}</span>
            </div>

            {team.mode === 'debate' && (
              <label className="field">
                <span className="field-label">Debate rounds: {team.rounds}</span>
                <input type="range" min={1} max={5} value={team.rounds} onChange={(e) => setTeam((t) => void (t.rounds = Number(e.target.value)))} />
              </label>
            )}

            <div className="roles">
              {team.roles.map((r, i) => (
                <RoleCard
                  key={r.id}
                  role={r}
                  index={i}
                  total={team.roles.length}
                  mode={team.mode}
                  onChange={(nr) => setTeam((t) => void (t.roles[i] = nr))}
                  onMove={(d) => setTeam((t) => {
                    const j = i + d;
                    [t.roles[i], t.roles[j]] = [t.roles[j], t.roles[i]];
                  })}
                  onRemove={() => setTeam((t) => void t.roles.splice(i, 1))}
                />
              ))}
              <button className="btn ghost block" onClick={addRole} disabled={team.roles.length >= 8}><Plus size={15} /> Add role</button>
            </div>
          </div>
        </aside>

        <div className="team-feed scroll" ref={ref}>
          {!session || session.runs.length === 0 ? (
            <div className="team-empty">
              <div className="team-empty-art">
                {team.roles.slice(0, 5).map((r) => (
                  <span key={r.id} className="bubble-role" style={{ ['--role-color' as string]: r.color }}>
                    <span>{r.emoji}</span>
                    <small>{r.name}</small>
                    <ModelBadge r={r.model} />
                  </span>
                ))}
              </div>
              <h2>Put different AIs to work together</h2>
              <p className="muted">Each role can use a different model. Pick a preset or build your own, then give the team a task below.</p>
            </div>
          ) : (
            session.runs.map((run) => <RunView key={run.id} run={run} />)
          )}
        </div>
      </div>

      <Composer onSend={send} busy={busy} onStop={() => session && stopJobs(session.id)} placeholder="Give your team a task…" />
    </div>
  );
}
