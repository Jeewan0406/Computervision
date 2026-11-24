import { useCallback, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, KeyRound, Lock, LogIn, RefreshCw, Search } from 'lucide-react';
import type { ModelRef, ProviderDef } from '../lib/types';
import { allProviders, displayName, isUsable, modelLabel, modelsFor, setLiveModels, useRuntime, useSettings, isFree } from '../lib/settings';
import { ACCESS_LABEL } from '../lib/providers';
import { isFreeModel } from '../lib/models';
import { listModels, puterSignIn } from '../lib/llm';
import { useUI } from '../lib/ui';
import { log } from '../lib/logs';
import { Popover } from './Popover';

export function ProviderDot({ color, size = 10 }: { color: string; size?: number }) {
  return <span className="pdot" style={{ background: color, width: size, height: size }} />;
}

export function FreeTag({ small = false }: { small?: boolean }) {
  return <span className={`free-tag${small ? ' sm' : ''}`} title="Free to use (limits set by the provider)">Free</span>;
}

export function ModelBadge({ r }: { r: ModelRef }) {
  useRuntime((s) => s.v);
  const p = allProviders().find((x) => x.id === r.providerId);
  return (
    <span className="model-badge" title={`${p?.name ?? r.providerId} · ${r.model}`}>
      <ProviderDot color={p?.color ?? '#888'} size={8} />
      <span className="model-badge-name">{modelLabel(r)}</span>
      {isFree(r) && <FreeTag small />}
    </span>
  );
}

export function ModelPicker({
  value,
  onChange,
  size = 'md',
  align = 'start',
}: {
  value: ModelRef;
  onChange: (r: ModelRef) => void;
  size?: 'sm' | 'md';
  align?: 'start' | 'end';
}) {
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState<string | null>(null);
  useRuntime((s) => s.v);
  const slots = useSettings((s) => s.slots);
  const custom = useSettings((s) => s.customProviders);
  const updateSlot = useSettings((s) => s.updateSlot);
  const corsProxy = useSettings((s) => s.corsProxy);
  const goAddSlot = useUI((s) => s.goAddSlot);
  const toast = useUI((s) => s.toast);

  const providers = useMemo(() => allProviders(custom), [custom, useRuntime.getState().v]); // eslint-disable-line react-hooks/exhaustive-deps
  const current = providers.find((p) => p.id === value.providerId);
  const usable = providers.filter((p) => isUsable(p, slots));
  const locked = providers.filter((p) => !isUsable(p, slots));
  const close = useCallback(() => {
    setOpen(false);
    setQ('');
  }, []);

  const refresh = async (p: ProviderDef) => {
    setLoading(p.id);
    try {
      if (p.access === 'keyless' || p.kind === 'browser') {
        const ids = await listModels({ provider: p, slot: { apiKey: '' }, corsProxy });
        setLiveModels(p.id, ids);
        toast(`${p.name}: ${ids.length} models loaded`, 'success');
        return;
      }
      const slot = slots.find((s) => s.providerId === p.id && s.enabled);
      if (!slot) return;
      const ids = await listModels({ provider: p, slot, corsProxy });
      for (const s of slots) if (s.providerId === p.id) updateSlot(s.id, { models: ids, modelsFetchedAt: Date.now() });
      log({ level: 'info', type: 'system', feature: 'keys', providerId: p.id, providerName: p.name, slotLabel: slot.label, message: `Loaded ${ids.length} models.` });
      toast(`${p.name}: ${ids.length} models loaded`, 'success');
    } catch (e) {
      toast(`${p.name}: ${(e as Error).message}`, 'error');
      log({ level: 'error', type: 'system', feature: 'keys', providerId: p.id, providerName: p.name, message: `Model list failed: ${(e as Error).message}` });
    } finally {
      setLoading(null);
    }
  };

  const signIn = async (p: ProviderDef) => {
    setLoading(p.id);
    try {
      const ok = await puterSignIn();
      toast(ok ? 'Signed in to Puter' : 'Puter sign-in was not completed', ok ? 'success' : 'info');
      if (ok) await refresh(p);
    } catch (e) {
      toast(`Puter: ${(e as Error).message}`, 'error');
    } finally {
      setLoading(null);
    }
  };

  const ql = q.trim().toLowerCase();
  const providerSlots = slots.filter((s) => s.providerId === value.providerId && s.enabled);
  const free = isFreeModel(current, value.model);

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`model-picker model-picker-${size}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`${current?.name ?? value.providerId} · ${value.model}`}
      >
        <ProviderDot color={current?.color ?? '#888'} />
        <span className="mp-text">
          <span className="mp-model">{modelLabel(value)}</span>
          {size === 'md' && <span className="mp-provider">{current?.name ?? 'Unknown provider'}</span>}
        </span>
        {free && <FreeTag small />}
        <ChevronDown size={14} className="mp-chev" />
      </button>
      <Popover anchor={btn} open={open} onClose={close} width={400} align={align}>
        <div className="mp-search">
          <Search size={15} />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search models, e.g. Llama, Gemini, free…" />
        </div>
        <div className="mp-list">
          {usable.map((p) => {
            const { list, live } = modelsFor(p, slots);
            const wantFree = ql === 'free';
            const shown = list.filter((m) => {
              if (!ql) return true;
              if (wantFree) return isFreeModel(p, m);
              const name = displayName(p, m).toLowerCase();
              return m.toLowerCase().includes(ql) || name.includes(ql) || p.name.toLowerCase().includes(ql);
            });
            const nSlots = slots.filter((s) => s.providerId === p.id && s.enabled).length;
            if (!shown.length) return null;
            return (
              <div key={p.id} className="mp-group">
                <div className="mp-group-head">
                  <ProviderDot color={p.color} />
                  <span className="mp-group-name">{p.name}</span>
                  {p.kind === 'auto' ? <span className="badge badge-auto">Picks for you</span> : <span className={`badge badge-${p.access}`}>{ACCESS_LABEL[p.access]}</span>}
                  {nSlots > 0 && <span className="mp-keys" title="Enabled keys"><KeyRound size={11} />{nSlots}</span>}
                  {p.kind === 'puter' && (
                    <button className="btn ghost xs" onClick={() => signIn(p)} disabled={loading === p.id} title="Sign in with a free Puter account">
                      <LogIn size={12} /> Sign in
                    </button>
                  )}
                  {p.kind !== 'auto' && (
                    <button className="icon-btn xs" title={live ? 'Reload model list' : 'Load live model list'} onClick={() => refresh(p)} disabled={loading === p.id}>
                      <RefreshCw size={13} className={loading === p.id ? 'spin' : ''} />
                    </button>
                  )}
                </div>
                {shown.slice(0, 80).map((m) => {
                  const sel = value.providerId === p.id && value.model === m;
                  const name = displayName(p, m);
                  return (
                    <button
                      key={m}
                      className={`mp-item${sel ? ' selected' : ''}`}
                      onClick={() => {
                        onChange({ providerId: p.id, model: m, slotId: value.providerId === p.id ? value.slotId : undefined });
                        close();
                      }}
                      title={m}
                    >
                      <span className="mp-item-text">
                        <span className="mp-item-name">{name}</span>
                        {name.toLowerCase() !== m.toLowerCase() && <span className="mp-item-id">{m}</span>}
                      </span>
                      {isFreeModel(p, m) && <FreeTag small />}
                      {sel && <Check size={14} />}
                    </button>
                  );
                })}
                {shown.length > 80 && <div className="mp-more">+{shown.length - 80} more — type to filter</div>}
                {p.kind === 'auto' && !ql && <div className="mp-hint">{p.tagline}</div>}
                {!live && !ql && p.kind !== 'auto' && (
                  <div className="mp-hint">
                    {p.kind === 'puter' ? 'Sign in, then press ↻ to load all Puter models.' : 'Suggested list. Press ↻ to load the live list.'}
                  </div>
                )}
              </div>
            );
          })}
          {ql && ql !== 'free' && !usable.some((p) => modelsFor(p, slots).list.some((m) => m.toLowerCase() === ql)) && (
            <div className="mp-group">
              <div className="mp-group-head"><span className="mp-group-name">Use “{q.trim()}” as a custom model id with…</span></div>
              <div className="mp-locked-grid">
                {usable.map((p) => (
                  <button key={p.id} className="chip" onClick={() => { onChange({ providerId: p.id, model: q.trim() }); close(); }}>
                    <ProviderDot color={p.color} size={8} /> {p.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          {locked.length > 0 && (
            <div className="mp-group mp-locked">
              <div className="mp-group-head">
                <Lock size={13} />
                <span className="mp-group-name">Add a key to unlock</span>
              </div>
              <div className="mp-locked-grid">
                {locked
                  .filter((p) => !ql || p.name.toLowerCase().includes(ql) || (ql === 'free' && p.access === 'free-tier'))
                  .map((p) => (
                    <button key={p.id} className="chip" onClick={() => { close(); goAddSlot(p.id); }}>
                      <ProviderDot color={p.color} size={8} /> {p.name}
                      {p.access === 'free-tier' && <FreeTag small />}
                    </button>
                  ))}
              </div>
            </div>
          )}
        </div>
        {providerSlots.length > 1 && (
          <div className="mp-slots">
            <span className="mp-slots-label">Key</span>
            <button className={`chip${!value.slotId ? ' active' : ''}`} onClick={() => onChange({ ...value, slotId: undefined })}>
              Auto-rotate ({providerSlots.length})
            </button>
            {providerSlots.map((s) => (
              <button key={s.id} className={`chip${value.slotId === s.id ? ' active' : ''}`} onClick={() => onChange({ ...value, slotId: s.id })}>
                {s.label}
              </button>
            ))}
          </div>
        )}
      </Popover>
    </>
  );
}
