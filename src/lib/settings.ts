import { AUTO_REF } from './router';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { ModelRef, ProviderDef, Slot } from './types';
import { BUILTIN_PROVIDERS, GATEWAY_ID, KEYLESS_ID } from './providers';
import { prettyModel, isFreeModel, routeLabel } from './models';
import { uid } from './utils';
import type { WebMode } from './web';
import type { ThinkLevel } from './thinking';

export type Theme = 'system' | 'dark' | 'light';
export type Accent = 'druk' | 'violet' | 'blue' | 'emerald' | 'rose' | 'amber';

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
  /** enabled: try the models in `chain` when the chosen one fails; auto: then also switch to other good models by itself. */
  fallback: { enabled: boolean; chain: ModelRef[]; auto?: boolean };
  /** Auto may choose models that cost money on your own keys. */
  autoUsePaid: boolean;
  maxRetries: number;
  corsProxy: string;
  /** model key -> wins / battles from Compare votes */
  leaderboard: Record<string, { wins: number; battles: number }>;
  seenVersion: string;
  /** "owner/repo" that runs the 24/7 GitHub agents (auto-detected on github.io). */
  agentRepo: string;
  /** Web search: 'on' every question (default), 'auto' decides per message, 'off' never. */
  webMode: WebMode;
  /** Use established news organisations (BBC, NPR, DW...) for recent events, besides official and scholarly sources. */
  trustedNews: boolean;
  /** How hard models think before answering: low, medium (default), high, xhigh, max. */
  thinking: ThinkLevel;
  /** The user's own custom instructions, sent to every model in the chosen areas. */
  custom: CustomInstructions;
  /** The site owner's answer rules, sent to every model. `text: null` = built-in default. */
  answerRules: { enabled: boolean; text: string | null };
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

export type Area = 'chat' | 'compare' | 'team' | 'agent' | 'code';
export interface CustomInstructions {
  enabled: boolean;
  /** The user's instructions, one box (up to CUSTOM_MAX characters). */
  text: string;
  /** Where they apply. */
  areas: Record<Area, boolean>;
}
/** Characters allowed in custom instructions. */
export const CUSTOM_MAX = 50_000;
export const DEFAULT_CUSTOM: CustomInstructions = { enabled: true, text: '', areas: { chat: true, compare: true, team: true, agent: true, code: true } };

export const DEFAULT_MODEL: ModelRef = { providerId: KEYLESS_ID, model: 'openai' };

const initial: Settings = {
  theme: 'dark',
  accent: 'druk',
  sendOnEnter: true,
  showReasoning: true,
  keyStorage: 'local',
  slots: [],
  customProviders: [],
  // New visitors start on Auto; saved choices of existing users are kept.
  defaultModel: AUTO_REF,
  fallback: { enabled: true, chain: [DEFAULT_MODEL], auto: true },
  autoUsePaid: true,
  maxRetries: 2,
  corsProxy: '',
  leaderboard: {},
  seenVersion: '',
  agentRepo: '',
  webMode: 'on',
  trustedNews: true,
  thinking: 'medium',
  custom: DEFAULT_CUSTOM,
  answerRules: { enabled: true, text: null },
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
      version: 5,
      // v2: the Bhutan-inspired "druk" palette replaces violet as the default look.
      // v3: web search runs for every question (the old default was "auto").
      // v4: custom instructions in one box.
      // v5: repository renamed to JeeAI-by-Jeewan.
      migrate: (persisted, version) => {
        const st = (persisted ?? {}) as Partial<Settings>;
        if (version < 2 && (!st.accent || st.accent === 'violet')) st.accent = 'druk';
        if (version < 3 && (!st.webMode || st.webMode === 'auto')) st.webMode = 'on';
        // v4: custom instructions became one box; keep any text from the old two boxes.
        // v5: the repository was renamed; fix the 24/7 agents setting if it names the old one.
        if (version < 5 && st.agentRepo && /^jeewan0406\/computervision$/i.test(st.agentRepo.trim())) st.agentRepo = 'Jeewan0406/JeeAI-by-Jeewan';
        if (version < 4 && st.custom) {
          const old = st.custom as Partial<CustomInstructions> & { about?: string; style?: string };
          const text = old.text ?? [old.about, old.style].map((x) => (x ?? '').trim()).filter(Boolean).join('\n\n');
          st.custom = { enabled: old.enabled !== false, text, areas: { ...DEFAULT_CUSTOM.areas, ...(old.areas ?? {}) } };
        }
        return st as Settings & SettingsActions;
      },
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

/** The site owner's JeeA Gateway (set in public/jeea.config.json). */
let gatewayProvider: ProviderDef | null = null;
export function setGateway(url: string | null, name?: string) {
  const base = (url ?? '').trim().replace(/\/+$/, '');
  if (!/^https:\/\//.test(base)) {
    gatewayProvider = null;
    return;
  }
  gatewayProvider = {
    id: GATEWAY_ID,
    name: name || 'JeeA Free+ (gateway)',
    kind: 'openai',
    baseUrl: `${base}/v1`,
    access: 'keyless',
    color: '#76b900',
    tagline: 'Free models shared by this site (NVIDIA and others). No key needed.',
    note: 'Shared by everyone who uses this site, so the providers\' free limits are shared too. If it is busy, try again in a minute or add your own key.',
    suggestedModels: ['nvidia:meta/llama-3.3-70b-instruct'],
    defaultModel: 'nvidia:meta/llama-3.3-70b-instruct',
  };
}
export const gatewayInfo = () => gatewayProvider;

export function allProviders(custom: ProviderDef[] = useSettings.getState().customProviders): ProviderDef[] {
  const builtin = gatewayProvider ? [BUILTIN_PROVIDERS[0], gatewayProvider, ...BUILTIN_PROVIDERS.slice(1)] : BUILTIN_PROVIDERS;
  return [...builtin, ...custom];
}

export function getProvider(id: string): ProviderDef | undefined {
  return allProviders().find((p) => p.id === id);
}

export function slotsFor(providerId: string, slots: Slot[] = useSettings.getState().slots) {
  return slots.filter((s) => s.providerId === providerId);
}

/** No key needed: free shared services and models that run in the browser.
 * (Ollama and LM Studio are "local" too, but need their address added first.) */
export const noKey = (p: ProviderDef) => p.access === 'keyless' || p.kind === 'browser';

/** A provider is usable when it needs no key or has at least one enabled slot. */
export function isUsable(p: ProviderDef, slots: Slot[] = useSettings.getState().slots) {
  return noKey(p) || slots.some((s) => s.providerId === p.id && s.enabled);
}

export const modelKey = (r: ModelRef) => `${r.providerId}::${r.model}`;

/** Friendly name, e.g. "meta/llama-3.3-70b-instruct" -> "Llama 3.3 70B". */
export function modelLabel(r: ModelRef): string {
  return displayName(getProvider(r.providerId), r.model);
}

export function displayName(p: ProviderDef | undefined, model: string): string {
  if (p?.modelLabels?.[model]) return p.modelLabels[model];
  const via = p?.id === GATEWAY_ID ? routeLabel(model) : null;
  return via ? `${prettyModel(model)} · ${via}` : prettyModel(model);
}

export function isFree(r: ModelRef): boolean {
  return isFreeModel(getProvider(r.providerId), r.model);
}

/** Models a provider offers: live list from any slot, else the suggestions. */
export function modelsFor(p: ProviderDef, slots: Slot[] = useSettings.getState().slots): { list: string[]; live: boolean } {
  const live = new Set<string>();
  for (const s of slots) if (s.providerId === p.id && s.models?.length) s.models.forEach((m) => live.add(m));
  if (noKey(p)) (liveModels.get(p.id) ?? []).forEach((m) => live.add(m));
  if (live.size) return { list: [...live], live: true };
  return { list: p.suggestedModels, live: false };
}

/** Live model lists for keyless providers (filled at runtime). */
export const liveModels = new Map<string, string[]>();

/** Bumped when runtime provider data changes (gateway config, live lists). */
export const useRuntime = create<{ v: number; bump: () => void }>()((set, get) => ({ v: 0, bump: () => set({ v: get().v + 1 }) }));
export function setLiveModels(providerId: string, ids: string[]) {
  liveModels.set(providerId, ids);
  useRuntime.getState().bump();
}

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
  const keyed = providers.filter((p) => !noKey(p));
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
    // Free no-key models; Puter needs a sign-in, so it is only a last resort.
    const keyless = providers.filter((x) => x.access === 'keyless');
    for (const p of keyless.filter((x) => x.kind !== 'puter' && x.kind !== 'auto')) push({ providerId: p.id, model: p.defaultModel });
    if (!refs.length) for (const p of keyless.filter((x) => x.kind !== 'auto')) push({ providerId: p.id, model: p.defaultModel });
  }
  if (!refs.length) refs.push(DEFAULT_MODEL);
  return refs;
}
