import { useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Activity, Bot, Code2, Columns3, Folder, ImagePlus, KeyRound, Menu, MessageSquare, Moon, Pencil, Pin, PinOff, Plus, Search,
  Settings as SettingsIcon, SlidersHorizontal, Sparkles, Sun, Monitor, Trash2, Users, X,
} from 'lucide-react';
import type { GenParams, SessionKind, View } from '../lib/types';
import { useUI } from '../lib/ui';
import { useData, sessionsOf } from '../lib/data';
import { useSettings, isUsable, allProviders } from '../lib/settings';
import { useLogs } from '../lib/logs';
import { useProjects } from '../lib/projects';
import { MoveToProject, ProjectBar } from './Projects';
import { dayBucket } from '../lib/utils';
import { stopJobs } from '../lib/runner';
import { LogoMark, Wordmark, GithubIcon } from './Logo';
import { Popover } from './Popover';

// One place for the repository address (src/lib/repo.ts).
export { REPO_URL } from '../lib/repo';
import { REPO_URL } from '../lib/repo';

const NAV: { view: View; label: string; icon: typeof MessageSquare; hint: string }[] = [
  { view: 'chat', label: 'Chat', icon: MessageSquare, hint: 'Standard chat' },
  { view: 'agent', label: 'Agent', icon: Bot, hint: 'Goals, tools and 24/7 agents' },
  { view: 'compare', label: 'Compare', icon: Columns3, hint: 'Many models, one prompt' },
  { view: 'team', label: 'Team', icon: Users, hint: 'Different models, different roles' },
  { view: 'code', label: 'CodeFrame', icon: Code2, hint: 'Build and run apps live' },
  { view: 'images', label: 'Images', icon: ImagePlus, hint: 'Make pictures from a description' },
  { view: 'keys', label: 'API Slots', icon: KeyRound, hint: 'Your keys and providers' },
  { view: 'logs', label: 'Logs', icon: Activity, hint: 'Every request, measured' },
];

const KIND_LABEL: Record<SessionKind, string> = { chat: 'chat', agent: 'agent task', compare: 'comparison', team: 'team run', code: 'project' };

export function Sidebar() {
  const view = useUI((s) => s.view);
  const setView = useUI((s) => s.setView);
  const navOpen = useUI((s) => s.navOpen);
  const setNav = useUI((s) => s.setNav);
  const openModal = useUI((s) => s.openModal);
  const confirm = useUI((s) => s.confirm);
  const sessions = useData((s) => s.sessions);
  const active = useData((s) => s.active);
  const create = useData((s) => s.create);
  const setActive = useData((s) => s.setActive);
  const remove = useData((s) => s.remove);
  const update = useData((s) => s.update);
  const slots = useSettings((s) => s.slots);
  const theme = useSettings((s) => s.theme);
  const setSettings = useSettings((s) => s.set);
  const errors = useLogs((s) => s.entries.filter((e) => e.level === 'error' && Date.now() - e.ts < 86_400_000).length);
  const projectId = useProjects((s) => s.activeId);
  const projects = useProjects((s) => s.projects);
  const [q, setQ] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);

  const kind: SessionKind = view === 'compare' || view === 'team' || view === 'code' || view === 'agent' ? view : 'chat';
  const list = useMemo(() => {
    const all = sessionsOf(kind, sessions).filter((s) => !projectId || s.projectId === projectId);
    const ql = q.trim().toLowerCase();
    return ql ? all.filter((s) => s.title.toLowerCase().includes(ql)) : all;
  }, [kind, sessions, q, projectId]);

  const groups = useMemo(() => {
    const g = new Map<string, typeof list>();
    for (const s of list) {
      const key = s.pinned ? 'Pinned' : dayBucket(s.updatedAt);
      g.set(key, [...(g.get(key) ?? []), s]);
    }
    return [...g.entries()];
  }, [list]);

  const keyed = slots.filter((s) => s.enabled).length;
  const providersReady = allProviders().filter((p) => p.access !== 'keyless' && p.kind !== 'browser' && isUsable(p, slots)).length;

  const newSession = () => {
    if (view === 'keys' || view === 'logs' || view === 'images') setView('chat');
    create(kind);
    setNav(false);
  };

  const cycleTheme = () => setSettings({ theme: theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark' });
  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;

  return (
    <>
      <div className={`scrim${navOpen ? ' show' : ''}`} onClick={() => setNav(false)} />
      <aside className={`sidebar${navOpen ? ' open' : ''}`}>
        <div className="brand">
          <LogoMark size={34} />
          <div className="brand-text">
            <Wordmark />
            <span className="brand-sub">Many AIs. One place.</span>
          </div>
          <button className="icon-btn only-mobile" onClick={() => setNav(false)} aria-label="Close menu"><X size={18} /></button>
        </div>

        {/* Everything between the logo and the bottom bar scrolls on short
            screens, so the bottom bar (Settings, What's new, theme) always shows. */}
        <div className="sidebar-middle">
        <ProjectBar />

        <button className="btn primary block new-btn" onClick={newSession}>
          <Plus size={16} /> New {KIND_LABEL[kind]}
        </button>

        <nav className="nav">
          {NAV.map((n) => (
            <button key={n.view} className={`nav-item${view === n.view ? ' active' : ''}`} onClick={() => setView(n.view)} title={n.hint}>
              <n.icon size={17} />
              <span>{n.label}</span>
              {n.view === 'keys' && keyed > 0 && <span className="nav-badge">{keyed}</span>}
              {n.view === 'logs' && errors > 0 && <span className="nav-badge danger">{errors}</span>}
            </button>
          ))}
        </nav>

        {view !== 'keys' && view !== 'logs' && view !== 'images' && (
          <div className="history">
            <div className="history-search">
              <Search size={14} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${KIND_LABEL[kind]}s`} />
            </div>
            <div className="history-list">
              {groups.length === 0 && <div className="history-empty">No {KIND_LABEL[kind]}s yet.</div>}
              {groups.map(([label, items]) => (
                <div key={label} className="history-group">
                  <div className="history-label">{label}</div>
                  {items.map((s) => (
                    <div key={s.id} className={`history-item${active[kind] === s.id ? ' active' : ''}`}>
                      {renaming === s.id ? (
                        <input
                          className="rename-input"
                          autoFocus
                          defaultValue={s.title}
                          onBlur={(e) => {
                            update(s.id, (x) => void (x.title = e.target.value.trim() || x.title), false);
                            setRenaming(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                            if (e.key === 'Escape') setRenaming(null);
                          }}
                        />
                      ) : (
                        <button className="history-title" onClick={() => { setActive(kind, s.id); setNav(false); }} title={s.projectId && !projectId ? `${s.title} · project: ${projects.find((p) => p.id === s.projectId)?.name ?? ''}` : s.title}>
                          {s.projectId && !projectId && <Folder size={12} className="history-proj" />}
                          {s.title}
                        </button>
                      )}
                      <span className="history-actions">
                        <button className="icon-btn xs" title={s.pinned ? 'Unpin' : 'Pin'} onClick={() => update(s.id, (x) => void (x.pinned = !x.pinned), false)}>
                          {s.pinned ? <PinOff size={13} /> : <Pin size={13} />}
                        </button>
                        <button className="icon-btn xs" title="Rename" onClick={() => setRenaming(s.id)}><Pencil size={13} /></button>
                        <MoveToProject sessionId={s.id} />
                        <button
                          className="icon-btn xs"
                          title="Delete"
                          onClick={async () => {
                            if (await confirm({ title: `Delete "${s.title}"?`, body: 'This cannot be undone.', confirmLabel: 'Delete', danger: true })) {
                              stopJobs(s.id);
                              remove(s.id);
                            }
                          }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
        </div>

        <div className="sidebar-foot">
          <button className="status-pill" onClick={() => setView('keys')} title="Open API Slots">
            <span className={`pulse-dot${providersReady ? '' : ' green'}`} />
            {providersReady ? `${providersReady} provider${providersReady > 1 ? 's' : ''} · ${keyed} key${keyed === 1 ? '' : 's'}` : 'Free model ready · add keys for more'}
          </button>
          <div className="foot-row">
            <button className="icon-btn" title="Settings" onClick={() => openModal('settings')}><SettingsIcon size={17} /></button>
            <button className="icon-btn" title="What's new" onClick={() => openModal('whatsnew')}><Sparkles size={17} /></button>
            <button className="icon-btn" title={`Theme: ${theme}`} onClick={cycleTheme}><ThemeIcon size={17} /></button>
            <a className="icon-btn" title="Source code on GitHub" href={REPO_URL} target="_blank" rel="noreferrer"><GithubIcon size={16} /></a>
          </div>
        </div>
      </aside>
    </>
  );
}

export function TopBar({ children, right }: { children?: ReactNode; right?: ReactNode }) {
  const setNav = useUI((s) => s.setNav);
  const openModal = useUI((s) => s.openModal);
  return (
    <header className="topbar">
      <button className="icon-btn only-mobile" onClick={() => setNav(true)} aria-label="Open menu"><Menu size={19} /></button>
      <span className="only-mobile topbar-logo"><LogoMark size={24} /></span>
      <div className="topbar-main">{children}</div>
      <div className="topbar-right">
        {right}
        <button className="icon-btn topbar-settings" title="Settings" aria-label="Open settings" onClick={() => openModal('settings')}><SettingsIcon size={17} /></button>
      </div>
    </header>
  );
}

/** System prompt + sampling settings, shared by Chat and Compare. */
export function ParamsButton({
  system,
  params,
  onChange,
}: {
  system: string;
  params: GenParams;
  onChange: (system: string, params: GenParams) => void;
}) {
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const active = !!system || params.temperature != null || !!params.maxTokens || params.topP != null;
  return (
    <>
      <button ref={btn} className={`icon-btn${active ? ' dot' : ''}`} title="System prompt and settings" onClick={() => setOpen((o) => !o)}>
        <SlidersHorizontal size={17} />
      </button>
      <Popover anchor={btn} open={open} onClose={() => setOpen(false)} width={360} align="end">
        <div className="params">
          <label className="field">
            <span className="field-label">System prompt</span>
            <textarea
              rows={4}
              value={system}
              placeholder="e.g. You are a friendly tutor. Explain step by step in simple English."
              onChange={(e) => onChange(e.target.value, params)}
            />
          </label>
          <label className="field">
            <span className="field-label">
              Temperature <span className="muted">{params.temperature == null ? 'model default' : params.temperature.toFixed(2)}</span>
            </span>
            <div className="row gap-8">
              <input
                type="range" min={0} max={2} step={0.05}
                value={params.temperature ?? 0.7}
                onChange={(e) => onChange(system, { ...params, temperature: Number(e.target.value) })}
              />
              <button className="btn ghost xs" onClick={() => onChange(system, { ...params, temperature: undefined })}>Default</button>
            </div>
            <span className="field-help">Lower = focused and repeatable. Higher = more creative. Some models (e.g. Claude, reasoning models) ignore or reject it, so JeeA! only sends it when you set it.</span>
          </label>
          <label className="field">
            <span className="field-label">Max output tokens <span className="muted">{params.maxTokens ? '' : 'model default'}</span></span>
            <input
              type="number" min={1} max={200000} placeholder="Model default"
              value={params.maxTokens ?? ''}
              onChange={(e) => onChange(system, { ...params, maxTokens: e.target.value ? Math.max(1, Number(e.target.value)) : undefined })}
            />
          </label>
        </div>
      </Popover>
    </>
  );
}
