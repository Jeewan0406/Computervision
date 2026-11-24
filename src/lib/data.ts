import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import type {
  AgentSession,
  ChatSession,
  CodeSession,
  CompareSession,
  Session,
  SessionKind,
  TeamSession,
} from './types';
import { uid } from './utils';
import { useSettings, usableModelRefs } from './settings';
import { TEAM_PRESETS, presetRoles } from './team';
import { DEFAULT_AGENT_TOOLS } from './agentText';

/**
 * Conversations of every mode, stored in IndexedDB (not localStorage) because
 * histories can grow large. Writes are debounced so streaming a reply does
 * not rewrite the database on every token.
 */
interface DataState {
  hydrated: boolean;
  sessions: Record<string, Session>;
  active: Record<SessionKind, string | null>;
}

interface DataActions {
  create: <K extends SessionKind>(kind: K, init?: Partial<Extract<Session, { kind: K }>>) => string;
  update: (id: string, recipe: (s: Session) => void, touch?: boolean) => void;
  remove: (id: string) => void;
  setActive: (kind: SessionKind, id: string | null) => void;
  clearAll: () => void;
  importSessions: (list: Session[]) => void;
}

const DB_KEY = 'jeea.data.v1';

/** Project new conversations belong to (set by projects.ts, kept here to avoid an import cycle). */
let projectSource: () => string | undefined = () => undefined;
export const setProjectSource = (fn: () => string | undefined) => void (projectSource = fn);

export const useData = create<DataState & DataActions>()(
  immer((set) => ({
    hydrated: false,
    sessions: {},
    active: { chat: null, agent: null, compare: null, team: null, code: null },

    create: (kind, init) => {
      const id = uid();
      const t = Date.now();
      const settings = useSettings.getState();
      let s: Session;
      switch (kind) {
        case 'chat':
          s = {
            id, kind: 'chat', title: 'New chat', createdAt: t, updatedAt: t,
            model: settings.defaultModel, system: '', params: {}, messages: [],
            ...(init as Partial<ChatSession>),
          };
          break;
        case 'compare': {
          const refs = usableModelRefs(3);
          while (refs.length < 2) refs.push(refs[0]);
          s = {
            id, kind: 'compare', title: 'New comparison', createdAt: t, updatedAt: t,
            system: '', params: {}, votes: {},
            lanes: refs.map((model) => ({ id: uid(), model, messages: [] })),
            ...(init as Partial<CompareSession>),
          };
          break;
        }
        case 'team': {
          const preset = TEAM_PRESETS[0];
          s = {
            id, kind: 'team', title: 'New team run', createdAt: t, updatedAt: t,
            mode: preset.mode, rounds: preset.rounds ?? 2, roles: presetRoles(preset), runs: [],
            ...(init as Partial<TeamSession>),
          };
          break;
        }
        case 'agent':
          s = {
            id, kind: 'agent', title: 'New agent task', createdAt: t, updatedAt: t,
            model: settings.defaultModel, messages: [], tools: DEFAULT_AGENT_TOOLS.slice(), maxSteps: 8, files: {},
            ...(init as Partial<AgentSession>),
          };
          break;
        case 'code':
        default:
          s = {
            id, kind: 'code', title: 'New project', createdAt: t, updatedAt: t,
            model: settings.defaultModel, messages: [], code: '', versions: [],
            ...(init as Partial<CodeSession>),
          };
      }
      const projectId = (init as { projectId?: string } | undefined)?.projectId ?? projectSource();
      if (projectId) s.projectId = projectId;
      set((st) => {
        st.sessions[id] = s;
        st.active[kind] = id;
      });
      return id;
    },

    update: (id, recipe, touch = true) =>
      set((st) => {
        const s = st.sessions[id];
        if (!s) return;
        recipe(s as Session);
        if (touch) s.updatedAt = Date.now();
      }),

    remove: (id) =>
      set((st) => {
        const s = st.sessions[id];
        if (!s) return;
        delete st.sessions[id];
        if (st.active[s.kind] === id) st.active[s.kind] = null;
      }),

    setActive: (kind, id) =>
      set((st) => {
        st.active[kind] = id;
      }),

    clearAll: () =>
      set((st) => {
        st.sessions = {};
        st.active = { chat: null, agent: null, compare: null, team: null, code: null };
      }),

    importSessions: (list) =>
      set((st) => {
        for (const s of list) if (s && s.id && s.kind) st.sessions[s.id] = s;
      }),
  })),
);

// ---- persistence -------------------------------------------------------
let saveTimer: number | undefined;
function scheduleSave() {
  if (!useData.getState().hydrated) return;
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(flushSave, 700);
}
function flushSave() {
  const { sessions, active } = useData.getState();
  idbSet(DB_KEY, { sessions, active }).catch(() => {
    /* storage full or private mode: keep working in memory */
  });
}

export async function hydrateData() {
  try {
    const saved = (await idbGet(DB_KEY)) as Pick<DataState, 'sessions' | 'active'> | undefined;
    if (saved?.sessions) {
      // Any reply that was streaming when the tab closed is now stopped.
      for (const s of Object.values(saved.sessions)) markStopped(s);
      useData.setState({ sessions: saved.sessions, active: { ...useData.getState().active, ...saved.active } });
    }
  } catch {
    /* IndexedDB unavailable: run in memory */
  }
  useData.setState({ hydrated: true });
  useData.subscribe(scheduleSave);
  window.addEventListener('pagehide', flushSave);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSave();
  });
}

function markStopped(s: Session) {
  const fix = (m: { status?: string }) => {
    if (m.status === 'streaming') m.status = 'stopped';
  };
  if (s.kind === 'chat' || s.kind === 'code' || s.kind === 'agent') s.messages.forEach(fix);
  if (s.kind === 'compare') {
    s.lanes.forEach((l) => l.messages.forEach(fix));
    if (s.judge?.message) fix(s.judge.message);
  }
  if (s.kind === 'team')
    s.runs.forEach((r) => {
      if (r.status === 'running') r.status = 'stopped';
      r.steps.forEach((st) => fix(st.message));
    });
}

export function sessionsOf(kind: SessionKind, sessions: Record<string, Session>) {
  return Object.values(sessions)
    .filter((s) => s.kind === kind)
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt);
}
