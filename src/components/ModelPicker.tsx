import { useCallback, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, KeyRound, Lock, RefreshCw, Search } from 'lucide-react';
import type { ModelRef, ProviderDef } from '../lib/types';
import { allProviders, isUsable, keylessModels, modelLabel, modelsFor, useSettings } from '../lib/settings';
import { ACCESS_LABEL } from '../lib/providers';
import { listModels } from '../lib/llm';
import { useUI } from '../lib/ui';
import { log } from '../lib/logs';
import { Popover } from './Popover';

export function ProviderDot({ color, size = 10 }: { color: string; size?: number }) {
  return <span className="pdot" style={{ background: color, width: size, height: size }} />;
}

export function ModelBadge({ r }: { r: ModelRef }) {
  const p = allProviders().find((x) => x.id === r.providerId);
  return (
    <span className="model-badge" title={`${p?.name ?? r.providerId} · ${r.model}`}>
      <ProviderDot color={p?.color ?? '#888'} size={8} />
      <span className="model-badge-name">{modelLabel(r)}</span>
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
  const [, force] = useState(0);
  const slots = useSettings((s) => s.slots);
  const custom = useSettings((s) => s.customProviders);
  const updateSlot = useSettings((s) => s.updateSlot);
  const corsProxy = useSettings((s) => s.corsProxy);
  const goAddSlot = useUI((s) => s.goAddSlot);
  const toast = useUI((s) => s.toast);

  const providers = useMemo(() => allProviders(custom), [custom]);
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
      if (p.access === 'keyless') {
        const ids = await listModels({ provider: p, slot: { apiKey: '' }, corsProxy });
        keylessModels.splice(0, keylessModels.length, ...ids);
        force((n) => n + 1);
        toast(`Loaded ${ids.length} free model${ids.length === 1 ? '' : 's'}`, 'success');
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

  const ql = q.trim().toLowerCase();
  const providerSlots = slots.filter((s) => s.providerId === value.providerId && s.enabled);

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
        <ChevronDown size={14} className="mp-chev" />
      </button>
      <Popover anchor={btn} open={open} onClose={close} width={380} align={align}>
        <div className="mp-search">
          <Search size={15} />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search models, or type any model id…"
          />
        </div>
        <div className="mp-list">
          {usable.map((p) => {
            const { list, live } = modelsFor(p, slots);
            const shown = list.filter((m) => !ql || m.toLowerCase().includes(ql) || p.name.toLowerCase().includes(ql));
            const exact = list.some((m) => m.toLowerCase() === ql);
            const nSlots = slots.filter((s) => s.providerId === p.id && s.enabled).length;
            if (!shown.length && !ql) return null;
            return (
              <div key={p.id} className="mp-group">
                <div className="mp-group-head">
                  <ProviderDot color={p.color} />
                  <span className="mp-group-name">{p.name}</span>
                  <span className={`badge badge-${p.access}`}>{ACCESS_LABEL[p.access]}</span>
                  {nSlots > 0 && <span className="mp-keys" title="Enabled keys"><KeyRound size={11} />{nSlots}</span>}
                  <button className="icon-btn xs" title={live ? 'Reload model list' : 'Load live model list'} onClick={() => refresh(p)} disabled={loading === p.id}>
                    <RefreshCw size={13} className={loading === p.id ? 'spin' : ''} />
                  </button>
                </div>
                {shown.slice(0, 60).map((m) => {
                  const sel = value.providerId === p.id && value.model === m;
                  return (
                    <button
                      key={m}
                      className={`mp-item${sel ? ' selected' : ''}`}
                      onClick={() => {
                        onChange({ providerId: p.id, model: m, slotId: value.providerId === p.id ? value.slotId : undefined });
                        close();
                      }}
                    >
                      <span className="mp-item-name">{p.modelLabels?.[m] ?? m}</span>
                      {m.endsWith(':free') && <span className="badge badge-keyless">free</span>}
                      {sel && <Check size={14} />}
                    </button>
                  );
                })}
                {shown.length > 60 && <div className="mp-more">+{shown.length - 60} more — type to filter</div>}
                {ql && !exact && (
                  <button
                    className="mp-item mp-custom"
                    onClick={() => {
                      onChange({ providerId: p.id, model: q.trim() });
                      close();
                    }}
                  >
                    Use “{q.trim()}” with {p.name}
                  </button>
                )}
                {!live && !ql && <div className="mp-hint">Suggested list. Press ↻ to load the live list.</div>}
              </div>
            );
          })}
          {locked.length > 0 && (
            <div className="mp-group mp-locked">
              <div className="mp-group-head">
                <Lock size={13} />
                <span className="mp-group-name">Add a key to unlock</span>
              </div>
              <div className="mp-locked-grid">
                {locked
                  .filter((p) => !ql || p.name.toLowerCase().includes(ql))
                  .map((p) => (
                    <button
                      key={p.id}
                      className="chip"
                      onClick={() => {
                        close();
                        goAddSlot(p.id);
                      }}
                    >
                      <ProviderDot color={p.color} size={8} /> {p.name}
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
