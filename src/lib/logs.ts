import { create } from 'zustand';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import type { LogEntry } from './types';
import { uid } from './utils';

/**
 * Activity log. Records every model request (provider, model, key label,
 * status, latency, tokens) and app events (key added, cooldown, fallback).
 * It never stores API keys or the text of your messages.
 */
const MAX = 3000;
const DB_KEY = 'jeea.logs.v1';

interface LogState {
  entries: LogEntry[];
  add: (e: Omit<LogEntry, 'id' | 'ts'>) => void;
  clear: () => void;
}

export const useLogs = create<LogState>()((set, get) => ({
  entries: [],
  add: (e) => {
    const entry: LogEntry = { ...e, id: uid(), ts: Date.now() };
    const next = [entry, ...get().entries];
    if (next.length > MAX) next.length = MAX;
    set({ entries: next });
  },
  clear: () => set({ entries: [] }),
}));

export const log = (e: Omit<LogEntry, 'id' | 'ts'>) => useLogs.getState().add(e);

let timer: number | undefined;
let hydrated = false;
export async function hydrateLogs() {
  try {
    const saved = (await idbGet(DB_KEY)) as LogEntry[] | undefined;
    if (Array.isArray(saved)) useLogs.setState({ entries: [...useLogs.getState().entries, ...saved].slice(0, MAX) });
  } catch {
    /* ignore */
  }
  hydrated = true;
  useLogs.subscribe(() => {
    if (!hydrated) return;
    clearTimeout(timer);
    timer = window.setTimeout(() => idbSet(DB_KEY, useLogs.getState().entries).catch(() => undefined), 1000);
  });
}

export function logsToCSV(entries: LogEntry[]): string {
  const cols: (keyof LogEntry)[] = [
    'ts', 'level', 'type', 'feature', 'providerName', 'model', 'slotLabel', 'status', 'httpStatus',
    'ttftMs', 'totalMs', 'tokensIn', 'tokensOut', 'estimated', 'attempt', 'message',
  ];
  const esc = (v: unknown) => {
    if (v == null) return '';
    const s = cols && typeof v === 'number' && v > 1e12 ? new Date(v).toISOString() : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...entries.map((e) => cols.map((c) => esc(e[c])).join(','))].join('\n');
}
