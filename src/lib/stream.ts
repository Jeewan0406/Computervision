/**
 * Buffers streamed text and pushes it to the store at most every `interval`
 * ms. Rendering Markdown for every single token would waste CPU; ~16 updates
 * per second looks just as smooth.
 */
export function makeFlusher(
  apply: (text: string, reasoning: string, status: string) => void,
  interval = 60,
) {
  let text = '';
  let reasoning = '';
  let status = '';
  let dirty = false;
  let timer: number | undefined;
  const flush = () => {
    timer = undefined;
    if (!dirty) return;
    dirty = false;
    apply(text, reasoning, status);
  };
  const schedule = () => {
    dirty = true;
    if (timer === undefined) timer = window.setTimeout(flush, interval);
  };
  return {
    onText: (d: string) => {
      text += d;
      schedule();
    },
    onReasoning: (d: string) => {
      reasoning += d;
      schedule();
    },
    onStatus: (s: string) => {
      status = s;
      schedule();
    },
    finish: () => {
      clearTimeout(timer);
      timer = undefined;
      dirty = true;
      flush();
    },
    get text() {
      return text;
    },
    get reasoning() {
      return reasoning;
    },
  };
}
