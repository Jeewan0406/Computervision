import type { GenParams, Message, ModelRef, Session, View } from './types';
import type { ChatMsg } from './llm';
import { useData } from './data';
import { runChat, startJob, endJob } from './runner';
import { makeFlusher } from './stream';
import { isAbort } from './utils';

/**
 * Stream one model reply into an existing (placeholder) message inside any
 * session type. `locate` finds that message in a draft of the session.
 * Resolves to the final text, or null when it failed or was stopped.
 */
export async function streamReply(opts: {
  sessionId: string;
  jobId: string;
  locate: (s: Session) => Message | undefined;
  ref: ModelRef;
  messages: ChatMsg[];
  params?: GenParams;
  feature: View;
  onLive?: (text: string) => void;
}): Promise<string | null> {
  const { update } = useData.getState();
  const patch = (fn: (m: Message) => void) =>
    update(opts.sessionId, (x) => {
      const m = opts.locate(x);
      if (m) fn(m);
    }, false);

  const ctrl = startJob(opts.jobId);
  const f = makeFlusher((text, reasoning, status) => {
    patch((m) => {
      m.content = text;
      m.reasoning = reasoning || undefined;
      m.statusText = status || undefined;
    });
    opts.onLive?.(text);
  });
  try {
    const r = await runChat({
      ref: opts.ref,
      messages: opts.messages,
      params: opts.params,
      feature: opts.feature,
      signal: ctrl.signal,
      onText: f.onText,
      onReasoning: f.onReasoning,
      onStatus: f.onStatus,
    });
    f.finish();
    patch((m) => {
      m.content = r.content;
      m.reasoning = r.reasoning || undefined;
      m.status = 'done';
      m.meta = r.meta;
      m.model = r.usedRef;
      m.statusText = undefined;
    });
    update(opts.sessionId, () => undefined); // bump updatedAt
    return r.content;
  } catch (e) {
    f.finish();
    patch((m) => {
      m.status = isAbort(e) ? 'stopped' : 'error';
      m.error = isAbort(e) ? undefined : (e as Error).message;
      m.statusText = undefined;
    });
    return null;
  } finally {
    endJob(opts.jobId);
  }
}
