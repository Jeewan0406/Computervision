import { useRef, type ReactNode } from 'react';
import { CheckCircle2, Info, Trophy, X, XCircle } from 'lucide-react';
import { useUI } from '../lib/ui';
import { useSettings, type Accent, type Theme, modelKey, allProviders } from '../lib/settings';
import { useData } from '../lib/data';
import { useLogs } from '../lib/logs';
import { CHANGELOG, APP_VERSION } from '../lib/changelog';
import { downloadText } from '../lib/utils';
import type { Session } from '../lib/types';
import { ModelPicker, ProviderDot } from './ModelPicker';
import { LogoMark, Wordmark } from './Logo';
import { REPO_URL } from './Shell';

function Modal({ title, onClose, children, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

const ACCENTS: { id: Accent; color: string; label?: string }[] = [
  { id: 'druk', color: '#f08a24', label: 'Druk saffron (Bhutan)' },
  { id: 'violet', color: '#8b5cf6' },
  { id: 'blue', color: '#3b82f6' },
  { id: 'emerald', color: '#10b981' },
  { id: 'rose', color: '#f43f5e' },
  { id: 'amber', color: '#f59e0b' },
];

function SettingsModal({ onClose }: { onClose: () => void }) {
  const s = useSettings();
  const confirm = useUI((u) => u.confirm);
  const toast = useUI((u) => u.toast);
  const fileRef = useRef<HTMLInputElement>(null);
  const sessions = useData((d) => d.sessions);

  return (
    <Modal title="Settings" onClose={onClose}>
      <section className="set-section">
        <h3>Appearance</h3>
        <div className="set-row">
          <span>Theme</span>
          <div className="seg">
            {(['dark', 'light', 'system'] as Theme[]).map((t) => (
              <button key={t} className={s.theme === t ? 'active' : ''} onClick={() => s.set({ theme: t })}>{t[0].toUpperCase() + t.slice(1)}</button>
            ))}
          </div>
        </div>
        <div className="set-row">
          <span>Accent colour</span>
          <div className="swatches">
            {ACCENTS.map((a) => (
              <button key={a.id} className={`swatch${s.accent === a.id ? ' active' : ''}`} style={{ background: a.color }} onClick={() => s.set({ accent: a.id })} aria-label={a.label ?? a.id} title={a.label ?? a.id} />
            ))}
          </div>
        </div>
      </section>
      <section className="set-section">
        <h3>Chat</h3>
        <label className="set-row">
          <span>Send with Enter <span className="muted xs">(off = Ctrl/⌘ + Enter)</span></span>
          <input type="checkbox" className="switch" checked={s.sendOnEnter} onChange={(e) => s.set({ sendOnEnter: e.target.checked })} />
        </label>
        <label className="set-row">
          <span>Show model reasoning when available</span>
          <input type="checkbox" className="switch" checked={s.showReasoning} onChange={(e) => s.set({ showReasoning: e.target.checked })} />
        </label>
        <div className="set-row">
          <span>Default model for new chats</span>
          <ModelPicker value={s.defaultModel} onChange={(r) => s.set({ defaultModel: { providerId: r.providerId, model: r.model } })} align="end" />
        </div>
      </section>
      <section className="set-section">
        <h3>Your data</h3>
        <p className="muted sm">Everything is stored only in this browser. Export a backup before clearing browser data.</p>
        <div className="row gap-8 wrap">
          <button className="btn ghost sm" onClick={() => downloadText(`jeea-conversations-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(Object.values(sessions), null, 2), 'application/json')}>
            Export conversations
          </button>
          <button className="btn ghost sm" onClick={() => fileRef.current?.click()}>Import conversations</button>
          <input
            ref={fileRef} type="file" accept="application/json,.json" hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              try {
                const list = JSON.parse(await f.text()) as Session[];
                if (!Array.isArray(list)) throw new Error('Expected a list');
                useData.getState().importSessions(list);
                toast(`Imported ${list.length} conversations`, 'success');
              } catch (err) {
                toast(`Import failed: ${(err as Error).message}`, 'error');
              }
            }}
          />
          <button
            className="btn danger sm"
            onClick={async () => {
              if (await confirm({ title: 'Delete all conversations?', body: 'Chats, comparisons, team runs and CodeFrame projects will be removed from this browser. Keys stay.', confirmLabel: 'Delete all', danger: true })) {
                useData.getState().clearAll();
                toast('All conversations deleted');
              }
            }}
          >
            Delete all conversations
          </button>
          <button
            className="btn danger sm"
            onClick={async () => {
              if (await confirm({ title: 'Reset JeeA! completely?', body: 'Removes all keys, settings, conversations and logs from this browser.', confirmLabel: 'Reset everything', danger: true })) {
                useData.getState().clearAll();
                useLogs.getState().clear();
                localStorage.removeItem('jeea.settings');
                sessionStorage.clear();
                location.reload();
              }
            }}
          >
            Reset everything
          </button>
        </div>
      </section>
      <section className="set-section about">
        <LogoMark size={40} />
        <div>
          <Wordmark small /> <span className="muted sm">v{APP_VERSION}</span>
          <p className="muted sm"><a href={REPO_URL} target="_blank" rel="noreferrer">View the source code on GitHub</a>.</p>
        </div>
      </section>
    </Modal>
  );
}

const TAG_LABEL = { new: 'New', improved: 'Improved', fixed: 'Fixed', scale: 'Scale', security: 'Security' } as const;

function WhatsNewModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title={<span className="row gap-8"><LogoMark size={26} /> What's new in JeeA!</span>} onClose={onClose} wide>
      {CHANGELOG.map((r) => (
        <div key={r.version} className="release">
          <div className="release-head">
            <span className="release-version">v{r.version}</span>
            <span className="release-title">{r.title}</span>
            <span className="muted sm">{r.date}</span>
          </div>
          <ul className="release-list">
            {r.items.map((it, i) => (
              <li key={i}>
                <span className={`tag tag-${it.tag}`}>{TAG_LABEL[it.tag]}</span>
                <strong>{it.feature}.</strong> {it.text}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </Modal>
  );
}

function LeaderboardModal({ onClose }: { onClose: () => void }) {
  const lb = useSettings((s) => s.leaderboard);
  const providers = allProviders();
  const rows = Object.entries(lb)
    .map(([k, v]) => {
      const [pid, ...rest] = k.split('::');
      return { key: k, provider: providers.find((p) => p.id === pid), model: rest.join('::'), ...v, rate: v.battles ? v.wins / v.battles : 0 };
    })
    .sort((a, b) => b.wins - a.wins || b.rate - a.rate);
  return (
    <Modal title={<span className="row gap-8"><Trophy size={20} /> Your model leaderboard</span>} onClose={onClose}>
      <p className="muted sm">Built from your own votes in Compare. A "battle" is one turn where the model took part and you picked a winner.</p>
      {rows.length === 0 ? (
        <div className="empty-mini">No votes yet. In Compare, press “Best” under the answer you like most.</div>
      ) : (
        <table className="table">
          <thead><tr><th>#</th><th>Model</th><th>Wins</th><th>Battles</th><th>Win rate</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key}>
                <td>{i + 1}</td>
                <td><span className="row gap-6"><ProviderDot color={r.provider?.color ?? '#888'} size={8} />{r.model}</span></td>
                <td>{r.wins}</td>
                <td>{r.battles}</td>
                <td><div className="bar"><span style={{ width: `${Math.round(r.rate * 100)}%` }} /></div>{Math.round(r.rate * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {rows.length > 0 && (
        <button className="btn ghost sm" onClick={() => useSettings.getState().set({ leaderboard: {} })}>Reset leaderboard</button>
      )}
    </Modal>
  );
}

export function Modals() {
  const modal = useUI((s) => s.modal);
  const openModal = useUI((s) => s.openModal);
  const close = () => openModal(null);
  const confirmReq = useUI((s) => s.confirmReq);
  const closeConfirm = useUI((s) => s.closeConfirm);
  return (
    <>
      {modal === 'settings' && <SettingsModal onClose={close} />}
      {modal === 'whatsnew' && <WhatsNewModal onClose={close} />}
      {modal === 'leaderboard' && <LeaderboardModal onClose={close} />}
      {confirmReq && (
        <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && closeConfirm(false)}>
          <div className="modal confirm" role="alertdialog" aria-modal="true">
            <h2>{confirmReq.title}</h2>
            {confirmReq.body && <p className="muted">{confirmReq.body}</p>}
            <div className="row gap-8 end">
              <button className="btn ghost" onClick={() => closeConfirm(false)}>Cancel</button>
              <button className={`btn ${confirmReq.danger ? 'danger' : 'primary'}`} autoFocus onClick={() => closeConfirm(true)}>
                {confirmReq.confirmLabel ?? 'OK'}
              </button>
            </div>
          </div>
        </div>
      )}
      <Toasts />
    </>
  );
}

function Toasts() {
  const toasts = useUI((s) => s.toasts);
  const dismiss = useUI((s) => s.dismiss);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} onClick={() => dismiss(t.id)}>
          {t.kind === 'success' ? <CheckCircle2 size={16} /> : t.kind === 'error' ? <XCircle size={16} /> : <Info size={16} />}
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}

export { modelKey };
