import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { ModelRef, ProviderDef, Slot } from './types';
import { BUILTIN_PROVIDERS, KEYLESS_ID } from './providers';
import { uid } from './utils';

export type Theme = 'system' | 'dark' | 'light';
export type Accent = 'violet' | 'blue' | 'emerald' | 'rose' | 'amber';

export interface Settings {
  theme: Theme;
  accent: Accent;
  sendOnEnter: boolean;
  showReasoning: boolean;
  /** 'local' keeps keys after the browser closes; 'session' forgets them. */
  keyStorage: 'local' | 'session';
  slots: Slot[];
  customProviders: ProviderDef[];
  defaultModel: ModelRef;
  fallback: { enabled: boolean; chain: ModelRef[] };
  maxRetries: number;
  corsProxy: string;
  /** model key -> wins / battles from Compare votes */
  leaderboard: Record<string, { wins: number; battles: number }>;
  seenVersion: string;
  /** "owner/repo" that runs the 24/7 GitHub agents (auto-detected on github.io). */
  agentRepo: string;
}

interface SettingsActions {
  set: (patch: Partial<Settings>) => void;
  addSlot: (s: Omit<Slot, 'id' | 'createdAt' | 'status' | 'uses' | 'failures'>) => Slot;
  updateSlot: (id: string, patch: Partial<Slot>) => void;
  removeSlot: (id: string) => void;
  addCustomProvider: (p: Omit<ProviderDef, 'id' | 'custom'>) => ProviderDef;
  removeCustomProvider: (id: string) => void;
  recordVote: (winner: string, all: string[]) => void;
}

export const DEFAULT_MODEL: ModelRef = { providerId: KEYLESS_ID, model: 'openai' };

const initial: Settings = {
  theme: 'dark',
  accent: 'violet',
  sendOnEnter: true,
  showReasoning: true,
  keyStorage: 'local',
  slots: [],
  customProviders: [],
  defaultModel: DEFAULT_MODEL,
  fallback: { enabled: true, chain: [DEFAULT_MODEL] },
  maxRetries: 2,
  corsProxy: '',
  leaderboard: {},
  seenVersion: '',
  agentRepo: '',
};

const SESSION_KEYS = 'jeea.keys.session';

/** In "session" mode keys live only in sessionStorage; the rest of the
 * settings (labels, providers, preferences) still persist in localStorage. */
const storage = createJSONStorage<Partial<Settings>>(() => ({
  getItem: (name) => {
    const raw = localStorage.getItem(name);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      const st = parsed?.state as Partial<Settings> | undefined;
      if (st?.keyStorage === 'session' && Array.isArray(st.slots)) {
        const keys: Record<string, string> = JSON.parse(sessionStorage.getItem(SESSION_KEYS) || '{}');
        st.slots = st.slots.map((s) => ({ ...s, apiKey: keys[s.id] ?? '' }));
      }
      return JSON.stringify(parsed);
    } catch {
      return raw;
    }
  },
  setItem: (name, value) => {
    try {
      const parsed = JSON.parse(value);
      const st = parsed?.state as Partial<Settings> | undefined;
      if (st?.keyStorage === 'session' && Array.isArray(st.slots)) {
        const keys: Record<string, string> = {};
        st.slots = st.slots.map((s) => {
          keys[s.id] = s.apiKey;
          return { ...s, apiKey: '' };
        });
        sessionStorage.setItem(SESSION_KEYS, JSON.stringify(keys));
        localStorage.setItem(name, JSON.stringify(parsed));
        return;
      }
      sessionStorage.removeItem(SESSION_KEYS);
    } catch {
      /* fall through */
    }
    localStorage.setItem(name, value);
  },
  removeItem: (name) => localStorage.removeItem(name),
}));

export const useSettings = create<Settings & SettingsActions>()(
  persist(
    (set, get) => ({
      ...initial,
      set: (patch) => set(patch),
      addSlot: (s) => {
        const slot: Slot = { ...s, id: uid(), createdAt: Date.now(), status: 'unknown', uses: 0, failures: 0 };
        set({ slots: [...get().slots, slot] });
        return slot;
      },
      updateSlot: (id, patch) => set({ slots: get().slots.map((s) => (s.id === id ? { ...s, ...patch } : s)) }),
      removeSlot: (id) => set({ slots: get().slots.filter((s) => s.id !== id) }),
      addCustomProvider: (p) => {
        const def: ProviderDef = { ...p, id: `custom-${uid().slice(0, 8)}`, custom: true };
        set({ customProviders: [...get().customProviders, def] });
        return def;
      },
      removeCustomProvider: (id) =>
        set({
          customProviders: get().customProviders.filter((p) => p.id !== id),
          slots: get().slots.filter((s) => s.providerId !== id),
        }),
      recordVote: (winner, all) => {
        const lb = { ...get().leaderboard };
        for (const k of all) {
          const cur = lb[k] ?? { wins: 0, battles: 0 };
          lb[k] = { wins: cur.wins + (k === winner ? 1 : 0), battles: cur.battles + 1 };
        }
        set({ leaderboard: lb });
      },
    }),
    {
      name: 'jeea.settings',
      version: 1,
      storage,
      partialize: (s) => {
        // Functions are not stored; cooldown timers reset on reload.
        const { set: _a, addSlot: _b, updateSlot: _c, removeSlot: _d, addCustomProvider: _e, removeCustomProvider: _f, recordVote: _g, ...rest } = s;
        void _a; void _b; void _c; void _d; void _e; void _f; void _g;
        return rest;
      },
    },
  ),
);

export function allProviders(custom: ProviderDef[] = useSettings.getState().customProviders): ProviderDef[] {
  return [...BUILTIN_PROVIDERS, ...custom];
}

export function getProvider(id: string): ProviderDef | undefined {
  return allProviders().find((p) => p.id === id);
}

export function slotsFor(providerId: string, slots: Slot[] = useSettings.getState().slots) {
  return slots.filter((s) => s.providerId === providerId);
}

/** A provider is usable when it needs no key or has at least one enabled slot. */
export function isUsable(p: ProviderDef, slots: Slot[] = useSettings.getState().slots) {
  return p.access === 'keyless' || slots.some((s) => s.providerId === p.id && s.enabled);
}

export const modelKey = (r: ModelRef) => `${r.providerId}::${r.model}`;

export function modelLabel(r: ModelRef): string {
  const p = getProvider(r.providerId);
  return p?.modelLabels?.[r.model] ?? r.model.split('/').pop() ?? r.model;
}

/** Models a provider offers: live list from any slot, else the suggestions. */
export function modelsFor(p: ProviderDef, slots: Slot[] = useSettings.getState().slots): { list: string[]; live: boolean } {
  const live = new Set<string>();
  for (const s of slots) if (s.providerId === p.id && s.models?.length) s.models.forEach((m) => live.add(m));
  if (p.access === 'keyless' && keylessModels.length) keylessModels.forEach((m) => live.add(m));
  if (live.size) return { list: [...live], live: true };
  return { list: p.suggestedModels, live: false };
}

/** Live model list for the keyless provider (filled at runtime). */
export const keylessModels: string[] = [];

/**
 * Pick up to N distinct usable models, used to pre-fill Compare lanes and
 * Team roles. Your own keys come first (more models, higher limits): first
 * each provider's default model, then their other well-known models. The
 * shared free model is only added when fewer than two models are found,
 * because it allows one request at a time.
 */
export function usableModelRefs(limit = 6): ModelRef[] {
  const { slots } = useSettings.getState();
  const providers = allProviders().filter((p) => isUsable(p, slots));
  const keyed = providers.filter((p) => p.access !== 'keyless');
  const refs: ModelRef[] = [];
  const seen = new Set<string>();
  const push = (r: ModelRef) => {
    const k = modelKey(r);
    if (!seen.has(k) && refs.length < limit) {
      seen.add(k);
      refs.push(r);
    }
  };
  const lists = keyed.map((p) => {
    const { list, live } = modelsFor(p, slots);
    const first = list.includes(p.defaultModel) ? p.defaultModel : list[0];
    const known = p.suggestedModels.filter((m) => !live || list.includes(m));
    return { p, models: [...new Set([first, ...known].filter(Boolean))] };
  });
  for (let round = 0; round < 4 && refs.length < limit; round++) {
    for (const { p, models } of lists) if (models[round]) push({ providerId: p.id, model: models[round] });
  }
  if (refs.length < 2) {
    for (const p of providers.filter((x) => x.access === 'keyless')) push({ providerId: p.id, model: p.defaultModel });
  }
  if (!refs.length) refs.push(DEFAULT_MODEL);
  return refs;
}
