import { useRef, useState } from 'react';
import { Check, ChevronDown, FileText, Folder, FolderInput, FolderOpen, Layers, Plus, Settings2, Trash2, Upload, X } from 'lucide-react';
import { Popover } from './Popover';
import { useProjects, BUDGET_CHARS, type Budget } from '../lib/projects';
import { KNOWLEDGE_ACCEPT } from '../lib/extract';
import { useData } from '../lib/data';
import { useUI } from '../lib/ui';
import { useSettings } from '../lib/settings';

const fmtK = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

/** Sidebar: which project's conversations are shown; new ones go into it. */
export function ProjectBar() {
  const { projects, activeId, setActive, create, edit } = useProjects();
  const sessions = useData((s) => s.sessions);
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const active = projects.find((p) => p.id === activeId);
  const count = (id: string) => Object.values(sessions).filter((s) => s.projectId === id).length;
  return (
    <div className="project-bar">
      <button ref={ref} className={`project-switch${active ? ' in-project' : ''}`} onClick={() => setOpen((o) => !o)} aria-label="Choose project" title="Projects keep related chats together, with shared instructions and files">
        {active ? <FolderOpen size={15} /> : <Layers size={15} />}
        <span className="ps-name">{active ? active.name : 'All conversations'}</span>
        <ChevronDown size={14} />
      </button>
      {active && (
        <button className="icon-btn xs" title="Project instructions and files" aria-label="Project settings" onClick={() => edit(active.id)}>
          <Settings2 size={14} />
        </button>
      )}
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} width={270}>
        <div className="project-menu" role="menu">
          <button role="menuitem" className={`pm-item${!active ? ' on' : ''}`} onClick={() => { setActive(null); setOpen(false); }}>
            <Layers size={15} /> <span>All conversations</span> {!active && <Check size={14} />}
          </button>
          {projects.length > 0 && <div className="pm-head">Projects</div>}
          {projects.map((p) => (
            <button key={p.id} role="menuitem" className={`pm-item${p.id === activeId ? ' on' : ''}`} onClick={() => { setActive(p.id); setOpen(false); }}>
              <Folder size={15} /> <span className="pm-name">{p.name}</span> <span className="muted xs">{count(p.id)}</span> {p.id === activeId && <Check size={14} />}
            </button>
          ))}
          <button role="menuitem" className="pm-item pm-new" onClick={() => { create(); setOpen(false); }}>
            <Plus size={15} /> <span>New project</span>
          </button>
        </div>
      </Popover>
    </div>
  );
}

/** History item action: move a conversation into or out of a project. */
export function MoveToProject({ sessionId }: { sessionId: string }) {
  const projects = useProjects((s) => s.projects);
  const current = useData((s) => s.sessions[sessionId]?.projectId);
  const update = useData((s) => s.update);
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const move = (id: string | undefined) => {
    update(sessionId, (x) => {
      if (id) x.projectId = id;
      else delete x.projectId;
    }, false);
    setOpen(false);
  };
  if (!projects.length) return null;
  return (
    <>
      <button ref={ref} className="icon-btn xs" title="Move to project" aria-label="Move to project" onClick={() => setOpen((o) => !o)}>
        <FolderInput size={13} />
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} width={240} align="end">
        <div className="project-menu" role="menu">
          <div className="pm-head">Move to</div>
          {projects.map((p) => (
            <button key={p.id} role="menuitem" className={`pm-item${p.id === current ? ' on' : ''}`} onClick={() => move(p.id)}>
              <Folder size={15} /> <span className="pm-name">{p.name}</span> {p.id === current && <Check size={14} />}
            </button>
          ))}
          {current && (
            <button role="menuitem" className="pm-item" onClick={() => move(undefined)}>
              <X size={15} /> <span>Remove from project</span>
            </button>
          )}
        </div>
      </Popover>
    </>
  );
}

const BUDGET_LABEL: Record<Budget, string> = { small: 'Small', medium: 'Medium', large: 'Large' };

/** Project editor: name, private description, instructions, files, budget. */
export function ProjectModal() {
  const { projects, editingId, edit, update, remove, addFiles, removeFile } = useProjects();
  const toast = useUI((s) => s.toast);
  const confirm = useUI((s) => s.confirm);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const p = projects.find((x) => x.id === editingId);
  if (!p) return null;
  const total = p.files.reduce((n, f) => n + f.chars, 0);
  const add = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true);
    const r = await addFiles(p.id, Array.from(list));
    setBusy(false);
    if (r.added) toast(`Added ${r.added} file${r.added === 1 ? '' : 's'}`, 'success');
    for (const e of r.errors) toast(`Could not read ${e}`, 'error');
  };
  const close = () => edit(null);
  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal wide project-modal" role="dialog" aria-modal="true" aria-label="Project">
        <div className="modal-head">
          <h2><FolderOpen size={20} /> Project</h2>
          <button className="icon-btn" onClick={close} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="modal-body">
          <label className="field">
            <span className="field-label">Name</span>
            <input value={p.name} maxLength={80} onChange={(e) => update(p.id, { name: e.target.value })} aria-label="Project name" />
          </label>
          <label className="field">
            <span className="field-label">Description <span className="muted xs">(only for you; not sent to the AI)</span></span>
            <input value={p.description} maxLength={300} onChange={(e) => update(p.id, { description: e.target.value })} placeholder="e.g. Master's thesis on solar power in Bhutan" aria-label="Project description" />
          </label>
          <label className="field">
            <span className="field-label">Project instructions <span className="muted xs">(every chat in this project · {p.instructions.length}/8000)</span></span>
            <textarea rows={6} maxLength={8000} value={p.instructions} onChange={(e) => update(p.id, { instructions: e.target.value })} placeholder="e.g. This project is my thesis. Use my files first. Cite them by file and page. Use APA 7th. Write for examiners in engineering." aria-label="Project instructions" />
          </label>

          <div className="field">
            <span className="field-label">Project files <span className="muted xs">(shared by every chat in this project · text, code, PDF, Word)</span></span>
            <div
              className="kb-drop"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                void add(e.dataTransfer.files);
              }}
            >
              <Upload size={18} />
              <span>{busy ? 'Reading files…' : 'Drop files here or'}</span>
              <button className="btn ghost sm" disabled={busy} onClick={() => fileRef.current?.click()}>Choose files</button>
              <input ref={fileRef} type="file" multiple hidden accept={KNOWLEDGE_ACCEPT} onChange={(e) => { void add(e.target.files); e.target.value = ''; }} />
            </div>
            {p.files.length > 0 && (
              <ul className="kb-list">
                {p.files.map((f) => (
                  <li key={f.id}>
                    <FileText size={15} />
                    <span className="kb-name" title={f.name}>{f.name}</span>
                    <span className="muted xs">{f.kind.toUpperCase()}{f.pages ? ` · ${f.pages} pages` : ''} · ≈{fmtK(Math.ceil(f.chars / 4))} tokens</span>
                    <button className="icon-btn xs" aria-label={`Remove ${f.name}`} title="Remove" onClick={() => void removeFile(p.id, f.id)}><Trash2 size={13} /></button>
                  </li>
                ))}
              </ul>
            )}
            <p className="muted xs">Files are read in your browser and kept only here. Scanned PDFs without a text layer cannot be read.</p>
          </div>

          <div className="set-row wrap">
            <span>Space for files in each request</span>
            <div className="seg">
              {(Object.keys(BUDGET_CHARS) as Budget[]).map((b) => (
                <button key={b} className={p.budget === b ? 'active' : ''} onClick={() => update(p.id, { budget: b })}>
                  {BUDGET_LABEL[b]} · ≈{fmtK(BUDGET_CHARS[b] / 4)}
                </button>
              ))}
            </div>
          </div>
          <p className="muted xs">
            All files: ≈{fmtK(Math.ceil(total / 4))} tokens.{' '}
            {total > BUDGET_CHARS[p.budget]
              ? 'That is more than the space chosen, so each question gets only the passages most related to it, with file names and page numbers.'
              : 'They fit, so every question gets them in full.'}{' '}
            Bigger space gives better coverage, but small free models may refuse long requests.
          </p>

          <div className="row gap-8 between project-foot">
            <button
              className="btn danger sm"
              onClick={async () => {
                if (await confirm({ title: `Delete project "${p.name}"?`, body: 'Its instructions and files are deleted. Its conversations stay, outside any project.', confirmLabel: 'Delete project', danger: true })) await remove(p.id);
              }}
            >
              Delete project
            </button>
            <button className="btn primary sm" onClick={close}>Done</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Under the chat box: which instructions this conversation uses (click to edit). */
export function ContextBadges({ area, projectId }: { area: import('../lib/settings').Area; projectId?: string | null }) {
  const custom = useSettings((s) => s.custom);
  const rulesOn = useSettings((s) => s.answerRules?.enabled);
  const openModal = useUI((s) => s.openModal);
  const { projects, activeId, edit } = useProjects();
  const pid = projectId === undefined ? activeId : projectId;
  const p = projects.find((x) => x.id === pid);
  const customOn = custom?.enabled && custom.areas?.[area] !== false && !!(custom.about.trim() || custom.style.trim());
  if (!p && !customOn && !rulesOn) return null;
  return (
    <span className="ctx-badges">
      {p && (
        <button className="ctx-badge" onClick={() => edit(p.id)} title="Project instructions and files apply here">
          <Folder size={11} /> {p.name}
        </button>
      )}
      {customOn && (
        <button className="ctx-badge" onClick={() => openModal('settings')} title="Your custom instructions apply here">✎ Your instructions</button>
      )}
      {rulesOn && (
        <button className="ctx-badge" onClick={() => openModal('settings')} title="The site's answer rules apply here">📜 Answer rules</button>
      )}
    </span>
  );
}
