import type { Message, ModelRef, TeamMode, TeamRole, TeamSession, TeamStep } from './types';
import { uid } from './utils';
import { usableModelRefs } from './settings';
import type { ChatMsg } from './llm';

/**
 * Team mode: give different models different jobs in one run.
 *
 *  - pipeline: roles work one after another; each sees the earlier work.
 *  - moa (mixture of agents): all roles but the last answer in parallel;
 *    the last role merges the answers into one.
 *  - debate: all roles but the last argue for N rounds; the last role judges.
 */

export interface TeamPreset {
  id: string;
  name: string;
  mode: TeamMode;
  rounds?: number;
  description: string;
  roles: Omit<TeamRole, 'id' | 'model'>[];
}

export const TEAM_PRESETS: TeamPreset[] = [
  {
    id: 'code-squad',
    name: 'Code Squad',
    mode: 'pipeline',
    description: 'Architect plans, Coder builds, Reviewer fixes.',
    roles: [
      { name: 'Architect', emoji: '🧭', color: '#8b5cf6', instructions: 'Break the task into a short, clear plan: files, functions, data flow, edge cases. Do not write the full code.' },
      { name: 'Coder', emoji: '💻', color: '#06b6d4', instructions: 'Write complete, working code that follows the plan. Use clear names and short comments.' },
      { name: 'Reviewer', emoji: '🔍', color: '#f59e0b', instructions: 'Review the code for bugs, security issues and missed edge cases. List the problems, then give the corrected final code in full.' },
    ],
  },
  {
    id: 'research-desk',
    name: 'Research Desk',
    mode: 'pipeline',
    description: 'Researcher gathers, Critic challenges, Writer explains.',
    roles: [
      { name: 'Researcher', emoji: '🔎', color: '#3b82f6', instructions: 'List the key facts, numbers and open questions. Say clearly when you are unsure.' },
      { name: 'Critic', emoji: '🧪', color: '#ef4444', instructions: 'Find weak claims, missing evidence and other explanations. Be specific and fair.' },
      { name: 'Writer', emoji: '✍️', color: '#10b981', instructions: 'Write the final answer in plain, simple English. Keep the doubts the Critic raised.' },
    ],
  },
  {
    id: 'mixture',
    name: 'Mixture of Agents',
    mode: 'moa',
    description: 'Several models answer; one merges the best parts.',
    roles: [
      { name: 'Expert A', emoji: '🤖', color: '#8b5cf6', instructions: 'Answer the task as well as you can.' },
      { name: 'Expert B', emoji: '🧠', color: '#ec4899', instructions: 'Answer the task as well as you can. Think about angles others may miss.' },
      { name: 'Expert C', emoji: '🦉', color: '#06b6d4', instructions: 'Answer the task as well as you can. Focus on accuracy.' },
      { name: 'Synthesizer', emoji: '⚗️', color: '#f59e0b', instructions: 'Merge the experts\' answers into one best answer. Fix mistakes, remove repeats and say where they disagreed.' },
    ],
  },
  {
    id: 'debate',
    name: 'Debate Club',
    mode: 'debate',
    rounds: 2,
    description: 'Two models argue; a judge decides.',
    roles: [
      { name: 'Advocate', emoji: '👍', color: '#10b981', instructions: 'Argue FOR the idea with the strongest honest reasons and evidence.' },
      { name: 'Skeptic', emoji: '👎', color: '#ef4444', instructions: 'Argue AGAINST the idea with the strongest honest reasons and evidence.' },
      { name: 'Judge', emoji: '⚖️', color: '#f59e0b', instructions: 'Weigh both sides fairly. Say which arguments held up, which failed, and give a clear final verdict.' },
    ],
  },
  {
    id: 'writers-room',
    name: "Writer's Room",
    mode: 'pipeline',
    description: 'Ideas, draft, edit.',
    roles: [
      { name: 'Ideas', emoji: '💡', color: '#eab308', instructions: 'Suggest 3 to 5 strong angles or outlines. Pick the best one and say why.' },
      { name: 'Drafter', emoji: '📝', color: '#3b82f6', instructions: 'Write a full draft using the chosen outline.' },
      { name: 'Editor', emoji: '✂️', color: '#a855f7', instructions: 'Tighten the draft: simpler words, shorter sentences, no filler. Return the final version only.' },
    ],
  },
];

/** Build roles from a preset, spreading the user's usable models across them. */
export function presetRoles(preset: TeamPreset): TeamRole[] {
  const refs = usableModelRefs(6);
  return preset.roles.map((r, i) => ({ ...r, id: uid(), model: refs[i % refs.length] }));
}

export const MODE_INFO: Record<TeamMode, { label: string; hint: string }> = {
  pipeline: { label: 'Pipeline', hint: 'Roles work in order. Each sees the earlier work.' },
  moa: { label: 'Mixture', hint: 'All but the last answer at once; the last merges them.' },
  debate: { label: 'Debate', hint: 'All but the last argue in rounds; the last judges.' },
};

function roleSystem(role: TeamRole, rules = '') {
  const base = `You are "${role.name}", one member of a JeeA! AI team working on a shared task.\nYour job: ${role.instructions}\nStay in your role. Be clear and useful. Use Markdown.`;
  return rules.trim() ? `${rules.trim()}\n\n# Your role in this team\n${base}` : base;
}

const block = (s: { emoji: string; roleName: string; round?: number }, text: string) =>
  `### ${s.emoji} ${s.roleName}${s.round ? ` (round ${s.round})` : ''}\n${text.trim() || '(no answer)'}`;

export interface PlannedStep {
  role: TeamRole;
  round?: number;
  /** Builds the request from the finished earlier steps. */
  build: (done: { step: TeamStep; content: string }[]) => ChatMsg[];
}

/** Turn a team into ordered "waves"; steps in the same wave run in parallel. */
export function planTeam(session: Pick<TeamSession, 'mode' | 'rounds' | 'roles'>, input: string, background = '', rules = ''): PlannedStep[][] {
  const roles = session.roles;
  const systemFor = (role: TeamRole) => roleSystem(role, rules);
  // Background = today's date and any web results, shared by every role.
  const task = `## Task\n${input}${background.trim() ? `\n\n## Background (from JeeA!)\n${background.trim()}` : ''}`;
  if (!roles.length) return [];

  if (session.mode === 'moa' && roles.length >= 2) {
    const workers = roles.slice(0, -1);
    const synth = roles[roles.length - 1];
    return [
      workers.map((role) => ({ role, build: () => [{ role: 'system', content: systemFor(role) }, { role: 'user', content: task }] })),
      [{
        role: synth,
        build: (done) => [
          { role: 'system', content: systemFor(synth) },
          { role: 'user', content: `${task}\n\n## Answers from the experts\n${done.map((d) => block(d.step, d.content)).join('\n\n')}\n\nNow write the single best final answer.` },
        ],
      }],
    ];
  }

  if (session.mode === 'debate' && roles.length >= 3) {
    const debaters = roles.slice(0, -1);
    const judge = roles[roles.length - 1];
    const waves: PlannedStep[][] = [];
    const rounds = Math.max(1, Math.min(5, session.rounds || 2));
    for (let r = 1; r <= rounds; r++) {
      for (const role of debaters) {
        waves.push([{
          role,
          round: r,
          build: (done) => [
            { role: 'system', content: systemFor(role) },
            {
              role: 'user',
              content: `${task}\n\n${done.length ? `## Debate so far\n${done.map((d) => block(d.step, d.content)).join('\n\n')}\n\n` : ''}This is round ${r} of ${rounds}. Make your case${done.length ? ' and answer the strongest points from the other side' : ''}.`,
            },
          ],
        }]);
      }
    }
    waves.push([{
      role: judge,
      build: (done) => [
        { role: 'system', content: systemFor(judge) },
        { role: 'user', content: `${task}\n\n## Full debate\n${done.map((d) => block(d.step, d.content)).join('\n\n')}\n\nGive your verdict and the final answer.` },
      ],
    }]);
    return waves;
  }

  // pipeline (also the fallback when a mode has too few roles)
  return roles.map((role, i) => [{
    role,
    build: (done) => [
      { role: 'system', content: systemFor(role) },
      {
        role: 'user',
        content: i === 0 ? task : `${task}\n\n## Work from earlier teammates\n${done.map((d) => block(d.step, d.content)).join('\n\n')}\n\nNow do your part as ${role.name}.`,
      },
    ],
  }]);
}

export function newStep(role: TeamRole, round?: number): TeamStep {
  const message: Message = { id: uid(), role: 'assistant', content: '', model: role.model as ModelRef, status: 'streaming', createdAt: Date.now() };
  return { id: uid(), roleId: role.id, roleName: role.name, emoji: role.emoji, color: role.color, round, message };
}
