// Accounts on this site's JeeA Gateway: register, sign in, the owner's sign-in
// and the owner's admin tools. The gateway (a Cloudflare Worker with a D1
// database) decides who may use the site's shared models; this file only
// keeps the sign-in token in this browser and calls the gateway.
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { gatewayInfo } from './settings';

export type SignupMode = 'open' | 'approval' | 'closed';

export interface AuthConfig {
  accounts: boolean;
  signup?: SignupMode;
  /** Only signed-in people may use the site's shared models (and the app shows a sign-in screen). */
  requireAccount?: boolean;
  dailyLimit?: number;
  /** An owner key is set on the gateway. */
  owner?: boolean;
}

export interface AccountUser {
  id: string;
  name: string;
  email: string;
  status: 'active' | 'pending' | 'blocked';
  role: 'user' | 'owner';
  dailyLimit?: number | null;
  createdAt?: number;
  lastSeen?: number | null;
  /** Requests today (admin list only). */
  today?: number;
}

export interface Usage {
  today: number;
  limit: number;
}

interface AccountState {
  token: string | null;
  user: AccountUser | null;
  usage: Usage | null;
  config: AuthConfig | null;
  /** Shown once after a sign-in ends (expired, blocked...). */
  notice: string | null;
  set: (patch: Partial<Omit<AccountState, 'set'>>) => void;
}

export const useAccount = create<AccountState>()(
  persist(
    (set) => ({ token: null, user: null, usage: null, config: null, notice: null, set: (patch) => set(patch) }),
    {
      name: 'jeea.account',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // The sign-in and the last known gateway settings (so the sign-in screen shows at once); both are refreshed on each visit.
      partialize: (s) => ({ token: s.token, user: s.user, config: s.config }),
    },
  ),
);

/** The sign-in token for the site's gateway, if signed in. */
export const gatewayToken = () => useAccount.getState().token;
export const authHeaders = (): Record<string, string> => {
  const t = gatewayToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
};
export const isOwner = () => useAccount.getState().user?.role === 'owner';

class AccountError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function gatewayBase(): string {
  const gw = gatewayInfo();
  if (!gw) throw new AccountError('This site has no JeeA Gateway, so there are no accounts.', 0);
  return gw.baseUrl.replace(/\/v1$/, '');
}

async function api<T>(path: string, opts: { method?: 'GET' | 'POST'; body?: unknown; auth?: boolean } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${gatewayBase()}${path}`, {
      method: opts.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', ...(opts.auth ? authHeaders() : {}) },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch {
    throw new AccountError('The site gateway could not be reached. Check your connection and try again.', 0);
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    const msg = (data as { error?: { message?: string } } | null)?.error?.message ?? `The gateway answered ${res.status}.`;
    throw new AccountError(msg, res.status);
  }
  return data as T;
}

/** Read the gateway's account settings and refresh the signed-in user. Never throws. */
export async function loadAccount(): Promise<void> {
  const st = useAccount.getState();
  if (!gatewayInfo()) {
    st.set({ config: { accounts: false } });
    return;
  }
  try {
    st.set({ config: await api<AuthConfig>('/v1/auth/config') });
  } catch {
    st.set({ config: { accounts: false } });
    return;
  }
  if (st.token) await refreshMe();
}

/** Refresh who is signed in and today's usage; signs out if the gateway no longer accepts the sign-in. */
export async function refreshMe(): Promise<void> {
  const st = useAccount.getState();
  if (!st.token) return;
  try {
    const r = await api<{ user: AccountUser; usage: Usage | null }>('/v1/auth/me', { auth: true });
    st.set({ user: r.user, usage: r.usage });
  } catch (e) {
    if (e instanceof AccountError && (e.status === 401 || e.status === 403)) st.set({ token: null, user: null, usage: null, notice: e.message });
  }
}

export async function register(name: string, email: string, password: string): Promise<{ pending: boolean; message?: string }> {
  const r = await api<{ token?: string; user?: AccountUser; pending?: boolean; message?: string }>('/v1/auth/register', { method: 'POST', body: { name, email, password } });
  if (r.token && r.user) {
    useAccount.getState().set({ token: r.token, user: r.user, notice: null });
    await refreshMe();
    return { pending: false };
  }
  return { pending: true, message: r.message };
}

export async function signIn(email: string, password: string): Promise<void> {
  const r = await api<{ token: string; user: AccountUser }>('/v1/auth/login', { method: 'POST', body: { email, password } });
  useAccount.getState().set({ token: r.token, user: r.user, notice: null });
  await refreshMe();
}

export async function ownerSignIn(key: string): Promise<void> {
  const r = await api<{ token: string; user: AccountUser }>('/v1/auth/owner', { method: 'POST', body: { key } });
  useAccount.getState().set({ token: r.token, user: r.user, usage: null, notice: null });
}

export function signOut() {
  useAccount.getState().set({ token: null, user: null, usage: null });
}

// ---- owner tools

export interface AdminSettings {
  signup: SignupMode;
  requireAccount: boolean;
  dailyLimit: number;
}

export const adminList = () => api<{ users: AccountUser[]; settings: AdminSettings }>('/v1/admin/users', { auth: true });

export async function adminSettings(patch: Partial<AdminSettings>): Promise<AdminSettings> {
  const r = await api<{ settings: AdminSettings }>('/v1/admin/settings', { method: 'POST', auth: true, body: patch });
  const st = useAccount.getState();
  st.set({ config: { ...(st.config ?? { accounts: true }), ...r.settings } });
  return r.settings;
}

export type AdminAction = 'approve' | 'block' | 'unblock' | 'delete' | 'limit' | 'password';
export const adminUser = (id: string, action: AdminAction, extra: { dailyLimit?: number | null; password?: string } = {}) =>
  api<{ user?: AccountUser; deleted?: boolean }>(`/v1/admin/users/${encodeURIComponent(id)}`, { method: 'POST', auth: true, body: { action, ...extra } });
