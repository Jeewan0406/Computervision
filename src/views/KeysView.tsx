import { localAvailable } from '../lib/local';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2, Clock, Download, ExternalLink, Eye, EyeOff, KeyRound, Loader2, LogIn, Plus, RefreshCw, Route, ShieldCheck,
  Trash2, Upload, XCircle, Zap,
} from 'lucide-react';
import type { ProviderDef, Slot } from '../lib/types';
import { useSettings, allProviders, modelsFor, useRuntime } from '../lib/settings';
import { ACCESS_LABEL, KEYLESS_ID } from '../lib/providers';
import { useUI } from '../lib/ui';
import { log } from '../lib/logs';
import { listModels, puterSignIn } from '../lib/llm';
import { testSlot } from '../lib/runner';
import { downloadText, maskKey } from '../lib/utils';
import { TopBar } from '../components/Shell';
import { ModelPicker, ProviderDot } from '../components/ModelPicker';

function useNow(ms = 1000) {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

function SlotStatus({ s }: { s: Slot }) {
  useNow();
  const cooling = s.cooldownUntil && s.cooldownUntil > Date.now();
  if (!s.enabled) return <span className="status muted">Disabled</span>;
  if (cooling) return <span className="status warn"><Clock size={13} /> Cooling {Math.ceil((s.cooldownUntil! - Date.now()) / 1000)} s</span>;
  if (s.status === 'ok') return <span className="status ok"><CheckCircle2 size={13} /> Working</span>;
  if (s.status === 'error') return <span className="status danger" title={s.lastError}><XCircle size={13} /> Error</span>;
  return <span className="status muted">Not tested</span>;
}

function SlotCard({ s, p }: { s: Slot; p: ProviderDef }) {
  const update = useSettings((x) => x.updateSlot);
  const remove = useSettings((x) => x.removeSlot);
  const corsProxy = useSettings((x) => x.corsProxy);
  const confirm = useUI((x) => x.confirm);
  const toast = useUI((x) => x.toast);
  const [busy, setBusy] = useState<'test' | 'models' | null>(null);
  const [reveal, setReveal] = useState(false);
  const [testModel, setTestModel] = useState(p.defaultModel);
  const { list } = modelsFor(p, [s]);

  const doTest = async () => {
    setBusy('test');
    const r = await testSlot(s, list.includes(testModel) ? testModel : list[0] ?? testModel);
    setBusy(null);
    toast(r.ok ? `${s.label}: working (${Math.round(r.ms)} ms) — “${r.text}”` : `${s.label}: ${r.text}`, r.ok ? 'success' : 'error');
  };
  const loadModels = async () => {
    setBusy('models');
    try {
      const ids = await listModels({ provider: p, slot: s, corsProxy });
      update(s.id, { models: ids, modelsFetchedAt: Date.now(), status: 'ok', lastError: undefined });
      if (ids.length && !ids.includes(testModel)) setTestModel(ids.includes(p.defaultModel) ? p.defaultModel : ids[0]);
      log({ level: 'info', type: 'system', feature: 'keys', providerId: p.id, providerName: p.name, slotLabel: s.label, message: `Loaded ${ids.length} models.` });
      toast(`${ids.length} models loaded for ${s.label}`, 'success');
    } catch (e) {
      update(s.id, { status: 'error', lastError: (e as Error).message });
      toast(`${s.label}: ${(e as Error).message}`, 'error');
    }
    setBusy(null);
  };

  return (
    <div className={`slot-card${s.enabled ? '' : ' disabled'}`} style={{ ['--p-color' as string]: p.color }}>
      <div className="slot-top">
        <ProviderDot color={p.color} />
        <input
          className="slot-label"
          value={s.label}
          onChange={(e) => update(s.id, { label: e.target.value })}
          aria-label="Slot name"
        />
        <input type="checkbox" className="switch" checked={s.enabled} onChange={(e) => update(s.id, { enabled: e.target.checked })} title="Enable or disable this key" />
      </div>
      <div className="slot-meta">
        <span className="muted xs">{p.name}</span>
        <SlotStatus s={s} />
      </div>
      <div className="slot-key">
        <code>{reveal ? s.apiKey || '(empty)' : maskKey(s.apiKey)}</code>
        <button className="icon-btn xs" onClick={() => setReveal((r) => !r)} title={reveal ? 'Hide' : 'Show'}>{reveal ? <EyeOff size={13} /> : <Eye size={13} />}</button>
      </div>
      {s.lastError && s.status !== 'ok' && <div className="slot-err">{s.lastError}</div>}
      <div className="slot-stats">
        <span><Zap size={12} /> {s.uses} calls</span>
        <span>{s.failures} failures</span>
        <span>{s.models?.length ? `${s.models.length} models` : 'suggested models'}</span>
      </div>
      <label className="row gap-6 xs muted">
        <input type="checkbox" checked={!!s.useProxy} onChange={(e) => update(s.id, { useProxy: e.target.checked })} /> Use CORS proxy
      </label>
      <div className="slot-actions">
        <select value={testModel} onChange={(e) => setTestModel(e.target.value)} title="Model used for the test" className="sm">
          {[...new Set([testModel, ...list])].slice(0, 200).map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <button className="btn ghost xs" onClick={doTest} disabled={!!busy}>
          {busy === 'test' ? <Loader2 size={13} className="spin" /> : <CheckCircle2 size={13} />} Test
        </button>
        <button className="btn ghost xs" onClick={loadModels} disabled={!!busy} title="Load the live model list">
          {busy === 'models' ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />} Models
        </button>
        <button
          className="icon-btn xs danger push"
          title="Delete key"
          onClick={async () => {
            if (await confirm({ title: `Delete “${s.label}”?`, body: 'The key is removed from this browser.', confirmLabel: 'Delete', danger: true })) {
              remove(s.id);
              log({ level: 'info', type: 'system', feature: 'keys', providerId: p.id, providerName: p.name, slotLabel: s.label, message: 'Key deleted.' });
            }
          }}
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

function AddSlotForm({ providers, preset, onDone }: { providers: ProviderDef[]; preset: string | null; onDone: () => void }) {
  const slots = useSettings((s) => s.slots);
  const addSlot = useSettings((s) => s.addSlot);
  const corsProxy = useSettings((s) => s.corsProxy);
  const update = useSettings((s) => s.updateSlot);
  const toast = useUI((s) => s.toast);
  const keyed = providers.filter((p) => p.access !== 'keyless' && p.access !== 'local');
  const [pid, setPid] = useState(preset ?? 'gemini');
  const [key, setKey] = useState('');
  const [label, setLabel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const p = keyed.find((x) => x.id === pid) ?? keyed[0];
  const count = slots.filter((s) => s.providerId === p.id).length;
  const local = p.access === 'local';

  useEffect(() => {
    if (preset) setPid(preset);
  }, [preset]);

  const save = async () => {
    if (!key.trim() && !local) return toast('Paste your API key first.', 'error');
    setSaving(true);
    const slot = addSlot({
      providerId: p.id,
      label: label.trim() || `${p.name} #${count + 1}`,
      apiKey: key.trim() || (local ? 'local' : ''),
      baseUrl: baseUrl.trim() || undefined,
      enabled: true,
    });
    log({ level: 'info', type: 'system', feature: 'keys', providerId: p.id, providerName: p.name, slotLabel: slot.label, message: 'Key added.' });
    setKey('');
    setLabel('');
    setBaseUrl('');
    let works = false;
    let ids: string[] = [];
    try {
      ids = await listModels({ provider: p, slot, corsProxy });
      update(slot.id, { models: ids, modelsFetchedAt: Date.now(), status: 'ok' });
      toast(`${slot.label} added — ${ids.length} models found`, 'success');
      works = true;
    } catch (e) {
      // Some providers block /models but allow chat; run a real test instead.
      const r = await testSlot(slot, p.defaultModel);
      works = r.ok;
      toast(r.ok ? `${slot.label} added and working` : `${slot.label} saved, but the test failed: ${(e as Error).message}`, r.ok ? 'success' : 'error');
    }
    // First working key: make it the default for new chats. The free model stays as a fallback.
    const st = useSettings.getState();
    if (works && st.defaultModel.providerId === KEYLESS_ID) {
      const model = ids.length && !ids.includes(p.defaultModel) ? ids[0] : p.defaultModel;
      st.set({ defaultModel: { providerId: p.id, model } });
      toast(`New chats now use ${p.name} · ${model}. Change it any time in Settings.`, 'info');
    }
    setSaving(false);
    onDone();
  };

  return (
    <div className="card add-slot">
      <div className="card-head"><Plus size={16} /> <h3>Add an API slot</h3></div>
      <div className="form-grid">
        <label className="field">
          <span className="field-label">Provider</span>
          <select value={p.id} onChange={(e) => setPid(e.target.value)}>
            {(['free-tier', 'paid', 'local'] as const).map((acc) => (
              <optgroup key={acc} label={ACCESS_LABEL[acc]}>
                {keyed.filter((x) => x.access === acc && !x.custom).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </optgroup>
            ))}
            {keyed.some((x) => x.custom) && (
              <optgroup label="Your custom providers">
                {keyed.filter((x) => x.custom).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </optgroup>
            )}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Name (optional)</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={`${p.name} #${count + 1}`} />
        </label>
        <label className="field span-2">
          <span className="field-label">API key {local && <span className="muted">(any text works for local servers)</span>}</span>
          <div className="input-icon">
            <input
              type={show ? 'text' : 'password'}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={local ? 'optional' : 'Paste your key'}
              autoComplete="off"
              spellCheck={false}
              onKeyDown={(e) => e.key === 'Enter' && save()}
            />
            <button className="icon-btn xs" onClick={() => setShow((v) => !v)} type="button">{show ? <EyeOff size={14} /> : <Eye size={14} />}</button>
          </div>
        </label>
        <label className="field span-2">
          <span className="field-label">Base URL (optional override)</span>
          <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={p.baseUrl} spellCheck={false} />
        </label>
      </div>
      {p.note && <p className="note">{p.note}</p>}
      <div className="row gap-8 wrap">
        <button className="btn primary" onClick={save} disabled={saving}>
          {saving ? <Loader2 size={15} className="spin" /> : <KeyRound size={15} />} Save & test
        </button>
        {p.keyUrl && <a className="btn ghost" href={p.keyUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Get a key from {p.name}</a>}
        {count > 0 && <span className="muted sm">You already have {count} {p.name} slot{count > 1 ? 's' : ''}. More keys = requests rotate across them.</span>}
      </div>
    </div>
  );
}

function CustomProviderForm() {
  const add = useSettings((s) => s.addCustomProvider);
  const toast = useUI((s) => s.toast);
  const goAddSlot = useUI((s) => s.goAddSlot);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [kind, setKind] = useState<'openai' | 'anthropic'>('openai');
  const [model, setModel] = useState('');
  return (
    <div className="card">
      <div className="card-head"><Route size={16} /> <h3>Add your own endpoint</h3></div>
      <p className="muted sm">Any server that speaks the OpenAI <code>/chat/completions</code> format (vLLM, LiteLLM, Azure gateways, company proxies…) or the Anthropic Messages format.</p>
      <div className="form-grid">
        <label className="field"><span className="field-label">Name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="My company gateway" /></label>
        <label className="field">
          <span className="field-label">API format</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as 'openai' | 'anthropic')}>
            <option value="openai">OpenAI-compatible</option>
            <option value="anthropic">Anthropic Messages</option>
          </select>
        </label>
        <label className="field span-2"><span className="field-label">Base URL</span><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://llm.example.com/v1" spellCheck={false} /></label>
        <label className="field span-2"><span className="field-label">Default model id</span><input value={model} onChange={(e) => setModel(e.target.value)} placeholder="e.g. llama-3.3-70b" spellCheck={false} /></label>
      </div>
      <button
        className="btn ghost"
        onClick={() => {
          if (!name.trim() || !/^https?:\/\//.test(url.trim())) return toast('Enter a name and a URL starting with http(s)://', 'error');
          const def = add({
            name: name.trim(), kind, baseUrl: url.trim(), access: 'paid', color: `hsl(${Math.floor(Math.random() * 360)} 70% 60%)`,
            tagline: 'Your custom endpoint', suggestedModels: model.trim() ? [model.trim()] : [], defaultModel: model.trim() || 'default',
          });
          log({ level: 'info', type: 'system', feature: 'keys', providerId: def.id, providerName: def.name, message: `Custom provider added (${url.trim()}).` });
          setName(''); setUrl(''); setModel('');
          toast(`${def.name} added. Now add a key for it.`, 'success');
          goAddSlot(def.id);
        }}
      >
        <Plus size={14} /> Add endpoint
      </button>
    </div>
  );
}

export function KeysView() {
  const s = useSettings();
  const addSlotFor = useUI((u) => u.addSlotFor);
  const goAddSlot = useUI((u) => u.goAddSlot);
  const toast = useUI((u) => u.toast);
  const confirm = useUI((u) => u.confirm);
  const rv = useRuntime((x) => x.v);
  const providers = useMemo(() => allProviders(s.customProviders), [s.customProviders, rv]);
  const formRef = useRef<HTMLDivElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState<'all' | 'free' | 'paid' | 'local'>('all');

  useEffect(() => {
    if (addSlotFor) formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [addSlotFor]);

  const grouped = providers
    .map((p) => ({ p, slots: s.slots.filter((x) => x.providerId === p.id) }))
    .filter((g) => g.slots.length);

  const catalog = providers.filter((p) =>
    filter === 'all' ? true : filter === 'free' ? p.access === 'free-tier' || p.access === 'keyless' || p.access === 'local' : p.access === filter,
  );

  const exportSettings = (withKeys: boolean) => {
    const { slots, customProviders, fallback, maxRetries, corsProxy, defaultModel } = useSettings.getState();
    const data = {
      app: 'JeeA!', kind: 'settings', version: 1, exportedAt: new Date().toISOString(),
      slots: slots.map((x) => ({ ...x, apiKey: withKeys ? x.apiKey : '' })), customProviders, fallback, maxRetries, corsProxy, defaultModel,
    };
    downloadText(`jeea-settings${withKeys ? '-WITH-KEYS' : ''}.json`, JSON.stringify(data, null, 2), 'application/json');
  };

  return (
    <div className="view keys-view">
      <TopBar>
        <span className="topbar-title strong">API Slots</span>
        <span className="muted sm hide-sm">{s.slots.length} keys · {grouped.length} providers</span>
      </TopBar>
      <div className="scroll page">
        <div className="page-inner">
          <div className="hero-card">
            <div>
              <h1>Your models, your keys</h1>
              <p className="muted">JeeA! works right away with a shared free model. Add keys to unlock more models and higher limits. You can add <b>several keys per provider</b>: requests rotate across them and skip any key that is rate-limited.</p>
            </div>
            <div className="hero-stats">
              <div className="stat"><b>{s.slots.filter((x) => x.enabled).length}</b><span>active keys</span></div>
              <div className="stat"><b>{grouped.length}</b><span>providers</span></div>
              <div className="stat"><b>{providers.length}</b><span>available</span></div>
            </div>
          </div>

          <div className="notice">
            <ShieldCheck size={18} />
            <div>
              <b>Your keys stay in this browser.</b> They are sent only to the provider you choose (or to your own CORS proxy if you turn it on). JeeA! has no server and never sees them. Anyone with access to this browser profile can read them, so use this on your own device.
              <div className="seg mt-8">
                <button className={s.keyStorage === 'local' ? 'active' : ''} onClick={() => s.set({ keyStorage: 'local' })}>Remember keys on this device</button>
                <button className={s.keyStorage === 'session' ? 'active' : ''} onClick={() => s.set({ keyStorage: 'session' })}>Forget keys when the tab closes</button>
              </div>
            </div>
          </div>

          <div ref={formRef}>
            <AddSlotForm providers={providers} preset={addSlotFor} onDone={() => useUI.setState({ addSlotFor: null })} />
          </div>

          <h2 className="section-title">Your slots</h2>
          {grouped.length === 0 ? (
            <div className="empty-mini">No keys yet. You are using the free model. Add a key above — Google Gemini, Groq and OpenRouter offer free tiers.</div>
          ) : (
            grouped.map(({ p, slots }) => (
              <div key={p.id} className="slot-group">
                <div className="slot-group-head">
                  <ProviderDot color={p.color} /> <b>{p.name}</b>
                  <span className={`badge badge-${p.access}`}>{ACCESS_LABEL[p.access]}</span>
                  <span className="muted xs">{slots.length > 1 ? `${slots.length} keys · auto-rotating` : '1 key'}</span>
                  <button className="btn ghost xs push" onClick={() => goAddSlot(p.id)}><Plus size={13} /> Add another key</button>
                </div>
                <div className="slot-grid">
                  {slots.map((x) => <SlotCard key={x.id} s={x} p={p} />)}
                </div>
              </div>
            ))
          )}

          <h2 className="section-title">Routing & reliability</h2>
          <div className="card">
            <label className="set-row">
              <span><b>Automatic fallback</b><br /><span className="muted sm">If every key of the chosen model fails before any text arrives, try these models in order.</span></span>
              <input type="checkbox" className="switch" checked={s.fallback.enabled} onChange={(e) => s.set({ fallback: { ...s.fallback, enabled: e.target.checked } })} />
            </label>
            {s.fallback.enabled && (
              <div className="fallback-list">
                {s.fallback.chain.map((r, i) => (
                  <div key={i} className="row gap-8">
                    <span className="muted sm">{i + 1}.</span>
                    <ModelPicker value={r} size="sm" onChange={(nr) => s.set({ fallback: { ...s.fallback, chain: s.fallback.chain.map((x, j) => (j === i ? { providerId: nr.providerId, model: nr.model } : x)) } })} />
                    <button className="icon-btn xs" onClick={() => s.set({ fallback: { ...s.fallback, chain: s.fallback.chain.filter((_, j) => j !== i) } })}><Trash2 size={13} /></button>
                  </div>
                ))}
                {s.fallback.chain.length < 5 && (
                  <button className="btn ghost xs" onClick={() => s.set({ fallback: { ...s.fallback, chain: [...s.fallback.chain, s.defaultModel] } })}><Plus size={13} /> Add fallback model</button>
                )}
              </div>
            )}
            <label className="set-row">
              <span><b>Retries on server errors</b><br /><span className="muted sm">Exponential backoff with random jitter (about 0.6 s, 1.2 s, 2.4 s…).</span></span>
              <select value={s.maxRetries} onChange={(e) => s.set({ maxRetries: Number(e.target.value) })} className="sm">
                {[0, 1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label className="field">
              <span className="field-label">CORS proxy prefix (optional)</span>
              <input value={s.corsProxy} onChange={(e) => s.set({ corsProxy: e.target.value.trim() })} placeholder="https://your-worker.your-name.workers.dev/" spellCheck={false} />
              <span className="field-help">Some APIs block calls from web pages. Deploy the small Cloudflare Worker in <code>proxy/cloudflare-worker.js</code>, paste its URL here, then tick “Use CORS proxy” on that key. The full target URL is appended to this prefix.</span>
            </label>
          </div>

          <h2 className="section-title">Provider catalog</h2>
          <div className="seg mb-12">
            {(['all', 'free', 'paid', 'local'] as const).map((f) => (
              <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>{f === 'all' ? 'All' : f === 'free' ? 'Free' : f === 'paid' ? 'Paid' : 'Local'}</button>
            ))}
          </div>
          <div className="catalog">
            {catalog.map((p) => {
              const n = s.slots.filter((x) => x.providerId === p.id).length;
              return (
                <div key={p.id} className="provider-card" style={{ ['--p-color' as string]: p.color }}>
                  <div className="provider-top">
                    <span className="provider-icon">{p.name.slice(0, 1)}</span>
                    <div>
                      <b>{p.name}</b>
                      <span className={`badge badge-${p.access}`}>{ACCESS_LABEL[p.access]}</span>
                    </div>
                  </div>
                  <p className="sm">{p.tagline}</p>
                  {p.note && <p className="xs muted">{p.note}</p>}
                  <div className="provider-actions">
                    {p.kind === 'puter' ? (
                      <button className="btn primary xs" onClick={async () => {
                        try {
                          const ok = await puterSignIn();
                          toast(ok ? 'Signed in to Puter. Pick a Puter model in the chat box.' : 'Puter sign-in was not completed', ok ? 'success' : 'info');
                        } catch (e) {
                          toast(`Puter: ${(e as Error).message}`, 'error');
                        }
                      }}><LogIn size={13} /> Sign in to Puter (free)</button>
                    ) : p.access === 'local' ? (
                      <span className={`status ${localAvailable(p.id) ? 'ok' : 'warn'}`}><CheckCircle2 size={13} /> {localAvailable(p.id) ? 'Runs in this browser, no key' : 'Not supported by this browser'}</span>
                    ) : p.access === 'keyless' ? (
                      <span className="status ok"><CheckCircle2 size={13} /> Ready, no key needed</span>
                    ) : (
                      <button className="btn ghost xs" onClick={() => goAddSlot(p.id)}><Plus size={13} /> {n ? `Add key (${n})` : 'Add key'}</button>
                    )}
                    {p.keyUrl && p.access !== 'keyless' && p.access !== 'local' && <a className="btn ghost xs" href={p.keyUrl} target="_blank" rel="noreferrer">Get key <ExternalLink size={12} /></a>}
                    {p.docsUrl && <a className="btn ghost xs" href={p.docsUrl} target="_blank" rel="noreferrer">Docs <ExternalLink size={12} /></a>}
                    {p.custom && (
                      <button className="icon-btn xs danger push" title="Remove custom provider" onClick={async () => {
                        if (await confirm({ title: `Remove ${p.name}?`, body: 'Its keys are removed too.', confirmLabel: 'Remove', danger: true })) s.removeCustomProvider(p.id);
                      }}><Trash2 size={13} /></button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="muted xs">Free tiers, limits and model names are set by each provider and change often. Check the provider's page before relying on them.</p>

          <CustomProviderForm />

          <h2 className="section-title">Backup</h2>
          <div className="card row gap-8 wrap">
            <button className="btn ghost sm" onClick={() => exportSettings(false)}><Download size={14} /> Export (without keys)</button>
            <button className="btn ghost sm" onClick={async () => {
              if (await confirm({ title: 'Export with keys?', body: 'The file will contain your API keys in plain text. Store it somewhere safe and never share it.', confirmLabel: 'Export with keys', danger: true })) exportSettings(true);
            }}><Download size={14} /> Export with keys</button>
            <button className="btn ghost sm" onClick={() => importRef.current?.click()}><Upload size={14} /> Import</button>
            <input ref={importRef} type="file" accept=".json,application/json" hidden onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              try {
                const d = JSON.parse(await f.text());
                if (d?.app !== 'JeeA!' || d?.kind !== 'settings') throw new Error('Not a JeeA! settings file');
                const cur = useSettings.getState();
                const ids = new Set(cur.slots.map((x) => x.id));
                cur.set({
                  slots: [...cur.slots, ...(d.slots ?? []).filter((x: Slot) => !ids.has(x.id))],
                  customProviders: [...cur.customProviders, ...(d.customProviders ?? []).filter((x: ProviderDef) => !cur.customProviders.some((c) => c.id === x.id))],
                  fallback: d.fallback ?? cur.fallback,
                  maxRetries: d.maxRetries ?? cur.maxRetries,
                  corsProxy: d.corsProxy ?? cur.corsProxy,
                });
                toast('Settings imported', 'success');
              } catch (err) {
                toast(`Import failed: ${(err as Error).message}`, 'error');
              }
            }} />
          </div>
        </div>
      </div>
    </div>
  );
}
