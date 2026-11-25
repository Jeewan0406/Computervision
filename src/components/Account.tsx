import { useEffect, useState, type FormEvent } from 'react';
import { Check, Crown, KeyRound, LogIn, LogOut, RefreshCw, ShieldCheck, Trash2, UserPlus, UserRound } from 'lucide-react';
import {
  adminList, adminSettings, adminUser, ownerSignIn, refreshMe, register, signIn, signOut, useAccount,
  type AccountUser, type AdminSettings, type SignupMode,
} from '../lib/account';
import { useUI } from '../lib/ui';
import { LogoMark, Wordmark } from './Logo';

const SIGNUP_TEXT: Record<SignupMode, string> = {
  open: 'Anyone can register and start at once.',
  approval: 'Anyone can ask to join; the site owner approves each account.',
  closed: 'Registration is closed. Existing accounts can still sign in.',
};

/** Sidebar button: opens Account. Shown only when this site's gateway has accounts. */
export function AccountButton() {
  const config = useAccount((s) => s.config);
  const user = useAccount((s) => s.user);
  const openModal = useUI((s) => s.openModal);
  const set = useAccount((s) => s.set);
  if (!config?.accounts) return null;
  const label = user ? `${user.role === 'owner' ? 'Owner' : user.name}: account` : 'Sign in or register';
  return (
    <button className={`icon-btn account-btn${user ? ' signed-in' : ''}`} title={label} aria-label={label} onClick={() => { set({ startTab: 'signin' }); openModal('account'); }}>
      {user?.role === 'owner' ? <Crown size={16} /> : user ? <span className="account-initial">{user.name.slice(0, 1).toUpperCase()}</span> : <UserRound size={17} />}
    </button>
  );
}

/** Full-screen sign-in when the owner allows only registered users. */
export function AccountGate() {
  return (
    <div className="account-gate">
      <div className="account-gate-card">
        <div className="account-gate-head">
          <LogoMark size={56} />
          <h1><Wordmark /></h1>
          <p className="muted">This site is for registered users. Sign in, or register to ask for access.</p>
        </div>
        <AccountPanel />
      </div>
    </div>
  );
}

/** Sign in / register / owner forms, or the signed-in account (and the owner's admin tools). */
export function AccountPanel() {
  const { user, config, usage, notice, set } = useAccount();
  useEffect(() => {
    void refreshMe();
  }, []);
  if (!config?.accounts) {
    return <p className="muted">This site has no accounts. Everything works without signing in.</p>;
  }
  if (!user) {
    return (
      <>
        {notice && <div className="account-msg warn" role="alert">{notice} <button className="link" onClick={() => set({ notice: null })}>OK</button></div>}
        <SignedOut />
      </>
    );
  }
  return (
    <div className="account-panel">
      <div className="account-me">
        <div className="account-avatar">{user.role === 'owner' ? <Crown size={20} /> : user.name.slice(0, 1).toUpperCase()}</div>
        <div className="account-me-text">
          <b>{user.role === 'owner' ? 'Site owner' : user.name}</b>
          <span className="muted sm">{user.role === 'owner' ? 'No limits. You manage who can use this site.' : user.email}</span>
        </div>
        <button className="btn ghost sm" onClick={signOut}><LogOut size={14} /> Sign out</button>
      </div>
      {usage && (
        <div className="account-usage">
          <div className="row between sm"><span>Today on this site's free models</span><b>{usage.today} / {usage.limit}</b></div>
          <div className="meter"><span style={{ width: `${Math.min(100, (usage.today / Math.max(1, usage.limit)) * 100)}%` }} /></div>
          <p className="field-help">Resets at midnight UTC. Your own API keys and the other free services are not counted.</p>
        </div>
      )}
      {user.role === 'owner' && <OwnerAdmin />}
    </div>
  );
}

type Tab = 'signin' | 'register' | 'owner';

function SignedOut() {
  const config = useAccount((s) => s.config);
  const signup = config?.signup ?? 'open';
  const [tab, setTab] = useState<Tab>(() => useAccount.getState().startTab ?? 'signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'warn'; text: string } | null>(null);

  const run = async (e: FormEvent, fn: () => Promise<void>) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (err) {
      setMsg({ kind: 'warn', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="account-panel">
      <div className="seg full" role="tablist">
        <button role="tab" aria-selected={tab === 'signin'} className={tab === 'signin' ? 'active' : ''} onClick={() => { setTab('signin'); setMsg(null); }}><LogIn size={14} /> Sign in</button>
        <button role="tab" aria-selected={tab === 'register'} className={tab === 'register' ? 'active' : ''} onClick={() => { setTab('register'); setMsg(null); }}><UserPlus size={14} /> Register</button>
        {config?.owner && (
          <button role="tab" aria-selected={tab === 'owner'} className={tab === 'owner' ? 'active' : ''} onClick={() => { setTab('owner'); setMsg(null); }}><KeyRound size={14} /> Owner</button>
        )}
      </div>

      {tab === 'signin' && (
        <form className="account-form" onSubmit={(e) => run(e, () => signIn(email, password))}>
          <label className="field"><span className="field-label">Email</span><input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label className="field"><span className="field-label">Password</span><input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          <button className="btn primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <p className="field-help">Forgot your password? Ask the site owner to set a new one for you.</p>
        </form>
      )}

      {tab === 'register' && (
        <form className="account-form" onSubmit={(e) => run(e, async () => {
          const r = await register(name, email, password);
          if (r.pending) {
            setMsg({ kind: 'ok', text: r.message ?? 'Thank you! The site owner will review your request.' });
            setTab('signin');
          }
        })}>
          <p className="field-help">{SIGNUP_TEXT[signup]}</p>
          {signup !== 'closed' && (
            <>
              <label className="field"><span className="field-label">Name</span><input autoComplete="name" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} /></label>
              <label className="field"><span className="field-label">Email</span><input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
              <label className="field"><span className="field-label">Password <span className="muted">at least 8 characters</span></span><input type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} /></label>
              <button className="btn primary" disabled={busy}>{busy ? 'Registering…' : signup === 'approval' ? 'Ask to join' : 'Register'}</button>
              <p className="field-help">Your name and email are kept by this site's owner to manage access. Your chats and API keys stay in your browser and are never sent to the owner.</p>
            </>
          )}
        </form>
      )}

      {tab === 'owner' && (
        <form className="account-form" onSubmit={(e) => run(e, () => ownerSignIn(key))}>
          <p className="field-help">For the site owner: the owner key is the secret <code>OWNER_KEY</code> you set on your JeeA Gateway in Cloudflare.</p>
          <label className="field"><span className="field-label">Owner key</span><input type="password" autoComplete="current-password" required value={key} onChange={(e) => setKey(e.target.value)} /></label>
          <button className="btn primary" disabled={busy}><ShieldCheck size={15} /> {busy ? 'Checking…' : 'Sign in as owner'}</button>
        </form>
      )}

      {msg && <div className={`account-msg ${msg.kind}`} role={msg.kind === 'warn' ? 'alert' : 'status'}>{msg.text}</div>}
    </div>
  );
}

function OwnerAdmin() {
  const toast = useUI((s) => s.toast);
  const confirm = useUI((s) => s.confirm);
  const [users, setUsers] = useState<AccountUser[] | null>(null);
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [limitDraft, setLimitDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await adminList();
      setUsers(r.users);
      setSettings(r.settings);
      setLimitDraft(String(r.settings.dailyLimit));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const save = async (patch: Partial<AdminSettings>) => {
    const before = settings;
    if (settings) setSettings({ ...settings, ...patch }); // show the change at once
    try {
      const s = await adminSettings(patch);
      setSettings(s);
      setLimitDraft(String(s.dailyLimit));
      toast('Saved', 'success');
    } catch (e) {
      setSettings(before);
      toast((e as Error).message, 'error');
    }
  };

  const act = async (u: AccountUser, action: Parameters<typeof adminUser>[1], extra?: Parameters<typeof adminUser>[2]) => {
    if (action === 'delete' && !(await confirm({ title: `Delete ${u.name}?`, body: `${u.email} will be removed and signed out. They can register again if sign-up is open.`, confirmLabel: 'Delete', danger: true }))) return;
    if (action === 'block' && !(await confirm({ title: `Block ${u.name}?`, body: 'They are signed out everywhere at once and cannot use this site\'s free models until you unblock them.', confirmLabel: 'Block', danger: true }))) return;
    try {
      await adminUser(u.id, action, extra);
      toast(action === 'password' ? `New password set for ${u.name}. Tell them in person or by a private message.` : 'Done', 'success');
      await load();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const pending = users?.filter((u) => u.status === 'pending').length ?? 0;

  return (
    <div className="owner-admin">
      <h3 className="row gap-8"><ShieldCheck size={16} /> Who can use this site</h3>
      {error && <div className="account-msg warn" role="alert">{error}</div>}
      {settings && (
        <div className="owner-settings">
          <label className="set-row">
            <span><b>Registration</b><br /><span className="muted sm">{SIGNUP_TEXT[settings.signup]}</span></span>
            <select aria-label="Registration" value={settings.signup} onChange={(e) => save({ signup: e.target.value as SignupMode })}>
              <option value="open">Open</option>
              <option value="approval">With my approval</option>
              <option value="closed">Closed</option>
            </select>
          </label>
          <label className="set-row">
            <span><b>Registered users only</b><br /><span className="muted sm">On: visitors must sign in, and the site's shared models refuse anyone not signed in. Off: everyone can use the site; signed-in users get their own daily allowance.</span></span>
            <input type="checkbox" className="switch" aria-label="Registered users only" checked={settings.requireAccount} onChange={(e) => save({ requireAccount: e.target.checked })} />
          </label>
          <form className="set-row" onSubmit={(e) => { e.preventDefault(); void save({ dailyLimit: Number(limitDraft) }); }}>
            <span><b>Daily limit per user</b><br /><span className="muted sm">Requests per person per day on the site's shared models (you have no limit). You can set a different limit for one person below.</span></span>
            <span className="row gap-8"><input aria-label="Daily limit per user" type="number" min={1} max={100000} value={limitDraft} onChange={(e) => setLimitDraft(e.target.value)} className="num-input" /><button className="btn ghost xs">Save</button></span>
          </form>
        </div>
      )}

      <div className="row between owner-users-head">
        <h3>Users {users ? `(${users.length}${pending ? `, ${pending} waiting` : ''})` : ''}</h3>
        <button className="icon-btn xs" title="Reload" aria-label="Reload users" onClick={load} disabled={busy}><RefreshCw size={13} className={busy ? 'spin' : ''} /></button>
      </div>
      {users && users.length === 0 && <p className="muted sm">No one has registered yet.</p>}
      {users && users.length > 0 && (
        <div className="owner-users">
          {users.map((u) => (
            <div key={u.id} className={`owner-user status-${u.status}`}>
              <div className="owner-user-main">
                <b>{u.name}</b> <span className={`badge badge-${u.status}`}>{u.status === 'active' ? 'Active' : u.status === 'pending' ? 'Waiting' : 'Blocked'}</span>
                <div className="muted sm">{u.email} · today {u.today ?? 0}/{u.dailyLimit ?? settings?.dailyLimit ?? '?'}{u.lastSeen ? ` · last used ${new Date(u.lastSeen).toLocaleDateString()}` : ''}</div>
              </div>
              <div className="owner-user-actions">
                {u.status === 'pending' && <button className="btn primary xs" onClick={() => act(u, 'approve')}><Check size={12} /> Approve</button>}
                {u.status === 'blocked' && <button className="btn ghost xs" onClick={() => act(u, 'unblock')}>Unblock</button>}
                {u.status === 'active' && <button className="btn ghost xs" onClick={() => act(u, 'block')}>Block</button>}
                <button className="btn ghost xs" onClick={() => {
                  const v = window.prompt(`Daily limit for ${u.name} (empty = site default of ${settings?.dailyLimit ?? 100})`, u.dailyLimit == null ? '' : String(u.dailyLimit));
                  if (v !== null) void act(u, 'limit', { dailyLimit: v.trim() === '' ? null : Number(v) });
                }}>Limit</button>
                <button className="btn ghost xs" onClick={() => {
                  const v = window.prompt(`New password for ${u.name} (at least 8 characters). They will be signed out.`);
                  if (v) void act(u, 'password', { password: v });
                }}>New password</button>
                <button className="icon-btn xs danger" title={`Delete ${u.name}`} aria-label={`Delete ${u.name}`} onClick={() => act(u, 'delete')}><Trash2 size={13} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** On the welcome screen: invite visitors to register, or greet the signed-in person. */
export function AccountInvite() {
  const config = useAccount((s) => s.config);
  const user = useAccount((s) => s.user);
  const usage = useAccount((s) => s.usage);
  const set = useAccount((s) => s.set);
  const openModal = useUI((s) => s.openModal);
  if (!config?.accounts) return null;
  const open = (tab: 'signin' | 'register') => {
    set({ startTab: tab });
    openModal('account');
  };
  if (user) {
    return (
      <button className="account-invite signed" onClick={() => open('signin')}>
        {user.role === 'owner' ? <Crown size={15} /> : <UserRound size={15} />}
        {user.role === 'owner' ? 'Signed in as the site owner' : `Signed in as ${user.name}${usage ? ` · ${usage.today}/${usage.limit} today` : ''}`}
      </button>
    );
  }
  return (
    <div className="account-invite">
      {config.signup !== 'closed' && (
        <button className="btn primary" onClick={() => open('register')}><UserPlus size={16} /> {config.signup === 'approval' ? 'Ask for a free account' : 'Create a free account'}</button>
      )}
      <button className="btn ghost" onClick={() => open('signin')}><LogIn size={16} /> Sign in</button>
    </div>
  );
}
