// Projects: a name, a private description, instructions and knowledge files,
// shared by every conversation in the project (Chat, Compare, Team, Agent,
// CodeFrame). Stored only in this browser (IndexedDB). File text is kept
// apart from the project list so the list stays small.
import { create } from 'zustand';
import { del as idbDel, get as idbGet, set as idbSet } from 'idb-keyval';
import { uid } from './utils';
import { extractText } from './extract';
import { setProjectSource, useData } from './data';
import type { KnowledgeFile } from './instructions';

export type Budget = 'small' | 'medium' | 'large';
/** Characters of project files sent with each request (about 4 characters per token). */
export const BUDGET_CHARS: Record<Budget, number> = { small: 12_000, medium: 32_000, large: 80_000 };

export interface ProjectFile {
  id: string;
  name: string;
  kind: 'text' | 'pdf' | 'docx' | 'pptx' | 'xlsx';
  size: number;
  chars: number;
  pages?: number;
  addedAt: number;
}

export interface Project {
  id: string;
  name: string;
  /** For the user only; not sent to the models (as in Claude). */
  description: string;
  instructions: string;
  budget: Budget;
  files: ProjectFile[];
  createdAt: number;
  updatedAt: number;
}

const LIST_KEY = 'jeea.projects';
const textKey = (fileId: string) => `jeea.pk.${fileId}`;
const cache = new Map<string, { text: string; pages?: number[] }>();

interface ProjectsState {
  projects: Project[];
  /** Project shown in the sidebar; new conversations go into it. */
  activeId: string | null;
  /** Project open in the editor. */
  editingId: string | null;
  loaded: boolean;
  load: () => Promise<void>;
  create: (name?: string) => string;
  update: (id: string, patch: Partial<Omit<Project, 'id' | 'files'>>) => void;
  remove: (id: string) => Promise<void>;
  setActive: (id: string | null) => void;
  edit: (id: string | null) => void;
  addFiles: (id: string, files: File[]) => Promise<{ added: number; errors: string[] }>;
  removeFile: (id: string, fileId: string) => Promise<void>;
}

const save = (s: Pick<ProjectsState, 'projects' | 'activeId'>) => void idbSet(LIST_KEY, { projects: s.projects, activeId: s.activeId }).catch(() => undefined);

export const useProjects = create<ProjectsState>()((set, get) => ({
  projects: [],
  activeId: null,
  editingId: null,
  loaded: false,
  load: async () => {
    if (get().loaded) return;
    const saved = (await idbGet(LIST_KEY).catch(() => undefined)) as { projects?: Project[]; activeId?: string | null } | undefined;
    const projects = saved?.projects ?? [];
    set({ projects, activeId: projects.some((p) => p.id === saved?.activeId) ? saved!.activeId! : null, loaded: true });
  },
  create: (name = 'New project') => {
    const t = Date.now();
    const p: Project = { id: uid(), name, description: '', instructions: '', budget: 'medium', files: [], createdAt: t, updatedAt: t };
    set({ projects: [p, ...get().projects], activeId: p.id, editingId: p.id });
    save(get());
    return p.id;
  },
  update: (id, patch) => {
    set({ projects: get().projects.map((p) => (p.id === id ? { ...p, ...patch, updatedAt: Date.now() } : p)) });
    save(get());
  },
  remove: async (id) => {
    const p = get().projects.find((x) => x.id === id);
    for (const f of p?.files ?? []) {
      cache.delete(f.id);
      await idbDel(textKey(f.id)).catch(() => undefined);
    }
    // Conversations stay; they just leave the project.
    const data = useData.getState();
    for (const s of Object.values(data.sessions)) if (s.projectId === id) data.update(s.id, (x) => void delete x.projectId, false);
    set({ projects: get().projects.filter((x) => x.id !== id), activeId: get().activeId === id ? null : get().activeId, editingId: null });
    save(get());
  },
  setActive: (id) => {
    set({ activeId: id });
    save(get());
  },
  edit: (id) => set({ editingId: id }),
  addFiles: async (id, files) => {
    const errors: string[] = [];
    const added: ProjectFile[] = [];
    for (const file of files) {
      try {
        const x = await extractText(file);
        if (!x.text.trim()) throw new Error('no text found');
        const f: ProjectFile = { id: uid(), name: file.name, kind: x.kind, size: file.size, chars: x.text.length, pages: x.pages?.length, addedAt: Date.now() };
        await idbSet(textKey(f.id), { text: x.text, pages: x.pages });
        cache.set(f.id, { text: x.text, pages: x.pages });
        added.push(f);
      } catch (e) {
        errors.push(`${file.name}: ${(e as Error).message}`);
      }
    }
    if (added.length) {
      set({ projects: get().projects.map((p) => (p.id === id ? { ...p, files: [...p.files, ...added], updatedAt: Date.now() } : p)) });
      save(get());
    }
    return { added: added.length, errors };
  },
  removeFile: async (id, fileId) => {
    cache.delete(fileId);
    await idbDel(textKey(fileId)).catch(() => undefined);
    set({ projects: get().projects.map((p) => (p.id === id ? { ...p, files: p.files.filter((f) => f.id !== fileId), updatedAt: Date.now() } : p)) });
    save(get());
  },
}));

// New conversations go into the project shown in the sidebar.
setProjectSource(() => useProjects.getState().activeId ?? undefined);

export const getProject = (id: string | undefined) => (id ? useProjects.getState().projects.find((p) => p.id === id) : undefined);

/** The text of a project's files (from memory, else IndexedDB). */
export async function projectFiles(p: Project): Promise<KnowledgeFile[]> {
  const out: KnowledgeFile[] = [];
  for (const f of p.files) {
    let t = cache.get(f.id);
    if (!t) {
      t = ((await idbGet(textKey(f.id)).catch(() => undefined)) as { text: string; pages?: number[] } | undefined) ?? undefined;
      if (t) cache.set(f.id, t);
    }
    if (t?.text) out.push({ name: f.name, text: t.text, pages: t.pages });
  }
  return out;
}
