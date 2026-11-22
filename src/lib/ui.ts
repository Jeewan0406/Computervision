import { create } from 'zustand';
import type { View } from './types';

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error';
  text: string;
}

interface ConfirmReq {
  title: string;
  body?: string;
  confirmLabel?: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

interface UIState {
  view: View;
  navOpen: boolean;
  modal: null | 'settings' | 'whatsnew' | 'leaderboard';
  toasts: Toast[];
  confirmReq: ConfirmReq | null;
  /** Provider id to pre-select in the "Add slot" form. */
  addSlotFor: string | null;
  setView: (v: View) => void;
  setNav: (open: boolean) => void;
  openModal: (m: UIState['modal']) => void;
  toast: (text: string, kind?: Toast['kind']) => void;
  dismiss: (id: number) => void;
  confirm: (req: Omit<ConfirmReq, 'resolve'>) => Promise<boolean>;
  closeConfirm: (ok: boolean) => void;
  goAddSlot: (providerId: string | null) => void;
}

const VIEWS: View[] = ['chat', 'agent', 'compare', 'team', 'code', 'keys', 'logs'];
const fromHash = (): View => {
  const v = location.hash.replace(/^#\/?/, '').split('/')[0] as View;
  return VIEWS.includes(v) ? v : 'chat';
};

let toastId = 0;

export const useUI = create<UIState>()((set, get) => ({
  view: fromHash(),
  navOpen: false,
  modal: null,
  toasts: [],
  confirmReq: null,
  addSlotFor: null,
  setView: (v) => {
    if (location.hash !== `#/${v}`) history.replaceState(null, '', `#/${v}`);
    set({ view: v, navOpen: false });
  },
  setNav: (open) => set({ navOpen: open }),
  openModal: (m) => set({ modal: m }),
  toast: (text, kind = 'info') => {
    const id = ++toastId;
    set({ toasts: [...get().toasts, { id, kind, text }] });
    setTimeout(() => get().dismiss(id), kind === 'error' ? 6000 : 3200);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  confirm: (req) =>
    new Promise<boolean>((resolve) => {
      set({ confirmReq: { ...req, resolve } });
    }),
  closeConfirm: (ok) => {
    get().confirmReq?.resolve(ok);
    set({ confirmReq: null });
  },
  goAddSlot: (providerId) => {
    set({ addSlotFor: providerId });
    get().setView('keys');
  },
}));

window.addEventListener('hashchange', () => {
  const v = fromHash();
  if (v !== useUI.getState().view) useUI.setState({ view: v, navOpen: false });
});
