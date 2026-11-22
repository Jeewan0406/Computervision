import { Fragment, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, Info, Search, Trash2, XCircle } from 'lucide-react';
import type { LogEntry } from '../lib/types';
import { useLogs, logsToCSV } from '../lib/logs';
import { useUI } from '../lib/ui';
import { allProviders } from '../lib/settings';
import { downloadText, fmtMs, fmtNum, fmtTime } from '../lib/utils';
import { TopBar } from '../components/Shell';
import { ProviderDot } from '../components/ModelPicker';

const FEATURES = ['all', 'chat', 'compare', 'team', 'code', 'keys', 'system'] as const;

const median = (xs: number[]) => {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="tile">
      <span className="tile-label">{label}</span>
      <span className="tile-value">{value}</span>
      {sub && <span className="tile-sub">{sub}</span>}
    </div>
  );
}

/** Requests per hour for the last 24 hours, stacked: completed (bottom) and failed (top). */
function HourlyChart({ entries }: { entries: LogEntry[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const buckets = useMemo(() => {
    const nowH = Math.floor(Date.now() / 3_600_000);
    const b = Array.from({ length: 24 }, (_, i) => ({ hour: nowH - 23 + i, ok: 0, err: 0 }));
    for (const e of entries) {
      if (e.type !== 'request' || (e.status !== 'ok' && e.status !== 'error')) continue;
      const idx = Math.floor(e.ts / 3_600_000) - (nowH - 23);
      if (idx < 0 || idx > 23) continue;
      if (e.status === 'ok') b[idx].ok++;
      else b[idx].err++;
    }
    return b;
  }, [entries]);
  const max = Math.max(1, ...buckets.map((b) => b.ok + b.err));
  const total = buckets.reduce((a, b) => a + b.ok + b.err, 0);
  const H = 120;
  const label = (h: number) => new Date(h * 3_600_000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="card chart-card">
      <div className="chart-head">
        <h3>Requests per hour · last 24 hours</h3>
        <div className="legend" aria-label="Legend">
          <span><i className="lg lg-ok" /> Completed</span>
          <span><i className="lg lg-err" /> Failed</span>
        </div>
      </div>
      {total === 0 ? (
        <div className="empty-mini">No requests in the last 24 hours.</div>
      ) : (
        <div className="hourly" style={{ height: H + 24 }} onMouseLeave={() => setHover(null)}>
          <div className="hourly-grid" style={{ height: H }}>
            <span className="grid-label">{max}</span>
            <span className="grid-line" style={{ bottom: H }} />
            <span className="grid-line" style={{ bottom: H / 2 }} />
            <span className="grid-base" />
          </div>
          <div className="hourly-bars" style={{ height: H }}>
            {buckets.map((b, i) => {
              const okH = (b.ok / max) * H;
              const errH = (b.err / max) * H;
              return (
                <div
                  key={b.hour}
                  className={`hbar${hover === i ? ' hover' : ''}`}
                  onMouseEnter={() => setHover(i)}
                  aria-label={`${label(b.hour)}: ${b.ok} completed, ${b.err} failed`}
                >
                  {b.err > 0 && <span className="seg-err" style={{ height: Math.max(2, errH) }} />}
                  {b.ok > 0 && <span className={`seg-ok${b.err > 0 ? '' : ' top'}`} style={{ height: Math.max(2, okH) }} />}
                </div>
              );
            })}
          </div>
          <div className="hourly-x">
            <span>{label(buckets[0].hour)}</span>
            <span>{label(buckets[12].hour)}</span>
            <span>now</span>
          </div>
          {hover != null && (
            <div className="chart-tip" style={{ left: `${((hover + 0.5) / 24) * 100}%` }}>
              <b>{label(buckets[hover].hour)}</b>
              <span><i className="lg lg-ok" /> {buckets[hover].ok} completed</span>
              <span><i className="lg lg-err" /> {buckets[hover].err} failed</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function LogsView() {
  const entries = useLogs((s) => s.entries);
  const clear = useLogs((s) => s.clear);
  const confirm = useUI((s) => s.confirm);
  const [feature, setFeature] = useState<(typeof FEATURES)[number]>('all');
  const [status, setStatus] = useState<'all' | 'ok' | 'problems'>('all');
  const [provider, setProvider] = useState('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [limit, setLimit] = useState(200);
  const providers = allProviders();

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return entries.filter((e) =>
      (feature === 'all' || e.feature === feature) &&
      (status === 'all' || (status === 'ok' ? e.level === 'info' : e.level !== 'info')) &&
      (provider === 'all' || e.providerId === provider) &&
      (!ql || `${e.message} ${e.model ?? ''} ${e.providerName ?? ''} ${e.slotLabel ?? ''}`.toLowerCase().includes(ql)),
    );
  }, [entries, feature, status, provider, q]);

  const stats = useMemo(() => {
    const req = filtered.filter((e) => e.type === 'request' && (e.status === 'ok' || e.status === 'error'));
    const ok = req.filter((e) => e.status === 'ok');
    const tIn = ok.reduce((a, e) => a + (e.tokensIn ?? 0), 0);
    const tOut = ok.reduce((a, e) => a + (e.tokensOut ?? 0), 0);
    const anyEst = ok.some((e) => e.estimated);
    const retries = filtered.filter((e) => e.status === 'retry').length;
    return {
      total: req.length,
      rate: req.length ? (ok.length / req.length) * 100 : undefined,
      ttft: median(ok.map((e) => e.ttftMs ?? NaN).filter(Number.isFinite)),
      total50: median(ok.map((e) => e.totalMs ?? NaN).filter(Number.isFinite)),
      tIn, tOut, anyEst, retries,
    };
  }, [filtered]);

  const byProvider = useMemo(() => {
    const m = new Map<string, { name: string; id: string; n: number; ok: number; ttft: number[]; total: number[]; out: number }>();
    for (const e of filtered) {
      if (e.type !== 'request' || !e.providerId || (e.status !== 'ok' && e.status !== 'error')) continue;
      const r = m.get(e.providerId) ?? { name: e.providerName ?? e.providerId, id: e.providerId, n: 0, ok: 0, ttft: [], total: [], out: 0 };
      r.n++;
      if (e.status === 'ok') {
        r.ok++;
        if (e.ttftMs != null) r.ttft.push(e.ttftMs);
        if (e.totalMs != null) r.total.push(e.totalMs);
        r.out += e.tokensOut ?? 0;
      }
      m.set(e.providerId, r);
    }
    return [...m.values()].sort((a, b) => b.n - a.n);
  }, [filtered]);

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

  return (
    <div className="view logs-view">
      <TopBar
        right={
          <>
            <button className="btn ghost sm" onClick={() => downloadText(`jeea-logs-${stamp}.csv`, logsToCSV(filtered), 'text/csv')} disabled={!filtered.length}><Download size={14} /> CSV</button>
            <button className="btn ghost sm" onClick={() => downloadText(`jeea-logs-${stamp}.json`, JSON.stringify(filtered, null, 2), 'application/json')} disabled={!filtered.length}><Download size={14} /> JSON</button>
            <button className="icon-btn" title="Clear all logs" onClick={async () => {
              if (await confirm({ title: 'Clear all logs?', body: 'This removes the activity history from this browser.', confirmLabel: 'Clear', danger: true })) clear();
            }}><Trash2 size={16} /></button>
          </>
        }
      >
        <span className="topbar-title strong">Logs</span>
        <span className="muted sm hide-sm">{entries.length} entries · stored only in this browser · no keys or message text</span>
      </TopBar>
      <div className="scroll page">
        <div className="page-inner wide">
          <div className="filters">
            <div className="seg">
              {FEATURES.map((f) => (
                <button key={f} className={feature === f ? 'active' : ''} onClick={() => setFeature(f)}>{f === 'all' ? 'All' : f === 'code' ? 'CodeFrame' : f === 'keys' ? 'API Slots' : f[0].toUpperCase() + f.slice(1)}</button>
              ))}
            </div>
            <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="sm">
              <option value="all">All levels</option>
              <option value="ok">Info only</option>
              <option value="problems">Warnings & errors</option>
            </select>
            <select value={provider} onChange={(e) => setProvider(e.target.value)} className="sm">
              <option value="all">All providers</option>
              {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <div className="history-search grow">
              <Search size={14} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search messages, models, keys…" />
            </div>
          </div>

          <div className="tiles">
            <Tile label="Requests" value={fmtNum(stats.total)} sub={`${stats.retries} retries / cooldowns`} />
            <Tile label="Success rate" value={stats.rate == null ? '–' : `${stats.rate.toFixed(1)}%`} sub="completed ÷ (completed + failed)" />
            <Tile label="Median first token" value={fmtMs(stats.ttft)} sub="time until text starts" />
            <Tile label="Median full answer" value={fmtMs(stats.total50)} sub="time until the answer ends" />
            <Tile label="Tokens" value={`${stats.anyEst ? '≈' : ''}${fmtNum(stats.tIn + stats.tOut)}`} sub={`${fmtNum(stats.tIn)} in · ${fmtNum(stats.tOut)} out${stats.anyEst ? ' · some estimated' : ''}`} />
          </div>

          <HourlyChart entries={filtered} />

          {byProvider.length > 0 && (
            <div className="card">
              <h3>By provider</h3>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Provider</th><th>Requests</th><th>Success</th><th>Median first token</th><th>Median total</th><th>Output tokens</th></tr></thead>
                  <tbody>
                    {byProvider.map((r) => (
                      <tr key={r.id}>
                        <td><span className="row gap-6"><ProviderDot color={providers.find((p) => p.id === r.id)?.color ?? '#888'} size={8} />{r.name}</span></td>
                        <td>{r.n}</td>
                        <td>{((r.ok / r.n) * 100).toFixed(0)}%</td>
                        <td>{fmtMs(median(r.ttft))}</td>
                        <td>{fmtMs(median(r.total))}</td>
                        <td>{fmtNum(r.out)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="card">
            <h3>Activity <span className="muted sm">({filtered.length})</span></h3>
            {filtered.length === 0 ? (
              <div className="empty-mini">Nothing logged yet. Every request you send shows up here with its timing, tokens and result.</div>
            ) : (
              <div className="table-wrap">
                <table className="table log-table">
                  <thead><tr><th>Time</th><th></th><th>Feature</th><th>Provider · model</th><th>Key</th><th>Status</th><th>First token</th><th>Total</th><th>Tokens</th><th>Message</th></tr></thead>
                  <tbody>
                    {filtered.slice(0, limit).map((e) => (
                      <Fragment key={e.id}>
                        <tr className={`lvl-${e.level}${open === e.id ? ' open' : ''}`} onClick={() => setOpen(open === e.id ? null : e.id)}>
                          <td className="nowrap">{fmtTime(e.ts)}</td>
                          <td>{e.level === 'error' ? <XCircle size={14} className="ic-err" aria-label="Error" /> : e.level === 'warn' ? <AlertTriangle size={14} className="ic-warn" aria-label="Warning" /> : e.type === 'request' ? <CheckCircle2 size={14} className="ic-ok" aria-label="OK" /> : <Info size={14} className="ic-info" aria-label="Info" />}</td>
                          <td className="nowrap">{e.feature}</td>
                          <td className="ellipsis" title={`${e.providerName ?? ''} · ${e.model ?? ''}`}>{e.providerName ? <><b>{e.providerName}</b>{e.model ? ` · ${e.model}` : ''}</> : '–'}</td>
                          <td className="ellipsis">{e.slotLabel ?? '–'}</td>
                          <td className="nowrap">{e.status ?? e.type}{e.httpStatus ? ` (${e.httpStatus})` : ''}</td>
                          <td className="nowrap">{fmtMs(e.ttftMs)}</td>
                          <td className="nowrap">{fmtMs(e.totalMs)}</td>
                          <td className="nowrap">{e.tokensOut != null ? `${e.estimated ? '≈' : ''}${fmtNum(e.tokensIn)} / ${fmtNum(e.tokensOut)}` : '–'}</td>
                          <td className="ellipsis msg-cell" title={e.message}>{e.message}</td>
                        </tr>
                        {open === e.id && (
                          <tr className="log-detail"><td colSpan={10}><pre>{JSON.stringify(e, null, 2)}</pre></td></tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
                {filtered.length > limit && <button className="btn ghost sm mt-8" onClick={() => setLimit((l) => l + 300)}>Show more ({filtered.length - limit} left)</button>}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
