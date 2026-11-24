import { isAuto } from './router';
import { autoPick } from './autopick';
import { currentThinking, thinkingText } from './thinkrun';
import type { AgentSession, AgentStep, Message, MsgMeta } from './types';
import { useData } from './data';
import { getProvider } from './settings';
import { runWithSlots, startJob, endJob } from './runner';
import { LLMError, streamAnthropicAgent, streamOpenAI, streamText, type ChatMsg, type OAIMessage, type OAITool } from './llm';
import { AGENT_SYSTEM, clip, parseToolCall, stripToolBlock, textProtocolPrompt, validateArgs } from './agentText';
import { AGENT_TOOLS, TOOL_BY_NAME, delegateIds, type ToolResult } from './tools';
import { makeFlusher } from './stream';
import { log } from './logs';
import { splitThink } from './text';
import { isAbort, uid } from './utils';
import { prepareWeb, joinSystem } from './webrun';
import { rulesText } from './rules';
import { personalContext } from './context';
import { ANSWER_STANDARD } from './standard';
import { tooLongHint } from './reply';

/**
 * Agent loop: ask the model, run the tools it requests, give it the results,
 * and repeat until it answers without a tool or the step limit is reached.
 *
 * Three ways to talk to a model:
 *  - "openai":    native tool calling (tools / tool_calls / role "tool")
 *  - "anthropic": Claude tool use through Anthropic's SDK
 *  - "text":      for models without tool calling (e.g. the free model):
 *                 the model writes a ```tool JSON block that JeeA! parses
 * If a provider rejects native tools, the run switches to "text" by itself.
 */

type Mode = 'openai' | 'anthropic' | 'text';

const NUDGE = 'You have reached the step limit. Do not call any more tools. Give your best final answer now, and say what is still unfinished.';

export async function runAgent(sid: string, asstId: string) {
  const store = useData.getState();
  const s0 = store.sessions[sid] as AgentSession;
  // Auto: an agent run keeps one model (its tool history belongs to that
  // model), so the choice is made once here, preferring models with tool use.
  let ref = s0.model;
  let autoNote: string | undefined;
  if (isAuto(ref)) {
    const question = [...s0.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    const pick = autoPick({ text: question }, { forAgent: true });
    if (pick.chain[0]) {
      ref = pick.chain[0];
      autoNote = pick.reason;
    }
  }
  const provider = getProvider(ref.providerId);
  const msgOf = (x: unknown) => (x as AgentSession).messages.find((m) => m.id === asstId);
  const patchMsg = (fn: (m: Message) => void) => useData.getState().update(sid, (x) => {
    const m = msgOf(x);
    if (m) fn(m);
  }, false);
  const addStep = (st: AgentStep) => patchMsg((m) => void (m.steps ??= []).push(st));
  const patchStep = (id: string, fn: (st: AgentStep) => void) => patchMsg((m) => {
    const st = m.steps?.find((x) => x.id === id);
    if (st) fn(st);
  });

  if (!provider || isAuto(ref)) {
    patchMsg((m) => { m.status = 'error'; m.error = isAuto(ref) ? 'Auto found no model you can use right now. Add a key in API Slots, or choose a model.' : 'Unknown provider.'; });
    return;
  }

  const tools = AGENT_TOOLS.filter((t) => s0.tools.includes(t.name));
  const toolNames = tools.map((t) => t.name);
  const history = s0.messages.filter((m) => m.id !== asstId && (m.role === 'user' || (m.status === 'done' && m.content.trim())));
  const convo = history.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.role === 'assistant' ? splitThink(m.content).answer : m.content }));
  // Web search before the first step (same setting as Chat), shown as Sources.
  const users = history.filter((m) => m.role === 'user');
  const w = await prepareWeb(users[users.length - 1]?.content ?? '', {
    jobId: `${sid}:${asstId}`,
    feature: 'agent',
    previous: users[users.length - 2]?.content,
    onStart: (info) => patchMsg((m) => {
      m.web = info;
      m.statusText = `Searching the web for “${info.query}”…`;
    }),
  });
  patchMsg((m) => {
    m.web = w.web;
    m.sources = w.sources;
    m.statusText = undefined;
    if (w.aborted) m.status = 'stopped';
  });
  if (w.aborted) return;
  const base = `${AGENT_SYSTEM}\nToday is ${new Date().toDateString()}.${toolNames.includes('ask_model') ? `\nModels you can ask with ask_model: ${delegateIds().join(', ')}.` : ''}`;
  const pc = await personalContext('agent', s0.projectId, users[users.length - 1]?.content ?? '');
  const system = joinSystem(base, ANSWER_STANDARD, rulesText(), thinkingText(), pc.text, w.prompt);

  let mode: Mode = provider.kind === 'anthropic' ? 'anthropic' : provider.kind === 'puter' || provider.nativeTools === false ? 'text' : 'openai';
  if (!tools.length) mode = provider.kind === 'anthropic' ? 'anthropic' : 'text';

  const oaiTools: OAITool[] = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
  const oai: OAIMessage[] = [{ role: 'system', content: system }, ...convo];
  const anth: unknown[] = convo[0]?.role === 'assistant' ? [{ role: 'user', content: '(continue)' }, ...convo] : [...convo];
  const txt: OAIMessage[] = [{ role: 'system', content: tools.length ? `${system}\n\n${textProtocolPrompt(tools)}` : system }, ...convo];

  const job = `${sid}:${asstId}`;
  const ctrl = startJob(job);
  const t0 = performance.now();
  const meta: MsgMeta = { tokensIn: 0, tokensOut: 0, estimated: false, auto: autoNote };
  let finalText = '';
  let stepsUsed = 0;
  const maxSteps = Math.max(1, Math.min(25, s0.maxSteps || 8));

  try {
    for (let turn = 0; turn <= maxSteps; turn++) {
      const lastChance = turn === maxSteps;
      const f = makeFlusher((text, reasoning, status) => patchMsg((m) => {
        m.content = text;
        m.reasoning = reasoning || undefined;
        m.statusText = status || undefined;
      }));
      type Turn = { content: string; reasoning: string; tokensIn?: number; tokensOut?: number; toolCalls?: { id: string; name: string; argsText: string }[]; assistantContent?: unknown[]; toolUses?: { id: string; name: string; input: Record<string, unknown> }[]; stopReason?: string };
      let res: { result: Turn; meta: MsgMeta };
      try {
        res = await runWithSlots<Turn>(
          { ref, feature: 'agent', signal: ctrl.signal, onText: f.onText, onReasoning: f.onReasoning, onStatus: f.onStatus, allowFallback: false, inputForEstimate: JSON.stringify(mode === 'anthropic' ? anth : mode === 'openai' ? oai : txt) },
          (target, h, signal) => {
            if (mode === 'anthropic') {
              const msgs = lastChance ? [...anth, { role: 'user', content: NUDGE }] : anth;
              return streamAnthropicAgent(target, system, msgs, tools, { effort: currentThinking() }, signal, h);
            }
            if (mode === 'openai') {
              const msgs = lastChance ? [...oai, { role: 'user', content: NUDGE }] : oai;
              return streamOpenAI(target, msgs, { effort: currentThinking() }, signal, h, { tools: oaiTools, toolChoice: lastChance ? 'none' : 'auto' });
            }
            return streamText(target, (lastChance ? [...txt, { role: 'user', content: NUDGE }] : txt) as ChatMsg[], { effort: currentThinking() }, signal, h);
          },
        );
      } catch (e) {
        f.finish();
        if (mode === 'openai' && e instanceof LLMError && e.status && e.status >= 400 && e.status < 500 && /tool|function/i.test(e.message)) {
          log({ level: 'warn', type: 'system', feature: 'agent', providerId: provider.id, providerName: provider.name, model: ref.model, message: 'Model rejected native tool calling; switching to text tool protocol.' });
          mode = 'text';
          turn--;
          continue;
        }
        throw e;
      }
      f.finish();
      const r = res.result;
      meta.tokensIn = (meta.tokensIn ?? 0) + (res.meta.tokensIn ?? 0);
      meta.tokensOut = (meta.tokensOut ?? 0) + (res.meta.tokensOut ?? 0);
      meta.estimated = meta.estimated || !!res.meta.estimated;
      meta.ttftMs ??= res.meta.ttftMs;
      meta.slotLabel = res.meta.slotLabel;
      meta.providerName = res.meta.providerName;

      // Which tools did the model ask for?
      let calls: { id: string; name: string; args: Record<string, unknown>; parseError?: string }[] = [];
      let thought = r.content;
      if (!lastChance) {
        if (mode === 'openai') {
          calls = (r.toolCalls ?? []).filter((c) => c.name).map((c) => {
            try {
              return { id: c.id || `call_${uid().slice(0, 8)}`, name: c.name, args: c.argsText.trim() ? JSON.parse(c.argsText) : {} };
            } catch {
              return { id: c.id || `call_${uid().slice(0, 8)}`, name: c.name, args: {}, parseError: 'The tool arguments were not valid JSON.' };
            }
          });
        } else if (mode === 'anthropic') {
          if (r.stopReason === 'refusal') {
            finalText = `${r.content}\n\n> The model declined this request.`.trim();
            break;
          }
          if (r.stopReason === 'max_tokens' && r.toolUses?.length) throw new LLMError('The model was cut off while writing a tool request (max tokens).');
          calls = (r.toolUses ?? []).map((u) => ({ id: u.id, name: u.name, args: u.input }));
        } else {
          const parsed = toolNames.length ? parseToolCall(r.content, toolNames) : null;
          if (parsed) {
            calls = [{ id: uid(), name: parsed.name, args: parsed.args }];
            thought = stripToolBlock(r.content);
          }
        }
      }

      if (!calls.length) {
        finalText = mode === 'text' ? stripToolBlock(r.content) : r.content;
        break;
      }

      // Show the model's short reasoning as a step, then run each tool.
      patchMsg((m) => { m.content = ''; m.reasoning = undefined; });
      if (thought.trim()) addStep({ id: uid(), kind: 'thought', text: thought.trim() });
      const results: { id: string; name: string; text: string; error: boolean }[] = [];
      for (const c of calls) {
        stepsUsed++;
        const stepId = uid();
        addStep({ id: stepId, kind: 'tool', tool: { name: c.name, args: c.args, status: 'running' } });
        const tool = TOOL_BY_NAME.get(c.name);
        const ts = performance.now();
        let text = '';
        let error = false;
        let link: ToolResult['link'];
        if (c.parseError) [text, error] = [c.parseError, true];
        else if (!tool || !toolNames.includes(c.name)) [text, error] = [`The tool "${c.name}" is not available. Available tools: ${toolNames.join(', ')}.`, true];
        else {
          const bad = validateArgs(tool, c.args);
          if (bad) [text, error] = [bad, true];
          else {
            try {
              const out = await tool.run(c.args, { sessionId: sid, signal: ctrl.signal });
              if (typeof out === 'string') text = out;
              else [text, link] = [out.text, out.link];
            } catch (e) {
              if (isAbort(e) || ctrl.signal.aborted) throw new DOMException('Aborted', 'AbortError');
              [text, error] = [`Error: ${(e as Error).message}`, true];
            }
          }
        }
        const ms = performance.now() - ts;
        patchStep(stepId, (st) => {
          if (!st.tool) return;
          st.tool.status = error ? 'error' : 'done';
          st.tool.result = clip(text, 4000);
          st.tool.ms = ms;
          if (link) st.tool.link = link;
        });
        log({ level: error ? 'warn' : 'info', type: 'system', feature: 'agent', providerId: provider.id, providerName: provider.name, model: ref.model, totalMs: ms, message: `Tool ${c.name}: ${error ? text.slice(0, 160) : 'ok'}` });
        results.push({ id: c.id, name: c.name, text, error });
      }

      // Feed the results back in the format this mode expects.
      if (mode === 'openai') {
        oai.push({ role: 'assistant', content: r.content || null, tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) });
        for (const x of results) oai.push({ role: 'tool', tool_call_id: x.id, content: x.text, ...(provider.id === 'mistral' ? { name: x.name } : {}) });
      } else if (mode === 'anthropic') {
        anth.push({ role: 'assistant', content: r.assistantContent });
        anth.push({ role: 'user', content: results.map((x) => ({ type: 'tool_result', tool_use_id: x.id, content: x.text, ...(x.error ? { is_error: true } : {}) })) });
      } else {
        txt.push({ role: 'assistant', content: r.content });
        txt.push({ role: 'user', content: `Result of ${results[0].name}:\n${results[0].text}\n\nContinue with the task. Use another tool if needed, or give the final answer.` });
      }
    }

    meta.totalMs = performance.now() - t0;
    patchMsg((m) => {
      m.content = finalText || '(The agent finished without a written answer.)';
      m.status = 'done';
      m.meta = { ...meta, attempts: stepsUsed };
      m.model = ref;
      m.statusText = undefined;
    });
    useData.getState().update(sid, () => undefined);
  } catch (e) {
    patchMsg((m) => {
      m.status = isAbort(e) ? 'stopped' : 'error';
      m.error = isAbort(e) ? undefined : `${(e as Error).message}${tooLongHint((e as Error).message)}`;
      m.statusText = undefined;
      m.meta = { ...meta, totalMs: performance.now() - t0, attempts: stepsUsed };
    });
  } finally {
    endJob(job);
  }
}
