import { loadAccount } from './lib/account';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { hydrateData } from './lib/data';
import { hydrateLogs, log } from './lib/logs';
import { BUILTIN_PROVIDERS, KEYLESS_ID } from './lib/providers';
import { setGateway, setLiveModels, useRuntime, useSettings, gatewayInfo } from './lib/settings';
import { listModels } from './lib/llm';
import { useProjects } from './lib/projects';
import './styles.css';
import 'highlight.js/styles/github-dark.css';

hydrateData();
void useProjects.getState().load();
hydrateLogs().then(() => log({ level: 'info', type: 'system', feature: 'system', message: 'JeeA! started.' }));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Learn the free model's current id in the background (the free API says its
// models can change). If our saved id is no longer listed, switch to a listed one.
setTimeout(async () => {
  const p = BUILTIN_PROVIDERS.find((x) => x.id === KEYLESS_ID);
  if (!p || !navigator.onLine) return;
  try {
    const ids = await listModels({ provider: p, slot: { apiKey: '' }, corsProxy: '' });
    if (!ids.length) return;
    setLiveModels(KEYLESS_ID, ids);
    const s = useSettings.getState();
    const fix = <T extends { providerId: string; model: string }>(r: T): T => (r.providerId === KEYLESS_ID && !ids.includes(r.model) ? { ...r, model: ids[0] } : r);
    s.set({ defaultModel: fix(s.defaultModel), fallback: { ...s.fallback, chain: s.fallback.chain.map(fix) } });
  } catch {
    /* offline or blocked: keep the built-in default */
  }
}, 1500);

// Site config: the owner's JeeA Gateway (free NVIDIA and other models for everyone).
fetch('./jeea.config.json', { cache: 'no-store' })
  .then((r) => (r.ok ? r.json() : null))
  .then(async (cfg) => {
    if (!cfg?.gateway) {
      void loadAccount();
      return;
    }
    setGateway(cfg.gateway, cfg.gatewayName);
    useRuntime.getState().bump();
    void loadAccount();
    const gw = gatewayInfo();
    if (!gw) return;
    try {
      const ids = await listModels({ provider: gw, slot: { apiKey: '' }, corsProxy: '' });
      if (ids.length) setLiveModels(gw.id, ids);
    } catch {
      /* gateway offline: its suggested models stay */
    }
  })
  .catch(() => undefined);

// Offline cache: repeat visits load from the browser, not from the host.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  });
}
