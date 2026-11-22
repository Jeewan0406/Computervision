/**
 * Minimal Server-Sent Events line parser. Feed it raw text chunks; it calls
 * `onData` with the payload of every complete `data:` line. Kept free of
 * browser APIs so it can be unit-tested in Node.
 */
export function createSSEParser(onData: (data: string) => void) {
  let buffer = '';
  return {
    push(chunk: string) {
      buffer += chunk;
      let idx: number;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).replace(/\r$/, '');
        buffer = buffer.slice(idx + 1);
        if (line.startsWith('data:')) onData(line.slice(5).trimStart());
      }
    },
    flush() {
      const line = buffer.replace(/\r$/, '');
      buffer = '';
      if (line.startsWith('data:')) onData(line.slice(5).trimStart());
    },
  };
}

/** Parse a Retry-After header (seconds or HTTP date) into milliseconds. */
export function parseRetryAfter(value: string | null | undefined, nowMs = Date.now()): number | undefined {
  if (!value) return undefined;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, date - nowMs);
  return undefined;
}
